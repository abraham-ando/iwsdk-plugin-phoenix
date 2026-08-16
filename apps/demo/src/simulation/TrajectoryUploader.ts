/**
 * Ships the VR session's recorded trajectories to the BFF in periodic batches
 * (spec §9.2). Fire-and-forget with rebuffering: a failed upload puts the
 * batch back so no data is lost while the BFF is unreachable.
 */
import type { CardinalSimulationSystem } from './CardinalSimulationSystem';
import type { TrajectoryBatch } from '@iwsdk/cardinal-simulation';

const UPLOAD_INTERVAL_MS = 10_000;

export class TrajectoryUploader {
  readonly runId: string;
  private token: string | null = null;
  private warnedOffline = false;
  private pending: TrajectoryBatch | null = null;
  private readonly timer: number;

  constructor(
    private readonly system: CardinalSimulationSystem,
    private readonly baseUrl: string = ((import.meta as unknown as { env?: Record<string, string> })
      .env?.VITE_BFF_URL ?? 'http://localhost:3001')
  ) {
    this.runId = `vr-${Date.now().toString(36)}`;
    this.timer = window.setInterval(() => void this.flush(), UPLOAD_INTERVAL_MS);
  }

  private mergeBatches(a: TrajectoryBatch, b: TrajectoryBatch): TrajectoryBatch {
    return {
      decisions: [...a.decisions, ...b.decisions],
      predictions: [...a.predictions, ...b.predictions],
      episodes: [...a.episodes, ...b.episodes],
    };
  }

  private async ensureToken(): Promise<string> {
    if (this.token !== null) return this.token;
    const res = await fetch(`${this.baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'cardinal-telemetry' }),
    });
    if (!res.ok) throw new Error(`auth ${res.status}`);
    this.token = ((await res.json()) as { token: string }).token;
    return this.token;
  }

  private async flush(): Promise<void> {
    const fresh = this.system.recorder.drain();
    const batch = this.pending !== null ? this.mergeBatches(this.pending, fresh) : fresh;
    this.pending = null;
    if (batch.decisions.length + batch.predictions.length + batch.episodes.length === 0) return;

    try {
      const token = await this.ensureToken();
      const res = await fetch(`${this.baseUrl}/trajectories/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ runId: this.runId, ...batch }),
      });
      if (res.status === 401) this.token = null;
      if (!res.ok) throw new Error(`bff ${res.status}`);
    } catch (err) {
      this.pending = batch; // rebuffer, retry next interval
      if (!this.warnedOffline) {
        this.warnedOffline = true;
        console.warn('[TrajectoryUploader] BFF unreachable — batches are rebuffered.', err);
      }
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }
}
