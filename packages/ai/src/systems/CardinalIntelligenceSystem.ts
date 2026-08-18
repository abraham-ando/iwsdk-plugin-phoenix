import { Types, createSystem, type Entity } from '@iwsdk/core';
import { SmartNPC } from '../components/SmartNPC';
import { NPCMemory, addDialogueTurn } from '../components/NPCMemory';
import { NPCEmotion, EmotionPromptModifiers, EmotionTypeValue } from '../components/NPCEmotion';
import { CardinalContextBuilder, type CardinalWorldContextOptions } from '../context/CardinalContextBuilder';
import { IntentParser, IntentDispatcher } from '../intents/IntentParser';
import { IntentGuard, type IntentSecurityPolicy } from '../security/IntentGuard';
import type { ActionIntent, ActionIntentType, IntentHandler } from '../intents/types';

/** Built-in RBAC role presets provided by {@link IntentGuard.getRolePolicy} */
export type NPCSecurityRole = 'merchant' | 'guard' | 'questgiver' | 'companion' | 'neutral';
import { CognitiveScheduler } from '../scheduler/CognitiveScheduler';
import type { IInferenceAdapter, InferenceResponse } from '../adapters/types';

export class CardinalIntelligenceSystem extends createSystem(
  {
    npcs: { required: [SmartNPC] },
  },
  {
    /** Optional swappable inference adapter */
    adapter: { type: Types.Object, default: null },
    /** Enable auto-triggering queries on proximity */
    autoQueryNearby: { type: Types.Boolean, default: false },
    /** Global fallback interaction radius in meters */
    interactionRadius: { type: Types.Float32, default: 3.0 },
    /** Master enable flag */
    enabled: { type: Types.Boolean, default: true },
    /** Enable prioritized cognitive scheduling */
    useScheduler: { type: Types.Boolean, default: true },
  },
) {
  private inferenceAdapter: IInferenceAdapter | null = null;
  private scheduler = new CognitiveScheduler();
  public readonly intentDispatcher = new IntentDispatcher();

  private personalities = new Map<number, string>([
    [0, 'Tu es un guide bienveillant dans cet univers virtuel.'],
    [1, 'Tu es un garde vigilant protégeant les remparts.'],
    [2, 'Tu es un marchand ambulant cherchant des artefacts rares.'],
  ]);
  private dialogueHistory = new Map<number, string>();
  private securityPolicies = new Map<number, IntentSecurityPolicy>();

  public override init(): void {
    if (this.config.adapter.value) {
      this.inferenceAdapter = this.config.adapter.value as unknown as IInferenceAdapter;
    }
  }

  /** Set or replace the active inference backend adapter */
  public setInferenceAdapter(adapter: IInferenceAdapter): void {
    this.inferenceAdapter = adapter;
  }

  /** Register an action intent handler (e.g. GIVE_ITEM, ATTACK, EMOTE) */
  public onIntent(type: ActionIntentType, handler: IntentHandler): () => void {
    return this.intentDispatcher.on(type, handler);
  }

  /** Register a custom personality prompt for a given archetype ID */
  public registerPersonality(personalityId: number, prompt: string): void {
    this.personalities.set(personalityId, prompt);
  }

  /**
   * Bind an intent security policy to a personality ID — either a built-in
   * role preset name or a custom {@link IntentSecurityPolicy}.
   * Without a registered policy, intents dispatch unfiltered (legacy behavior).
   */
  public setSecurityPolicy(personalityId: number, policy: NPCSecurityRole | IntentSecurityPolicy): void {
    const resolved = typeof policy === 'string' ? IntentGuard.getRolePolicy(policy) : policy;
    this.securityPolicies.set(personalityId, resolved);
  }

  /** Get the last generated dialogue for an NPC */
  public getLastDialogue(npcId: number): string | undefined {
    return this.dialogueHistory.get(npcId);
  }

  /**
   * Send a query to the NPC, parse action intents, update memory and return clean speech.
   */
  public async queryNPC(
    entity: Entity,
    playerMessage: string,
    worldContextOrOptions?: string | CardinalWorldContextOptions,
    spatialPriority?: { distance?: number; gazeAlignment?: number }
  ): Promise<string> {
    if (!this.inferenceAdapter || !this.inferenceAdapter.isReady) {
      return '...';
    }

    if (!entity.hasComponent(SmartNPC)) {
      return '';
    }

    const isThinking = entity.getValue(SmartNPC, 'isThinking') ?? false;
    if (isThinking) {
      return 'Le PNJ est déjà en train de réfléchir...';
    }

    // Neutralize forged [ACTION:…] tags and prompt-injection markers before the
    // text reaches prompt construction or episodic memory.
    const sanitizedMessage = IntentGuard.sanitizePlayerInput(playerMessage);

    const personalityId = entity.getValue(SmartNPC, 'personalityId') ?? 0;
    let basePrompt =
      this.personalities.get(personalityId) ??
      'Tu es un personnage interactif dans le monde Cardinal.';

    // Augment with NPCEmotion modifier if component exists
    if ((NPCEmotion as any).bit && entity.hasComponent(NPCEmotion)) {
      const emotionVal = (entity.getValue(NPCEmotion, 'currentEmotion') ?? 0) as EmotionTypeValue;
      const moodModifier = EmotionPromptModifiers[emotionVal];
      if (moodModifier) {
        basePrompt += ` ${moodModifier}`;
      }
    }

    // Build structured world context
    let formattedContext = '';
    if (typeof worldContextOrOptions === 'string') {
      formattedContext = worldContextOrOptions;
    } else {
      formattedContext = CardinalContextBuilder.buildContext(entity, worldContextOrOptions ?? {});
    }

    // Append instructions for structured action intent formatting
    const systemPromptWithInstructions = `${basePrompt}\nSi une action de jeu est appropriée, inclus un tag structuré [ACTION: NOM_ACTION cle=valeur].`;

    entity.setValue(SmartNPC, 'isThinking', true);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    entity.setValue(SmartNPC, 'lastDecisionTime', now);

    const npcId = (entity as any).id ?? personalityId;

    const executeInference = async (): Promise<string> => {
      try {
        const res: InferenceResponse = await this.inferenceAdapter!.generate({
          npcId,
          systemPrompt: systemPromptWithInstructions,
          playerMessage: sanitizedMessage,
          worldContext: formattedContext,
        });

        // Parse structured action intents
        const parsed = IntentParser.parse(res.text);

        // Record episodic memory
        if ((NPCMemory as any).bit && entity.hasComponent(NPCMemory)) {
          const maxTurns = entity.getValue(NPCMemory, 'maxHistoryTurns') ?? 4;
          addDialogueTurn(npcId, { role: 'user', content: sanitizedMessage, timestamp: now }, maxTurns);
          addDialogueTurn(npcId, { role: 'assistant', content: parsed.cleanDialogue, timestamp: now }, maxTurns);
          const total = (entity.getValue(NPCMemory, 'totalInteractions') ?? 0) + 1;
          entity.setValue(NPCMemory, 'totalInteractions', total);
          entity.setValue(NPCMemory, 'lastInteractionTime', now);
        }

        // Validate LLM-emitted intents against this NPC's security policy,
        // then dispatch only the surviving ones to game handlers.
        const policy = this.securityPolicies.get(personalityId);
        const permittedIntents = parsed.intents.filter((intent) => {
          const verdict = IntentGuard.validateIntent(intent.type, intent.params, policy);
          if (!verdict.isValid) {
            console.warn(`[CardinalAI] Blocked intent '${intent.type}' for NPC ${npcId}: ${verdict.reason}`);
          }
          return verdict.isValid;
        });
        if (permittedIntents.length > 0) {
          await this.intentDispatcher.dispatch(permittedIntents, npcId);
        }

        this.dialogueHistory.set(npcId, parsed.cleanDialogue);
        entity.setValue(SmartNPC, 'isThinking', false);
        return parsed.cleanDialogue;
      } catch (error) {
        entity.setValue(SmartNPC, 'isThinking', false);
        throw error;
      }
    };

    if (this.config.useScheduler.value) {
      return this.scheduler.enqueue(npcId, executeInference, spatialPriority);
    } else {
      return executeInference();
    }
  }

  override update(_delta: number, _time: number): void {
    if (!this.config.enabled.value || !this.inferenceAdapter?.isReady) {
      return;
    }
    this.scheduler.pump();
  }
}
