import { Types, createSystem, type Entity } from '@iwsdk/core';
import { NPCBanter } from '../components/NPCBanter';
import { SmartNPC } from '../components/SmartNPC';
import { CardinalIntelligenceSystem } from '../systems/CardinalIntelligenceSystem';
import { CardinalSpatialAudioSystem } from '../systems/CardinalSpatialAudioSystem';

export type BanterCallback = (speaker: Entity, listener: Entity, line: string) => void;

export class NPCBanterSystem extends createSystem(
  {
    banterers: { required: [NPCBanter, SmartNPC] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
    checkIntervalMs: { type: Types.Float32, default: 3000 },
  },
) {
  private lastCheckTime = 0;
  private banterListeners = new Set<BanterCallback>();

  /** Register a callback fired when banter occurs */
  public onBanter(cb: BanterCallback): () => void {
    this.banterListeners.add(cb);
    return () => this.banterListeners.delete(cb);
  }

  /**
   * Trigger a spontaneous banter conversation between two NPCs.
   */
  public async triggerBanter(
    npcA: Entity,
    npcB: Entity,
    intelligenceSystem?: CardinalIntelligenceSystem,
    audioSystem?: CardinalSpatialAudioSystem
  ): Promise<void> {
    npcA.setValue(NPCBanter, 'isBantering', true);
    npcB.setValue(NPCBanter, 'isBantering', true);

    const now = performance.now();
    npcA.setValue(NPCBanter, 'lastBanterTime', now);
    npcB.setValue(NPCBanter, 'lastBanterTime', now);

    try {
      let lineA = 'Salutations mon ami ! Belle journée sur la grand-place.';
      let lineB = 'En effet ! Prends garde aux rumeurs qui courent vers le nord.';

      // Inference failures (BFF unreachable, network down, provider error)
      // must never surface as an unhandled dialogue — the village degrades
      // to its scripted banter lines instead of going silent or throwing.
      if (intelligenceSystem) {
        try {
          lineA = await intelligenceSystem.queryNPC(
            npcA,
            'Salue brièvement ton compagnon PNJ et commente la journée.',
            'Conversation amicale entre deux villageois dans le monde de Cardinal.'
          );
        } catch (err) {
          console.warn('[NPCBanterSystem] Inference failed for banter line A, using fallback line:', err);
        }
      }

      for (const listener of this.banterListeners) {
        listener(npcA, npcB, lineA);
      }

      if (audioSystem) {
        await audioSystem.speak(npcA, lineA);
      }

      if (intelligenceSystem) {
        try {
          lineB = await intelligenceSystem.queryNPC(
            npcB,
            `Ton compagnon vient de te dire : "${lineA}". Réponds brièvement.`,
            'Conversation amicale entre deux villageois dans le monde de Cardinal.'
          );
        } catch (err) {
          console.warn('[NPCBanterSystem] Inference failed for banter line B, using fallback line:', err);
        }
      }

      for (const listener of this.banterListeners) {
        listener(npcB, npcA, lineB);
      }

      if (audioSystem) {
        await audioSystem.speak(npcB, lineB);
      }
    } finally {
      npcA.setValue(NPCBanter, 'isBantering', false);
      npcB.setValue(NPCBanter, 'isBantering', false);
    }
  }

  override update(_delta: number, _time: number): void {
    if (!this.config.enabled.value) return;

    // Gate on `performance.now()` (milliseconds), not on the ECS clock's
    // `time` argument — that's `THREE.Clock.elapsedTime`, in SECONDS (see
    // @iwsdk/core's world-initializer). `checkIntervalMs`/`cooldownMs` are
    // millisecond fields, and `triggerBanter` already stamps
    // `lastBanterTime` with `performance.now()`; comparing that against a
    // seconds-scale `time` made both thresholds unreachable in any real
    // playthrough (an elapsedTime of literal thousands of seconds).
    const now = performance.now();
    if (now - this.lastCheckTime < this.config.checkIntervalMs.value) {
      return;
    }
    this.lastCheckTime = now;

    const entities = Array.from(this.queries.banterers.entities);
    if (entities.length < 2) return;

    for (let i = 0; i < entities.length; i++) {
      const npcA = entities[i]!;
      const isBanteringA = npcA.getValue(NPCBanter, 'isBantering') ?? false;
      const cooldownA = npcA.getValue(NPCBanter, 'cooldownMs') ?? 15000;
      const lastBanterA = npcA.getValue(NPCBanter, 'lastBanterTime') ?? 0;

      if (isBanteringA || now - lastBanterA < cooldownA) continue;

      for (let j = i + 1; j < entities.length; j++) {
        const npcB = entities[j]!;
        const isBanteringB = npcB.getValue(NPCBanter, 'isBantering') ?? false;
        const cooldownB = npcB.getValue(NPCBanter, 'cooldownMs') ?? 15000;
        const lastBanterB = npcB.getValue(NPCBanter, 'lastBanterTime') ?? 0;

        if (isBanteringB || now - lastBanterB < cooldownB) continue;

        const talkativeness = npcA.getValue(NPCBanter, 'talkativeness') ?? 0.7;
        if (Math.random() <= talkativeness) {
          // Trigger banter
          const intelligence = (this as any).world?.getSystem(CardinalIntelligenceSystem);
          const audio = (this as any).world?.getSystem(CardinalSpatialAudioSystem);
          this.triggerBanter(npcA, npcB, intelligence, audio).catch((err) => {
            console.warn('[NPCBanterSystem] Banter error:', err);
          });
          return;
        }
      }
    }
  }
}
