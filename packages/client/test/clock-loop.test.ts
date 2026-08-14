/**
 * The client half of clock synchronization, from the socket up.
 *
 * `sendPing` is where the two local timestamps are taken, and taking them
 * anywhere else is the failure this covers: a stamp read after a busy caller
 * finally gets around to it measures that caller, not the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockLoop } from '../src/transport/clock-loop.js';
import type { ClockReading } from '../src/transport/clock-loop.js';
import { PhoenixConnection } from '../src/transport/PhoenixConnection.js';
import type {
  ChannelLike,
  PushLike,
  SocketFactory,
} from '../src/transport/PhoenixConnection.js';
import { BinaryProtocol } from '../src/protocol/BinaryProtocol.js';
import { OpCode } from '../src/protocol/opcodes.js';

/** A recorded outbound push, with the reply left in the test's hands. */
interface RecordedPush {
  payload: unknown;
  reply(response: unknown): void;
}

/**
 * A socket whose channel joins successfully and records every later push.
 *
 * Unlike the identity tests' factory, this one has to tell join from push: a
 * ping's reply is the thing under test, so it cannot be the canned join reply.
 */
function recordingSocketFactory(pushes: RecordedPush[]): SocketFactory {
  const joinPush: PushLike = {
    receive(status, callback) {
      if (status === 'ok') callback({ peer_id: 'alice', network_id: 1 });
      return joinPush;
    },
  };

  const channel: ChannelLike = {
    join: () => joinPush,
    leave: () => joinPush,
    on: () => 0,
    push(_event, payload) {
      let onOk: ((response?: unknown) => void) | null = null;
      pushes.push({ payload, reply: (response) => onOk?.(response) });

      const push: PushLike = {
        receive(status, callback) {
          if (status === 'ok') onOk = callback;
          return push;
        },
      };
      return push;
    },
    onError: () => {},
    onClose: () => {},
  };

  return () => ({
    connect: () => {},
    disconnect: () => {},
    channel: () => channel,
    onError: () => {},
    onClose: () => {},
    onOpen: () => {},
  });
}

async function connected(): Promise<{
  connection: PhoenixConnection;
  pushes: RecordedPush[];
}> {
  const pushes: RecordedPush[] = [];
  const connection = new PhoenixConnection(
    {
      onFrame: () => {},
      onPeerJoin: () => {},
      onPeerLeave: () => {},
      onState: () => {},
      onError: () => {},
    },
    recordingSocketFactory(pushes),
  );

  await connection.connect('ws://localhost/socket', { roomId: 'lobby' });
  return { connection, pushes };
}

describe('sendPing', () => {
  it('pushes a PING and hands the reply back with both local stamps', async () => {
    const { connection, pushes } = await connected();

    let got: { frame: ArrayBuffer | null; t0: number; t3: number } | null = null;
    connection.sendPing((frame, t0, t3) => {
      got = { frame, t0, t3 };
    });

    const sent = pushes.at(-1)!;
    const ping = BinaryProtocol.decode(sent.payload as ArrayBuffer);
    if (ping.opCode !== OpCode.PING) throw new Error('not a ping');

    const pong = BinaryProtocol.encodePong(ping.timestamp, 5, 6, 42);
    sent.reply(pong);

    expect(got).not.toBeNull();
    expect(got!.frame).toBe(pong);
    // The stamp on the wire IS the local stamp handed back — that identity is
    // what lets the caller match a reply to the ping it sent.
    expect(got!.t0).toBe(ping.timestamp);
    expect(got!.t3).toBeGreaterThanOrEqual(got!.t0);
  });

  it('reports a non-binary reply as null so the caller can drop it', async () => {
    const { connection, pushes } = await connected();

    let frame: ArrayBuffer | null = new ArrayBuffer(1);
    connection.sendPing((f) => {
      frame = f;
    });
    pushes.at(-1)!.reply({ unexpected: true });

    expect(frame).toBeNull();
  });

  it('does nothing when disconnected', async () => {
    const { connection, pushes } = await connected();
    connection.disconnect();

    const before = pushes.length;
    connection.sendPing(() => {
      throw new Error('should not have been called');
    });

    expect(pushes.length).toBe(before);
  });
});

