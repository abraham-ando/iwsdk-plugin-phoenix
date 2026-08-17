/**
 * Pumps the engine's plan-request outbox through an ordered chain of
 * deliberators, and feeds responses back as journaled external events
 * (spec §8.3).
 *
 * Les étages dégradent au lieu de tomber : le BFF d'abord, puis un modèle
 * local sur WebGPU s'il a été activé, et sinon rien du tout — les agents
 * continuent sur leurs réflexes. La simulation ne bloque jamais sur le
 * réseau, et n'attend aucun service pour vivre.
 */
import {
  buildSystemPrompt,
  extractPlanJson,
  planEnvelope,
  planWithTiers,
  maxTokensFor,
  type PlanRequest,
  type PlanTier,
  type Planner,
} from '@iwsdk/cardinal-simulation';
import type { CardinalSimulationSystem } from './CardinalSimulationSystem';

const EVENT_BY_REASON: Record<string, string> = {
  dawn: 'llm_plan',
  surprise: 'llm_plan',
  dialogue: 'llm_dialogue',
  reflection: 'llm_reflection',
  player_dialogue: 'llm_player_reply',
};

const MAX_IN_FLIGHT = 3;
const PUMP_INTERVAL_MS = 250;

/** Ce qu'il faut d'un moteur d'inférence pour délibérer : une génération. */
export interface LocalInference {
  generate(request: {
    npcId: number;
    systemPrompt: string;
    playerMessage: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

export class Mode2Client {
  private queue: PlanRequest[] = [];
  private inFlight = 0;
  private token: string | null = null;
  private warnedOffline = false;
  private timer: number;
  /** Étage local, absent tant que personne ne l'a activé depuis le panneau. */
  private local: PlanTier | null = null;

  constructor(
    private system: CardinalSimulationSystem,
    private baseUrl: string = ((import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_BFF_URL ?? 'http://localhost:3001')
  ) {
    this.timer = window.setInterval(() => void this.pump(), PUMP_INTERVAL_MS);
  }

  /**
   * Branche — ou débranche — la délibération locale. Elle reste éteinte par
   * défaut : le modèle pèse près d'un gigaoctet, et l'imposer au premier
   * chargement ferait payer à tout le monde ce que peu veulent.
   */
  useLocalInference(inference: LocalInference | null): void {
    this.local =
      inference === null
        ? null
        : { name: 'webgpu', plan: Mode2Client.localPlanner(inference) };
  }

  /** Quels étages sont disponibles, du plus souhaitable au dernier recours. */
  private tiers(): PlanTier[] {
    const chain: PlanTier[] = [{ name: 'bff', plan: (r) => this.askBff(r) }];
    if (this.local !== null) chain.push(this.local);
    return chain;
  }

  private static localPlanner(inference: LocalInference): Planner {
    return async (request) => {
      const completion = await inference.generate({
        npcId: 0,
        systemPrompt: buildSystemPrompt(request),
        playerMessage: JSON.stringify(request),
        temperature: 0.6,
        maxTokens: maxTokensFor(request),
      });
      // Mêmes consigne et même extraction que le serveur : c'est ce qui rend
      // les deux étages comparables sur le même monde.
      try {
        return planEnvelope(request, extractPlanJson(completion.text));
      } catch (err) {
        // Un petit modèle rend parfois du texte au lieu du JSON demandé. La
        // chaîne d'étages avale l'exception par conception ; sans cette trace,
        // l'échec serait indiscernable d'une absence de modèle.
        console.warn(
          `[Mode2Client] réponse locale inexploitable (${String(err)}) :`,
          completion.text.slice(0, 400)
        );
        throw err;
      }
    };
  }

  /**
   * Délibère tout de suite, hors file d'attente, et dit quel étage a répondu.
   * Sert à sonder — le coût d'une génération, la validité d'un plan — sans
   * attendre qu'un agent en demande une.
   */
  async deliberateNow(
    request: Readonly<PlanRequest>
  ): Promise<{ tier: string; payload: Record<string, unknown> } | null> {
    return planWithTiers(request, this.tiers());
  }

  private async ensureToken(): Promise<string> {
    if (this.token !== null) return this.token;
    const res = await fetch(`${this.baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'cardinal-sim' }),
    });
    if (!res.ok) throw new Error(`auth ${res.status}`);
    const body = (await res.json()) as { token: string };
    this.token = body.token;
    return this.token;
  }

  private async askBff(request: Readonly<PlanRequest>): Promise<Record<string, unknown>> {
    const token = await this.ensureToken();
    const res = await fetch(`${this.baseUrl}/agents/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ request }),
    });
    if (res.status === 401) this.token = null; // stale token: retry next time
    if (!res.ok) throw new Error(`bff ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  private pump(): void {
    this.queue.push(...this.system.runtime.drainPlanRequests());
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const request = this.queue.shift()!;
      this.inFlight++;
      void this.send(request).finally(() => {
        this.inFlight--;
      });
    }
  }

  private async send(request: PlanRequest): Promise<void> {
    const result = await planWithTiers(request, this.tiers());
    if (result === null) {
      if (!this.warnedOffline) {
        this.warnedOffline = true;
        const local = this.local === null ? 'aucun modèle local activé' : 'modèle local en échec';
        console.warn(
          `[Mode2Client] aucune délibération disponible (${local}) — les agents poursuivent sur leurs réflexes.`
        );
      }
      // Demande abandonnée : on libère le drapeau d'attente du moteur pour que
      // l'agent puisse redemander plus tard.
      this.system.runtime.releasePendingRequest(request.agentId, request.requestId);
      return;
    }
    this.warnedOffline = false;
    this.system.kernel.submitEvent(EVENT_BY_REASON[request.reason] ?? 'llm_plan', result.payload);
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }
}
