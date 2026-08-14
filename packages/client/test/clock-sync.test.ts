import { describe, expect, it } from 'vitest';
import {
  ClockSyncEstimator,
  SlewedOffset,
  combineWorkerOffset,
} from '../src/math/clock-sync.js';

/**
 * Build one exchange with a known true offset and chosen one-way delays.
 *
 * The estimator can only ever recover the offset exactly when the two
 * directions are symmetric; every asymmetric case below is there to check the
 * error stays inside the bound the design claims, not that it vanishes.
 */
function sample(trueOffset: number, up: number, down: number, t0: number, epoch = 1) {
  const t1 = t0 + up + trueOffset;
  const t2 = t1 + 0.1; // negligible server processing
  const t3 = t0 + up + 0.1 + down;
  return { t0, t1, t2, t3, epoch };
}

describe('ClockSyncEstimator', () => {
  it('recovers the true offset exactly from a symmetric sample', () => {
    const e = new ClockSyncEstimator();
    e.addSample(sample(500, 20, 20, 1000));
    expect(e.estimate()!.offsetMs).toBeCloseTo(500, 6);
    expect(e.estimate()!.rttMs).toBeCloseTo(40, 6);
  });

  it('prefers the min-RTT sample: queue spikes never displace a clean one', () => {
    const e = new ClockSyncEstimator();
    e.addSample(sample(500, 20, 20, 1000)); // clean, rtt 40
    e.addSample(sample(500, 20, 180, 3000)); // downlink queue spike, rtt 200
    e.addSample(sample(500, 150, 25, 5000)); // uplink spike, rtt 175
    const est = e.estimate()!;
    expect(est.rttMs).toBeCloseTo(40, 6);
    expect(Math.abs(est.offsetMs - 500)).toBeLessThanOrEqual(est.rttMs / 2);
  });

  it('bounds the error by rtt_min/2 on a realistic asymmetric trace', () => {
    const e = new ClockSyncEstimator();
    // Base 15 ms each way; every third sample hits a 60-120 ms one-way queue.
    for (let i = 0; i < 24; i++) {
      const spike = i % 3 === 2 ? 60 + (i % 5) * 15 : 0;
      const up = 15 + (i % 2 === 0 ? spike : 0);
      const down = 15 + (i % 2 === 1 ? spike : 0);
      e.addSample(sample(-250, up, down, i * 2000));
    }
    const est = e.estimate()!;
    expect(Math.abs(est.offsetMs - -250)).toBeLessThanOrEqual(est.rttMs / 2);
  });

  it('an epoch change discards the window', () => {
    const e = new ClockSyncEstimator();
    e.addSample(sample(500, 10, 10, 1000, 1));
    e.addSample(sample(-9000, 10, 10, 3000, 2)); // server restarted
    const est = e.estimate()!;
    expect(est.epoch).toBe(2);
    expect(est.offsetMs).toBeCloseTo(-9000, 6);
  });

  it('rejects a sample whose rtt comes out negative', () => {
    const e = new ClockSyncEstimator();
    e.addSample({ t0: 100, t1: 0, t2: 500, t3: 110, epoch: 1 }); // t2-t1 > t3-t0
    expect(e.estimate()).toBeNull();
  });

  it('window is bounded: the 9th sample evicts the 1st', () => {
    const e = new ClockSyncEstimator();
    e.addSample(sample(500, 1, 1, 0)); // rtt 2 - best, but about to be evicted
    for (let i = 1; i <= 8; i++) e.addSample(sample(500, 10 + i, 10 + i, i * 2000));
    expect(e.estimate()!.rttMs).toBeGreaterThan(2.2);
  });

  it('has nothing to say before its first sample', () => {
    expect(new ClockSyncEstimator().estimate()).toBeNull();
  });
});

describe('SlewedOffset', () => {
  const est = (offsetMs: number, epoch = 1) => ({ offsetMs, rttMs: 40, epoch });

  it('snaps on the first update', () => {
    const s = new SlewedOffset();
    expect(s.update(est(500), 0)).toBe(500);
  });

  it('moves toward a new target at most maxSlew per second', () => {
    const s = new SlewedOffset(120);
    s.update(est(500), 0);
    expect(s.update(est(1000), 1000)).toBeCloseTo(620, 6); // one second: +120 max
    expect(s.update(est(1000), 1500)).toBeCloseTo(680, 6); // half second: +60
  });

  it('never overshoots the target', () => {
    const s = new SlewedOffset(120);
    s.update(est(500), 0);
    expect(s.update(est(505), 1000)).toBe(505);
  });

  it('slews downward as well as up', () => {
    const s = new SlewedOffset(120);
    s.update(est(1000), 0);
    expect(s.update(est(0), 1000)).toBeCloseTo(880, 6);
  });

  it('snaps on an epoch change', () => {
    // Not merely stale: after a restart the old value describes a clock that
    // no longer exists, so easing toward the new one would be easing through
    // a range of meaningless values.
    const s = new SlewedOffset();
    s.update(est(500, 1), 0);
    expect(s.update(est(-9000, 2), 100)).toBe(-9000);
  });
});

describe('combineWorkerOffset', () => {
  it('folds the timeOrigin difference into the worker-measured offset', () => {
    // The invariant that matters: a main-thread reader adding the combined
    // offset to its own clock must land on the same server instant the worker
    // would have computed.
    const mainTimeOrigin = 1_700_000_000_000;
    const workerTimeOrigin = 1_700_000_003_000; // worker created 3 s later
    const combined = combineWorkerOffset(500, workerTimeOrigin, mainTimeOrigin);

    const nowMain = 10_000;
    const nowWorker = nowMain + (mainTimeOrigin - workerTimeOrigin);
    expect(nowMain + combined).toBeCloseTo(nowWorker + 500, 6);
  });

  it('is the identity when both clocks share an origin', () => {
    expect(combineWorkerOffset(500, 1_700_000_000_000, 1_700_000_000_000)).toBe(500);
  });
});