describe('ClockLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A `sendPing` stub that answers every ping synchronously. */
  function answering(t1 = 5, t2 = 6, epoch = 42) {
    let count = 0;
    const sendPing = (
      onPong: (frame: ArrayBuffer | null, t0: number, t3: number) => void,
    ): void => {
      count += 1;
      const t0 = count * 1000;
      onPong(BinaryProtocol.encodePong(t0, t1, t2, epoch), t0, t0 + 40);
    };
    return { sendPing, sent: () => count };
  }

  it('bursts four pings 250 ms apart, then cruises every 2 s', () => {
    const { sendPing, sent } = answering();
    const loop = new ClockLoop({ sendPing, onReading: () => {} });

    loop.start();
    expect(sent()).toBe(1); // the first goes out immediately

    vi.advanceTimersByTime(750);
    expect(sent()).toBe(4); // burst complete: a usable offset within a second

    vi.advanceTimersByTime(2000);
    expect(sent()).toBe(5); // cruising

    loop.stop();
    vi.advanceTimersByTime(10_000);
    expect(sent()).toBe(5); // stopped means stopped
  });

  it('publishes a reading with offset, rtt and epoch from a full pong', () => {
    const readings: ClockReading[] = [];
    // t0 = 1000, uplink 20 ms, true offset 500.
    const { sendPing } = answering(500 + 1020, 500 + 1020.1, 7);
    const loop = new ClockLoop({ sendPing, onReading: (r) => readings.push(r) });

    loop.start();
    loop.stop();

    expect(readings.length).toBe(1);
    const reading = readings[0]!;
    expect(reading.epoch).toBe(7);
    expect(reading.offsetMs).toBeCloseTo(500, 0);
    expect(reading.rttMs).toBeGreaterThan(0);
  });

  it('a 9-byte pong from an old server yields an RTT-only reading', () => {
    const readings: ClockReading[] = [];
    const loop = new ClockLoop({
      sendPing: (onPong) => onPong(BinaryProtocol.encodePing(1000, true), 1000, 1040),
      onReading: (r) => readings.push(r),
    });

    loop.start();
    loop.stop();

    expect(readings).toEqual([{ offsetMs: null, rttMs: 40, epoch: null }]);
  });

  it('drops a pong whose echoed t0 does not match the ping', () => {
    const readings: ClockReading[] = [];
    const loop = new ClockLoop({
      sendPing: (onPong) => onPong(BinaryProtocol.encodePong(999, 5, 6, 1), 1000, 1040),
      onReading: (r) => readings.push(r),
    });

    loop.start();
    loop.stop();

    expect(readings).toEqual([]);
  });

  it('drops a null frame', () => {
    const readings: ClockReading[] = [];
    const loop = new ClockLoop({
      sendPing: (onPong) => onPong(null, 1000, 1040),
      onReading: (r) => readings.push(r),
    });

    loop.start();
    loop.stop();

    expect(readings).toEqual([]);
  });

  it('survives a malformed reply without stopping', () => {
    const readings: ClockReading[] = [];
    const garbage = new ArrayBuffer(3);
    new DataView(garbage).setUint8(0, 200); // unknown opcode
    const loop = new ClockLoop({
      sendPing: (onPong) => onPong(garbage, 1000, 1040),
      onReading: (r) => readings.push(r),
    });

    expect(() => loop.start()).not.toThrow();
    loop.stop();
    expect(readings).toEqual([]);
  });

  it('start is idempotent: a second call does not double the cadence', () => {
    const { sendPing, sent } = answering();
    const loop = new ClockLoop({ sendPing, onReading: () => {} });

    loop.start();
    loop.start();
    expect(sent()).toBe(1);

    vi.advanceTimersByTime(250);
    expect(sent()).toBe(2);

    loop.stop();
  });
});
