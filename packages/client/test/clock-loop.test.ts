/**
 * The client half of clock synchronization, from the socket up.
 *
 * `sendPing` is where the two local timestamps are taken, and taking them
 * anywhere else is the failure this covers: a stamp read after a busy caller
 * finally gets around to it measures that caller, not the network.
 */
import { describe, expect, it } from 'vitest';
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
