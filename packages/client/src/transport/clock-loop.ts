/**
 * Ping cadence and sample intake, running wherever the socket does.
 *
 * Burst on connect so an offset exists within about a second, then cruise: the
 * estimator's window covers roughly sixteen seconds at that rate, which is far
 * shorter than any interval over which real clocks drift meaningfully. The
 * whole thing costs 29 bytes every two seconds.
 *
 * Design: `docs/superpowers/specs/2026-08-14-clock-sync-design.md`.
 */
import { ClockSyncEstimator } from '../math/clock-sync.js';
import { BinaryProtocol } from '../protocol/BinaryProtocol.js';
import { OpCode } from '../protocol/opcodes.js';

/** What the loop publishes after each exchange it accepts. */
export interface ClockReading {
  /**
   * Offset in milliseconds, or `null` when the server answered with a legacy
   * 9-byte PONG. Null is a real answer — "this peer cannot be synced" — and
   * not the same as no reading at all, which means the sample was dropped.
   */
  offsetMs: number | null;
  rttMs: number;
  epoch: number | null;
}

export interface ClockLoopOptions {
  /** Usually {@link PhoenixConnection.sendPing}, bound to a connection. */
  sendPing(
    onPong: (frame: ArrayBuffer | null, t0: number, t3: number) => void,
  ): void;
  onReading(reading: ClockReading): void;
  burstCount?: number;
  burstIntervalMs?: number;
  cruiseIntervalMs?: number;
}

export class ClockLoop {
  private readonly estimator = new ClockSyncEstimator();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sentInBurst = 0;
  private running = false;

  constructor(private readonly options: ClockLoopOptions) {}

  /** Begin (or resume) pinging. Calling this while running does nothing. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.sentInBurst = 0;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (!this.running) return;

    this.options.sendPing((frame, t0, t3) => this.handlePong(frame, t0, t3));
    this.sentInBurst += 1;

    const {
      burstCount = 4,
      burstIntervalMs = 250,
      cruiseIntervalMs = 2000,
    } = this.options;

    const delay =
      this.sentInBurst < burstCount ? burstIntervalMs : cruiseIntervalMs;
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private handlePong(frame: ArrayBuffer | null, t0: number, t3: number): void {
    if (!frame) return;

    let decoded;
    try {
      decoded = BinaryProtocol.decode(frame);
    } catch {
      // A malformed reply is a dropped sample, never a stopped loop: the next
      // ping is 250 ms away and recovery costs nothing.
      return;
    }

    if (decoded.opCode !== OpCode.PONG) return;

    // The echo check. A reply that does not carry back the exact timestamp we
    // sent belongs to some other exchange, and pairing it with our `t3` would
    // manufacture a delay that never happened.
    if (decoded.timestamp !== t0) return;

    if (!decoded.pong) {
      // A server without clock sync. RTT is still meaningful, so report it and
      // let the consumer decide; the alternative is silence, which looks
      // identical to a broken connection.
      this.options.onReading({ offsetMs: null, rttMs: t3 - t0, epoch: null });
      return;
    }

    const { t1, t2, epoch } = decoded.pong;
    this.estimator.addSample({ t0, t1, t2, t3, epoch });

    const estimate = this.estimator.estimate();
    if (estimate) this.options.onReading(estimate);
  }
}
