/**
 * Jitter estimation and the interpolation delay it drives.
 *
 * The estimator is pure — every timestamp is a parameter — so these traces are
 * exact rather than timing-dependent.
 */
import { describe, expect, it } from 'vitest';
import { JitterEstimator } from '../src/math/jitter.js';

/** Feed a run of arrivals at `interval` ms, perturbed by `offsets`. */
function feed(
  estimator: JitterEstimator,
  sendRateHz: number,
  offsets: number[],
  startAt = 1000,
): void {
  const interval = 1000 / sendRateHz;
  let arrival = startAt;

  for (const offset of offsets) {
    arrival += interval + offset;
    estimator.addSample(arrival, sendRateHz);
  }
}

describe('JitterEstimator', () => {
  it('reports the floor before it has seen anything', () => {
    // One send interval of buffer is the minimum that leaves two samples to
    // interpolate between; below it every frame extrapolates.
    const estimator = new JitterEstimator();
    expect(estimator.delayFor(30)).toBeCloseTo(1000 / 30 + 20, 6);
  });

  it('stays near the floor on a perfectly regular trace', () => {
    const estimator = new JitterEstimator();
    feed(estimator, 30, new Array(40).fill(0));

    const floor = 1000 / 30 + 20;
    expect(estimator.delayFor(30)).toBeCloseTo(floor, 1);
  });

  it('raises the delay when arrivals become irregular', () => {
    const steady = new JitterEstimator();
    feed(steady, 30, new Array(40).fill(0));

    const jittery = new JitterEstimator();
    // Alternating early/late by 30 ms — the classic sawtooth.
    feed(
      jittery,
      30,
      Array.from({ length: 40 }, (_unused, i) => (i % 2 === 0 ? 30 : -30)),
    );

    expect(jittery.delayFor(30)).toBeGreaterThan(steady.delayFor(30) + 20);
  });

  it('ignores a send-rate change — the property the design turns on', () => {
    // NetworkLODSystem lowers sendRateHz for distant entities. A naive
    // estimator would read the longer gaps as jitter and inflate the buffer
    // for exactly the entities that need it least.
    //
    // Time runs continuously across the change, as it does in life: the
    // helper's `startAt` is the last arrival, not a fresh epoch.
    const estimator = new JitterEstimator();
    feed(estimator, 30, new Array(30).fill(0));
    const before = estimator.jitterMs();
    const lastArrival = 1000 + 30 * (1000 / 30);

    // Same regularity, a sixth of the rate.
    feed(estimator, 5, new Array(30).fill(0), lastArrival);

    expect(estimator.jitterMs()).toBeCloseTo(before, 1);
  });

  it('never exceeds the ceiling', () => {
    const estimator = new JitterEstimator({ maxDelayMs: 120 });
    feed(
      estimator,
      30,
      Array.from({ length: 60 }, (_unused, i) => (i % 2 === 0 ? 400 : -400)),
    );

    expect(estimator.delayFor(30)).toBeLessThanOrEqual(120);
  });

  it('a single spike barely moves the buffer', () => {
    // Smoothing exists precisely so one late packet does not re-plan the
    // buffer; the delay should stay at its floor.
    const estimator = new JitterEstimator();
    let at = 1000;
    for (let i = 0; i < 20; i++) estimator.addSample((at += 1000 / 30), 30);
    const calm = estimator.delayFor(30);

    estimator.addSample((at += 1000 / 30 + 80), 30);

    expect(estimator.delayFor(30)).toBeCloseTo(calm, 1);
  });

  it('attacks fast and decays slowly on a sustained disturbance', () => {
    // Being a frame late beats stuttering, so the delay rises as soon as the
    // estimate does; it falls gradually, or a brief lull would starve the
    // buffer moments later.
    const estimator = new JitterEstimator();
    let at = 1000;
    for (let i = 0; i < 20; i++) estimator.addSample((at += 1000 / 30), 30);
    const calm = estimator.delayFor(30);

    // Sustained sawtooth — this is what genuinely needs more buffer.
    for (let i = 0; i < 40; i++) {
      at += 1000 / 30 + (i % 2 === 0 ? 60 : -60);
      estimator.addSample(at, 30);
    }
    const disturbed = estimator.delayFor(30);
    expect(disturbed).toBeGreaterThan(calm + 20);

    // A handful of clean samples must not erase it immediately.
    for (let i = 0; i < 3; i++) estimator.addSample((at += 1000 / 30), 30);
    expect(estimator.delayFor(30)).toBeGreaterThan(calm + 15);
  });

  it('treats the first sample as a baseline, not as jitter', () => {
    // There is no previous arrival to compare against, so the first sample
    // carries no information about variation.
    const estimator = new JitterEstimator();
    estimator.addSample(1000, 30);
    expect(estimator.jitterMs()).toBe(0);
  });

  it('discards a long gap as a discontinuity, not as jitter', () => {
    // An entity that left the interest radius and came back, a backgrounded
    // tab, a reconnect. Charging the estimate for the interruption would pin
    // the buffer at its ceiling for hundreds of samples after the event ended.
    const estimator = new JitterEstimator();
    feed(estimator, 30, new Array(30).fill(0));
    const before = estimator.jitterMs();

    estimator.addSample(60_000, 30); // ~58 seconds later
    expect(estimator.jitterMs()).toBeCloseTo(before, 6);

    // And it resumes from the new arrival rather than measuring against the
    // stale one, so the next sample is a normal interval.
    estimator.addSample(60_000 + 1000 / 30, 30);
    expect(estimator.jitterMs()).toBeLessThan(before + 1);
  });

  it('follows a send-rate change immediately, without waiting for decay', () => {
    // The interval is structural, not an estimate: a peer that just went from
    // 5 Hz to 60 Hz must stop being rendered a fifth of a second in the past
    // at once, not over the next fifty samples.
    const estimator = new JitterEstimator();
    expect(estimator.delayFor(5)).toBeCloseTo(200 + 20, 6);
    expect(estimator.delayFor(60)).toBeCloseTo(1000 / 60 + 20, 6);
  });

  it('ignores an out-of-order arrival rather than reading it as huge jitter', () => {
    const estimator = new JitterEstimator();
    feed(estimator, 30, new Array(20).fill(0));
    const before = estimator.jitterMs();

    estimator.addSample(0, 30); // a stamp from before the run started
    expect(estimator.jitterMs()).toBeCloseTo(before, 6);
  });
});
