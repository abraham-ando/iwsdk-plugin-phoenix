/**
 * Clock synchronization math — pure, every timestamp a parameter.
 *
 * That purity is not only for the tests. The samples are stamped in the
 * network worker, because a render hitch on the main thread would inflate a
 * measurement and the estimator would believe it; nothing in here may reach
 * for a clock of its own, or it would be reading the wrong one.
 *
 * Design: `docs/superpowers/specs/2026-08-14-clock-sync-design.md`.
 */

/** One PING/PONG exchange. `t3` is stamped locally when the PONG lands. */
export interface ClockSample {
  /** Client send time, local clock. */
  t0: number;
  /** Server receive time, server clock. */
  t1: number;
  /** Server send time, server clock. */
  t2: number;
  /** Client receive time, local clock. */
  t3: number;
  /** Server node's boot identifier. */
  epoch: number;
}

/** What the estimator currently believes. */
export interface ClockEstimate {
  /** Add to a local timestamp to get the server's. */
  offsetMs: number;
  rttMs: number;
  epoch: number;
}

/**
 * Sliding-window, minimum-RTT offset estimator.
 *
 * No averaging, deliberately. A sample's error is bounded by half its
 * round-trip time, and network noise is one-sided — a queue can only ever add
 * delay, never subtract it — so averaging mixes clean measurements with
 * strictly-worse ones and lands somewhere between. The fastest exchange in the
 * window is the one that spent the least time waiting anywhere, which makes it
 * the closest to the truth. This is NTP's own choice, for the same reason.
 */
export class ClockSyncEstimator {
  private samples: { offsetMs: number; rttMs: number }[] = [];
  private currentEpoch: number | null = null;

  constructor(private readonly windowSize = 8) {}

  addSample({ t0, t1, t2, t3, epoch }: ClockSample): void {
    if (this.currentEpoch !== null && epoch !== this.currentEpoch) {
      // The server restarted, or a handoff moved us to another node. Its
      // monotonic clock has a fresh, unrelated origin, so every sample in the
      // window now describes a clock that no longer exists.
      this.samples = [];
    }
    this.currentEpoch = epoch;

    const rttMs = t3 - t0 - (t2 - t1);
    // A negative round trip means the stamps disagree about causality —
    // a clock that moved, or a peer that lied. Either way it is not a
    // measurement, and one poisoned sample can dominate a min-RTT window.
    if (rttMs < 0) return;

    const offsetMs = (t1 - t0 + (t2 - t3)) / 2;

    this.samples.push({ offsetMs, rttMs });
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  /** The best current estimate, or `null` before any usable sample. */
  estimate(): ClockEstimate | null {
    if (this.samples.length === 0 || this.currentEpoch === null) return null;

    let best = this.samples[0];
    for (const candidate of this.samples) {
      if (candidate.rttMs < best.rttMs) best = candidate;
    }

    return { offsetMs: best.offsetMs, rttMs: best.rttMs, epoch: this.currentEpoch };
  }
}

/**
 * Rate-limited application of an offset estimate.
 *
 * Every new estimate is a small step away from the last, and applying those
 * steps directly would jump the clock — which would pop every interpolation
 * currently reading from it. So the applied value bends toward the target
 * instead of snapping to it.
 *
 * Two cases do snap, because there is nothing to bend from: the first
 * estimate, and an epoch change, where easing would mean passing smoothly
 * through a range of values that describe no clock at all.
 */
export class SlewedOffset {
  private applied: number | null = null;
  private epoch: number | null = null;
  private lastNowMs = 0;

  constructor(private readonly maxSlewMsPerSecond = 120) {}

  update(target: ClockEstimate, nowMs: number): number {
    if (this.applied === null || this.epoch !== target.epoch) {
      this.applied = target.offsetMs;
      this.epoch = target.epoch;
      this.lastNowMs = nowMs;
      return this.applied;
    }

    const budget = Math.max(
      0,
      ((nowMs - this.lastNowMs) / 1000) * this.maxSlewMsPerSecond,
    );
    const delta = target.offsetMs - this.applied;
    this.applied += Math.sign(delta) * Math.min(Math.abs(delta), budget);
    this.lastNowMs = nowMs;
    return this.applied;
  }
}

/**
 * Map an offset measured against a worker's clock onto the main thread's.
 *
 * `performance.now()` counts from `performance.timeOrigin`, and a worker's
 * origin is the moment it was created, not the moment the page loaded. The
 * same instant therefore reads differently on the two clocks, and an offset
 * measured in the worker is wrong by exactly that difference anywhere else.
 *
 * Server time on the main thread is `performance.now()` plus the value this
 * returns.
 */
export function combineWorkerOffset(
  offsetMs: number,
  workerTimeOrigin: number,
  mainTimeOrigin: number,
): number {
  return offsetMs + mainTimeOrigin - workerTimeOrigin;
}
