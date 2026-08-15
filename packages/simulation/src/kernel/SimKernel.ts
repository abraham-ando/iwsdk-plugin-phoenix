import { Rng } from './Rng';
import { EventLog, type ExternalEvent } from './EventLog';

export const TICK_MS = 100;
export const TICKS_PER_DAY = 2400;

/** Simulated hour of day in [0, 24). Tick 0 is midnight of day 0. */
export function hourOfDay(tick: number): number {
  return ((tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 24;
}

export interface TickContext {
  tick: number;
  hour: number;
  isDayStart: boolean;
  rng: Rng;
  events: ExternalEvent[];
}

export type TickHandler = (ctx: TickContext) => void;

const MAX_TICKS_PER_ADVANCE = 1000;

/**
 * Fixed-timestep simulation kernel (spec §8). Clients call advance(realDelta);
 * headless mode calls step() in a tight loop. External inputs (LLM plans,
 * player actions) are queued via submitEvent, delivered on the next tick and
 * journaled; passing a replayLog re-injects a previous journal instead.
 */
export class SimKernel {
  readonly rng: Rng;
  readonly log = new EventLog();
  tick = 0;
  timeScale = 1;

  private accumulatorMs = 0;
  private handlers: TickHandler[] = [];
  private pending: Array<{ type: string; payload: unknown }> = [];
  private replayLog: EventLog | null;

  constructor(opts: { seed: number; replayLog?: EventLog }) {
    this.rng = new Rng(opts.seed);
    this.replayLog = opts.replayLog ?? null;
  }

  onTick(handler: TickHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  submitEvent(type: string, payload: unknown): void {
    if (this.replayLog !== null) {
      throw new Error('SimKernel.submitEvent: kernel is in replay mode');
    }
    this.pending.push({ type, payload });
  }

  step(): void {
    this.tick++;
    let events: ExternalEvent[];
    if (this.replayLog !== null) {
      events = this.replayLog.forTick(this.tick);
    } else {
      events = this.pending.map((p) => ({ tick: this.tick, type: p.type, payload: p.payload }));
      this.pending = [];
      for (const e of events) this.log.record(e);
    }
    const ctx: TickContext = {
      tick: this.tick,
      hour: hourOfDay(this.tick),
      isDayStart: this.tick % TICKS_PER_DAY === 0,
      rng: this.rng,
      events,
    };
    for (const handler of [...this.handlers]) handler(ctx);
  }

  /** Returns the number of ticks actually run. */
  advance(realDeltaSeconds: number): number {
    if (this.timeScale <= 0) return 0;
    this.accumulatorMs += realDeltaSeconds * 1000 * this.timeScale;
    let ran = 0;
    while (this.accumulatorMs >= TICK_MS && ran < MAX_TICKS_PER_ADVANCE) {
      this.accumulatorMs -= TICK_MS;
      this.step();
      ran++;
    }
    if (ran === MAX_TICKS_PER_ADVANCE) this.accumulatorMs = 0;
    return ran;
  }
}
