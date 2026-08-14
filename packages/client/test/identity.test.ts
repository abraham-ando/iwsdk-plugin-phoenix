/**
 * How a client learns its own wire identity.
 *
 * The server allocates a numeric network id and returns it in the channel join
 * reply. Until that value reaches the render thread an application cannot mark
 * a single entity as its own, so the whole replication path is dead — which is
 * exactly the failure these tests exist to prevent, because it is silent: the
 * session connects, frames flow outbound with id 0, and nothing errors.
 */
import { describe, expect, it } from 'vitest';
import { World } from './mocks/iwsdk-core.js';
import { Transform } from './mocks/iwsdk-core.js';
import { LoopbackNetwork } from '../src/adapters/LoopbackAdapter.js';
import { OfflineAdapter } from '../src/adapters/OfflineAdapter.js';
import { PhoenixConnection } from '../src/transport/PhoenixConnection.js';
import type {
  ChannelLike,
  PushLike,
  SocketFactory,
} from '../src/transport/PhoenixConnection.js';
import { installPhoenixNetworking } from '../src/plugin.js';
import { PhoenixNetworkSystem } from '../src/systems/PhoenixNetworkSystem.js';
import type { ConnectionState, INetworkAdapter } from '../src/interfaces/INetworkAdapter.js';

// -----------------------------------------------------------------------------
// A fake Phoenix socket whose join reply we control.
// -----------------------------------------------------------------------------

