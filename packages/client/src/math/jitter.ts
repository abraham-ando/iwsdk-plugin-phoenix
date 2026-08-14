/**
 * How much buffer an entity's samples need, measured rather than guessed.
 *
 * `NetworkInterpolationSystem` renders at `now - delay` so that playback sits
 * between two samples it already holds. A fixed delay has to be set for the
 * worst connection anyone might have, which taxes everyone else: 100 ms of
 * presentation lag on a local network buys nothing at all.
 *
 * Pure, like `clock-sync.ts` — every timestamp is a parameter. That is not
 * only for tests: it leaves the door open to feeding this server-stamped
 * arrival times later without changing anything but the caller.
 */

export interface JitterEstimatorOptions {
  /**
   * How many jitter estimates of headroom to add. Two covers the great
   * majority of a normal arrival distribution without over-buffering.
   */
  safetyFactor?: number;
  /**
   * Headroom above one send interval, in milliseconds. Absorbs the render
   * loop's own scheduling, which is not network jitter but costs the same.
   */
  floorMarginMs?: number;
  /** Never buffer beyond this. Past it, motion is stale enough to notice. */
  maxDelayMs?: number;
  /**
   * Smoothing divisor for the jitter estimate. 16 is RFC 3550's value for
   * RTP, which faces this exact problem.
   */
  smoothing?: number;
  /** How fast the delay is allowed to fall, as a fraction per sample. */
  decayRate?: number;
  /**
   * A gap this many times the expected interval is a discontinuity, not
   * jitter, and is discarded.
   *
   * An entity leaving the interest radius and returning, a tab that was
   * backgrounded, a reconnect — all produce a gap of seconds. Feeding one to
   * the estimator would inflate the buffer to its ceiling and hold it there
   * for hundreds of samples, punishing an entity for an event that has already
   * ended.
   */
  discontinuityFactor?: number;
}

export class JitterEstimator {
  private readonly safetyFactor: number;
  private readonly floorMarginMs: number;
  private readonly maxDelayMs: number;
  private readonly smoothing: number;
  private readonly decayRate: number;

  private readonly discontinuityFactor: number;

  private jitter = 0;
  private lastArrival: number | null = null;
  /**
   * Headroom above the send interval, in milliseconds.
   *
   * Tracked separately from the interval itself so the two can move at
   * different speeds: headroom absorbs jitter and decays slowly, while the
   * interval is structural and must follow a send-rate change at once.
   */
  private headroom: number | null = null;

  constructor(options: JitterEstimatorOptions = {}) {
    this.safetyFactor = options.safetyFactor ?? 2;
    this.floorMarginMs = options.floorMarginMs ?? 20;
    this.maxDelayMs = options.maxDelayMs ?? 250;
    this.smoothing = options.smoothing ?? 16;
    this.decayRate = options.decayRate ?? 0.05;
    this.discontinuityFactor = options.discontinuityFactor ?? 8;
  }

  /**
   * Record one sample's arrival.
   *
   * `sendRateHz` is what the *sender* is currently publishing at, which the
   * client knows because it is the value `NetworkLODSystem` writes. Comparing
   * against the interval that rate implies is what keeps a LOD change from
   * reading as jitter: when the rate drops, the expected gap drops with it and
   * the measured deviation stays where it was.
   */
  addSample(arrivalMs: number, sendRateHz: number): void {
    const previous = this.lastArrival;
    this.lastArrival = arrivalMs;

    // Nothing to compare against yet — a first sample carries no information
    // about variation, only about position in time.
    if (previous === null) return;

    const actual = arrivalMs - previous;
    // Out of order, or a clock that moved. Either way it is not a measurement
    // of jitter, and treating it as one would spike the buffer for seconds.
    if (actual < 0) {
      this.lastArrival = previous;
      return;
    }

    const expected = intervalFor(sendRateHz);

    // A gap of many intervals is a discontinuity — an entity that left the
    // interest radius, a backgrounded tab, a reconnect — not a measurement of
    // how variable this stream is. Resume from the new arrival without
    // charging the estimate for the interruption.
    if (actual > expected * this.discontinuityFactor) return;

    const deviation = Math.abs(actual - expected);
    this.jitter += (deviation - this.jitter) / this.smoothing;
  }

  /** Current smoothed jitter estimate, in milliseconds. */
  jitterMs(): number {
    return this.jitter;
  }

  /**
   * The delay to render behind by, for a peer publishing at `sendRateHz`.
   *
   * The floor is derived, not configured: one send interval is the least that
   * leaves two samples to interpolate between, and anything below it
   * extrapolates on every frame — which is precisely what the delay exists to
   * avoid.
   *
   * Rises immediately and falls gradually. Being a frame late is invisible;
   * stuttering is not, so a brief lull must not be allowed to starve the
   * buffer moments later.
   */
  delayFor(sendRateHz: number): number {
    const interval = intervalFor(sendRateHz);
    const targetHeadroom = Math.max(
      this.floorMarginMs,
      this.safetyFactor * this.jitter,
    );

    if (this.headroom === null || targetHeadroom >= this.headroom) {
      this.headroom = targetHeadroom;
    } else {
      this.headroom += (targetHeadroom - this.headroom) * this.decayRate;
    }

    // The interval is added *after* the decay, not smoothed with it: a
    // send-rate change is structural, and a peer that just went from 5 Hz to
    // 60 Hz should stop being rendered a fifth of a second in the past
    // immediately, not over the next fifty samples.
    return Math.min(interval + this.headroom, this.maxDelayMs);
  }
}

/** Milliseconds between sends at a given rate; guards a zero or absent rate. */
function intervalFor(sendRateHz: number): number {
  return sendRateHz > 0 ? 1000 / sendRateHz : 1000 / 30;
}
