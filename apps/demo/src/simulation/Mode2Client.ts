/**
 * Pumps the engine's plan-request outbox to the BFF and feeds responses back
 * as journaled external events (spec §8.3). Fire-and-forget: any failure
 * leaves the agents running on Mode-1 reflexes — the simulation never blocks
 * on the network.
 */
import type { CardinalSimulationSystem } from './CardinalSimulationSystem';
import type { PlanRequest } from '@iwsdk/cardinal-simulation';

const EVENT_BY_REASON: Record<string, string> = {
  dawn: 'llm_plan',
  surprise: 'llm_plan',
  dialogue: 'llm_dialogue',
  reflection: 'llm_reflection',
};

const MAX_IN_FLIGHT = 3;
const PUMP_INTERVAL_MS = 250;

export class Mode2Client {
  private queue: PlanRequest[] = [];
  private inFlight = 0;
  private token: string | null = null;
  private warnedOffline = false;
  private timer: number;

  constructor(
    private system: CardinalSimulationSystem,
    private baseUrl: string = ((import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_BFF_URL ?? 'http://localhost:3001')
  ) {
    this.timer = window.setInterval(() => void this.pump(), PUMP_INTERVAL_MS);
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
    try {
      const token = await this.ensureToken();
      const res = await fetch(`${this.baseUrl}/agents/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request }),
      });
      if (res.status === 401) this.token = null; // stale token: retry next time
      if (!res.ok) throw new Error(`bff ${res.status}`);
      const payload = (await res.json()) as Record<string, unknown>;
      this.system.kernel.submitEvent(EVENT_BY_REASON[request.reason] ?? 'llm_plan', payload);
    } catch (err) {
      if (!this.warnedOffline) {
        this.warnedOffline = true;
        console.warn('[Mode2Client] BFF unreachable — agents continue on Mode-1 reflexes.', err);
      }
      // Dropped request: release the engine's pending flag so the agent can
      // ask again later.
      this.system.runtime.releasePendingRequest(request.agentId, request.requestId);
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }
}