function fakeSocketFactory(joinReply: unknown): SocketFactory {
  const push: PushLike = {
    receive(status, callback) {
      if (status === 'ok') callback(joinReply);
      return push;
    },
  };

  const channel: ChannelLike = {
    join: () => push,
    leave: () => push,
    on: () => 0,
    push: () => push,
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

/**
 * `PhoenixConnection` wires up `Presence`, which needs a real channel. Presence
 * failure is deliberately non-fatal, so these tests let it fail and assert on
 * the identity that the join reply carries regardless.
 */
async function connectWith(joinReply: unknown): Promise<PhoenixConnection> {
  const connection = new PhoenixConnection(
    {
      onFrame: () => {},
      onPeerJoin: () => {},
      onPeerLeave: () => {},
      onState: () => {},
      onError: () => {},
    },
    fakeSocketFactory(joinReply),
  );

  await connection.connect('ws://localhost/socket', { roomId: 'lobby' });
  return connection;
}

describe('PhoenixConnection identity', () => {
  it('takes the network id from the join reply', async () => {
    const connection = await connectWith({ peer_id: 'alice', network_id: 7 });

    expect(connection.peerId).toBe('alice');
    expect(connection.networkId).toBe(7);
  });

  it('reports 0 when the server omits the id', async () => {
    // An older server, or one wired to a custom channel. Better to replicate
    // nothing than to replicate under an id someone else also owns.
    const connection = await connectWith({ peer_id: 'alice' });

    expect(connection.networkId).toBe(0);
  });

  it('rejects a non-integer id rather than passing it on', async () => {
    const connection = await connectWith({ peer_id: 'alice', network_id: '7' });

    expect(connection.networkId).toBe(0);
  });

  it('has the identity in place before it announces the connection', async () => {
    // Ordering matters: the natural way to use this is to stamp your entities
    // when the state turns 'connected'. If the id landed after the callback,
    // that idiom would read 0 exactly once — on the frame that matters.
    const seen: { state: ConnectionState; networkId: number }[] = [];

    const connection = new PhoenixConnection(
      {
        onFrame: () => {},
        onPeerJoin: () => {},
        onPeerLeave: () => {},
        onState: (state) => seen.push({ state, networkId: connection.networkId }),
        onError: () => {},
      },
      fakeSocketFactory({ peer_id: 'alice', network_id: 42 }),
    );

    await connection.connect('ws://localhost/socket');

    expect(seen.find((entry) => entry.state === 'connected')?.networkId).toBe(42);
  });

  it('clears the identity on disconnect', async () => {
    const connection = await connectWith({ peer_id: 'alice', network_id: 7 });

    connection.disconnect();

    expect(connection.networkId).toBe(0);
    expect(connection.peerId).toBe('');
  });
});

// -----------------------------------------------------------------------------
// Adoption by the system.
// -----------------------------------------------------------------------------

/** Minimal adapter whose id and state the test drives by hand. */
class ScriptedAdapter implements INetworkAdapter {
  networkId = 0;
  peerId = '';
  state: ConnectionState = 'disconnected';

  private readonly stateListeners = new Set<(state: ConnectionState) => void>();

  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): void {}
  send(): void {}
  broadcast(): void {}
  onMessage(): () => void {
    return () => {};
  }
  onPeerJoin(): () => void {
    return () => {};
  }
  onPeerLeave(): () => void {
    return () => {};
  }
  onStateChange(callback: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  /** Pretend the server answered the join. */
  assign(networkId: number, state: ConnectionState = 'connected'): void {
    this.networkId = networkId;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }
}

function makeWorld(adapter: INetworkAdapter) {
  const world = new World({ entityCapacity: 64, checksOn: false });
  world.registerComponent(Transform);
  installPhoenixNetworking(world as never, { adapter, autoConnect: false });
  return world;
}

/** See replication.test.ts: elics' `World` is narrower than IWSDK's. */
const systemOf = (world: World): PhoenixNetworkSystem =>
  (world as unknown as { getSystem(cls: unknown): unknown }).getSystem(
    PhoenixNetworkSystem,
  ) as PhoenixNetworkSystem;

describe('PhoenixNetworkSystem identity adoption', () => {
  it('adopts an id assigned after the system started', () => {
    const adapter = new ScriptedAdapter();
    const system = systemOf(makeWorld(adapter));

    expect(system.localOwnerId).toBe(0);

    adapter.assign(9);

    expect(system.localOwnerId).toBe(9);
  });

  it('adopts an id that was already assigned before install', () => {
    // Installing the plugin after `await net.ready` is a perfectly reasonable
    // ordering, and there is no state change left to listen for at that point.
    const adapter = new ScriptedAdapter();
    adapter.networkId = 4;
    adapter.state = 'connected';

    expect(systemOf(makeWorld(adapter)).localOwnerId).toBe(4);
  });

  it('keeps the last known id while the socket is reconnecting', () => {
    // A dropped socket reports 0 until it re-joins. Forgetting our identity in
    // the meantime would make every ownership grant that lands on reconnect
    // look like it was addressed to a different peer.
    const adapter = new ScriptedAdapter();
    const system = systemOf(makeWorld(adapter));

    adapter.assign(9);
    adapter.assign(0, 'reconnecting');

    expect(system.localOwnerId).toBe(9);
  });

  it('takes the new id when a reconnect assigns a different one', () => {
    const adapter = new ScriptedAdapter();
    const system = systemOf(makeWorld(adapter));

    adapter.assign(9);
    adapter.assign(0, 'reconnecting');
    adapter.assign(11);

    expect(system.localOwnerId).toBe(11);
  });

  it('leaves the id at 0 for a transport that has no server', () => {
    // OfflineAdapter has no one to assign an id, and must not be forced to
    // invent one just to satisfy the interface.
    expect(systemOf(makeWorld(new OfflineAdapter())).localOwnerId).toBe(0);
  });
});

describe('LoopbackNetwork identity', () => {
  it('allocates distinct ids the way the room does', () => {
    const network = new LoopbackNetwork();

    expect(network.createPeer('alice').networkId).toBe(1);
    expect(network.createPeer('bob').networkId).toBe(2);
  });

  it('honours an explicit id', () => {
    const network = new LoopbackNetwork();

    expect(network.createPeer('alice', 100).networkId).toBe(100);
  });
});

describe('join params', () => {
  it('forwards application params into the channel join', async () => {
    // Without this the server-side room options a client can reach are only
    // the ones the plugin happens to model — `persistent: true` for a sector
    // that keeps its world would be unreachable from the public API.
    let seen: Record<string, unknown> | null = null;

    const push: PushLike = {
      receive(status, callback) {
        if (status === 'ok') callback({ peer_id: 'alice', network_id: 1 });
        return push;
      },
    };

    const channel: ChannelLike = {
      join: () => push,
      leave: () => push,
      on: () => 0,
      push: () => push,
      onError: () => {},
      onClose: () => {},
    };

    const connection = new PhoenixConnection(
      {
        onFrame: () => {},
        onPeerJoin: () => {},
        onPeerLeave: () => {},
        onState: () => {},
        onError: () => {},
      },
      () => ({
        connect: () => {},
        disconnect: () => {},
        channel: (_topic, params) => {
          seen = params as Record<string, unknown>;
          return channel;
        },
        onError: () => {},
        onClose: () => {},
        onOpen: () => {},
      }),
    );

    await connection.connect('ws://localhost/socket', {
      roomId: 'northmarch',
      params: { persistent: true },
    });

    expect(seen).not.toBeNull();
    expect(seen!.persistent).toBe(true);
    // And the params the plugin models itself are still there.
    expect(seen!.mode).toBe('host_relayed');
  });
});
