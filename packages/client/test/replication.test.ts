/**
 * End-to-end replication tests.
 *
 * These run against the genuine `elics` runtime (see test/mocks/iwsdk-core.ts),
 * so component storage, queries and system scheduling behave exactly as they do
 * inside IWSDK — only the renderer is absent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Transform, World } from './mocks/iwsdk-core.js';
import type { Entity } from './mocks/iwsdk-core.js';
import { LoopbackNetwork } from '../src/adapters/LoopbackAdapter.js';
import { OfflineAdapter } from '../src/adapters/OfflineAdapter.js';
import {
  NetworkInput,
  NetworkStats,
  Networked,
  NetworkedTransform,
} from '../src/components/index.js';
import { installPhoenixNetworking } from '../src/plugin.js';
import { ClientPredictionSystem } from '../src/systems/ClientPredictionSystem.js';
import { PhoenixNetworkSystem } from '../src/systems/PhoenixNetworkSystem.js';
import type { INetworkAdapter } from '../src/interfaces/INetworkAdapter.js';
import { BinaryProtocol } from '../src/protocol/BinaryProtocol.js';

/** Simulated clock driving both `performance.now()` and the loopback bus. */
let clock = 0;

beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a world with the plugin installed against a specific adapter. */
function makeWorld(adapter: INetworkAdapter, overrides: Record<string, unknown> = {}) {
  const world = new World({ entityCapacity: 256, checksOn: false });
  world.registerComponent(Transform);

  const handle = installPhoenixNetworking(world as never, {
    adapter,
    autoConnect: false,
    ...overrides,
  });

  return { world, handle };
}

/** Create a replicated entity. */
function makeEntity(
  world: World,
  options: {
    networkId: number;
    isLocalOwner: boolean;
    position?: [number, number, number];
    withInput?: boolean;
  },
): Entity {
  const entity = world.createEntity();
  entity.addComponent(Transform);
  entity.addComponent(Networked);
  entity.addComponent(NetworkedTransform);
  if (options.withInput) entity.addComponent(NetworkInput);

  entity.setValue(Networked, 'networkId', options.networkId);
  entity.setValue(Networked, 'isLocalOwner', options.isLocalOwner);

  if (options.position) {
    const view = entity.getVectorView(Transform, 'position');
    view.set(options.position);
  }

  return entity;
}

const positionOf = (entity: Entity): number[] =>
  Array.from(entity.getVectorView(Transform, 'position'));

/**
 * The systems are typed against IWSDK's `World`, which extends the elics
 * `World` these tests run on with renderer, XR and input handles the systems
 * never touch. Narrowing here keeps that gap visible and localized instead of
 * loosening the types in `src`.
 */
interface LooseWorld {
  getSystem(systemClass: unknown): unknown;
  hasSystem(systemClass: unknown): boolean;
}
const loose = (world: World): LooseWorld => world as unknown as LooseWorld;

describe('offline mode', () => {
  it('registers every system and publishes nothing', () => {
    const adapter = new OfflineAdapter();
    const { world } = makeWorld(adapter, { isOffline: true });

    const entity = makeEntity(world, { networkId: 1, isLocalOwner: true });
    entity.getVectorView(Transform, 'position').set([5, 0, 5]);

    for (let i = 0; i < 10; i++) world.update(1 / 90, clock / 1000);

    expect(adapter.sentFrameCount).toBe(0);
    // The local simulation is entirely undisturbed.
    expect(positionOf(entity)).toEqual([5, 0, 5]);
    expect(loose(world).hasSystem(PhoenixNetworkSystem)).toBe(true);
  });
});

/**
 * Inbound replication.
 *
 * These use a *single* world plus a bare peer that injects frames onto the bus.
 * Two `World` instances cannot be used here: elics keeps `component.data` on
 * the component singleton, so registering the same component in a second world
 * re-points both worlds at the same typed arrays and entity index 0 in one
 * world silently aliases entity index 0 in the other.
 */
describe('inbound replication', () => {
  /** World with one remotely-owned replica, plus a peer that feeds it frames. */
  function scenario(latencyMs = 0, networkId = 7) {
    const bus = new LoopbackNetwork(latencyMs);
    const local = bus.createPeer('local');
    const remote = bus.createPeer('remote');

    const { world } = makeWorld(local);
    void local.connect('memory://');
    void remote.connect('memory://');

    const replica = makeEntity(world, {
      networkId,
      isLocalOwner: false,
      position: [0, 0, 0],
    });

    const publish = (x: number, y = 0, z = 0) =>
      remote.send(
        BinaryProtocol.encodeSnapshot(
          [
            {
              networkId,
              position: { x, y, z },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
            },
          ],
          0,
          false,
        ),
      );

    return { world, bus, replica, publish };
  }

  it('holds position until the frame actually arrives', () => {
    const { world, bus, replica, publish } = scenario(50);

    publish(10, 1, -4);

    // Still in flight after 20 ms of a 50 ms trip.
    bus.advance(20);
    world.update(1 / 90, 0);
    expect(positionOf(replica)).toEqual([0, 0, 0]);

    // Now it lands. The first sample seeds the replica in place rather than
    // sliding it in from the origin.
    bus.advance(40);
    world.update(1 / 90, 0);
    expect(positionOf(replica)).toEqual([10, 1, -4]);
  });

  it('interpolates between two samples instead of snapping', () => {
    const { world, bus, replica, publish } = scenario(0);

    // Sample 1 at t=1000.
    publish(0);
    bus.advance(0);
    world.update(1 / 90, 0);

    // Sample 2 at t=1100: 10 m away, 100 ms later.
    clock += 100;
    publish(10);
    bus.advance(0);
    world.update(1 / 90, 0);

    // The 100 ms interpolation delay puts render time at t=1050 when the clock
    // reads 1150 — exactly halfway between the two samples.
    clock += 50;
    world.update(1 / 90, 0);

    expect(positionOf(replica)[0]).toBeCloseTo(5, 4);
  });

  it('dead reckons a late packet, then holds at the extrapolation cap', () => {
    const { world, bus, replica, publish } = scenario(0);

    // Two samples 100 ms apart => 10 m/s along +X.
    publish(0);
    bus.advance(0);
    world.update(1 / 90, 0);

    clock += 100;
    publish(1);
    bus.advance(0);
    world.update(1 / 90, 0);

    // Starve it. Render time (t=1300) is 200 ms past the newest sample, inside
    // the 250 ms cap, so it keeps moving: 1 + 10 * 0.2 = 3.
    clock += 300;
    world.update(1 / 90, 0);
    expect(positionOf(replica)[0]).toBeCloseTo(3, 4);

    // Well past the cap, extrapolation saturates at 1 + 10 * 0.25 = 3.5 ...
    clock += 5000;
    world.update(1 / 90, 0);
    const capped = positionOf(replica)[0] as number;
    expect(capped).toBeCloseTo(3.5, 4);

    // ... and stays there rather than sliding away through the world forever.
    clock += 60000;
    world.update(1 / 90, 0);
    expect(positionOf(replica)[0]).toBeCloseTo(capped, 6);
  });

  it('ignores frames addressed to an entity this client owns', () => {
    // The owner's local simulation is ahead of anything echoed back; applying
    // it would undo client-side prediction.
    const bus = new LoopbackNetwork(0);
    const local = bus.createPeer('local');
    const remote = bus.createPeer('remote');
    const { world } = makeWorld(local);
    void local.connect('memory://');
    void remote.connect('memory://');

    const owned = makeEntity(world, {
      networkId: 9,
      isLocalOwner: true,
      position: [1, 2, 3],
    });

    remote.send(
      BinaryProtocol.encodeSnapshot([
        {
          networkId: 9,
          position: { x: 99, y: 99, z: 99 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ]),
    );
    bus.advance(0);
    world.update(1 / 90, 0);

    expect(positionOf(owned)).toEqual([1, 2, 3]);
  });

  it('survives a malformed frame without faulting the loop', () => {
    const bus = new LoopbackNetwork(0);
    const local = bus.createPeer('local');
    const remote = bus.createPeer('remote');
    const { world } = makeWorld(local);
    void local.connect('memory://');
    void remote.connect('memory://');

    makeEntity(world, { networkId: 1, isLocalOwner: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A SNAPSHOT header claiming 500 records but carrying none.
    const truncated = BinaryProtocol.encodeSnapshot([]);
    new DataView(truncated).setUint16(2, 500, true);
    remote.send(truncated);

    expect(() => {
      bus.advance(0);
      world.update(1 / 90, 0);
    }).not.toThrow();

    expect(warn).toHaveBeenCalled();
  });

  it('applies a quantized snapshot', () => {
    const { world, bus, replica } = scenario(0, 12);
    const bus2 = bus;

    // Re-publish through the quantized path.
    const remote = bus2.createPeer('remote2');
    void remote.connect('memory://');
    remote.send(
      BinaryProtocol.encodeSnapshot(
        [
          {
            networkId: 12,
            position: { x: 3, y: 4, z: 5 },
            rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
          },
        ],
        0,
        true,
      ),
    );
    bus2.advance(0);
    world.update(1 / 90, 0);

    expect(positionOf(replica)).toEqual([3, 4, 5]);
    const orientation = Array.from(replica.getVectorView(Transform, 'orientation'));
    expect(orientation[1]).toBeCloseTo(Math.SQRT1_2, 3);
  });
});

describe('rate limiting and change detection', () => {
  it('suppresses republishing an entity at rest', () => {
    const bus = new LoopbackNetwork(0);
    const alice = bus.createPeer('alice');
    const { world } = makeWorld(alice);
    void alice.connect('memory://');

    const entity = makeEntity(world, { networkId: 1, isLocalOwner: true });
    entity.getVectorView(Transform, 'position').set([1, 0, 0]);

    let sent = 0;
    const originalSend = alice.send.bind(alice);
    alice.send = (data: ArrayBuffer) => {
      sent++;
      originalSend(data);
    };

    // First tick publishes; subsequent ticks with no movement must not.
    world.update(1 / 90, 0);
    expect(sent).toBe(1);

    for (let i = 0; i < 20; i++) {
      clock += 100;
      world.update(1 / 90, 0);
    }
    expect(sent).toBe(1);

    // Moving republishes.
    clock += 100;
    entity.getVectorView(Transform, 'position').set([2, 0, 0]);
    world.update(1 / 90, 0);
    expect(sent).toBe(2);
  });

  it('republishes a pure rotation with no translation', () => {
    // Regression guard: a headset turning on the spot changes orientation only.
    const bus = new LoopbackNetwork(0);
    const alice = bus.createPeer('alice');
    const { world } = makeWorld(alice);
    void alice.connect('memory://');

    const entity = makeEntity(world, { networkId: 1, isLocalOwner: true });

    let sent = 0;
    const originalSend = alice.send.bind(alice);
    alice.send = (data: ArrayBuffer) => {
      sent++;
      originalSend(data);
    };

    world.update(1 / 90, 0);
    const baseline = sent;

    clock += 100;
    // 90 degrees about Y, position untouched.
    entity
      .getVectorView(Transform, 'orientation')
      .set([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    world.update(1 / 90, 0);

    expect(sent).toBe(baseline + 1);
  });

  it('honours per-entity send rate', () => {
    const bus = new LoopbackNetwork(0);
    const alice = bus.createPeer('alice');
    const { world } = makeWorld(alice, { networkLod: false });
    void alice.connect('memory://');

    const entity = makeEntity(world, { networkId: 1, isLocalOwner: true });
    entity.setValue(Networked, 'sendRateHz', 10); // one frame per 100 ms

    let sent = 0;
    const originalSend = alice.send.bind(alice);
    alice.send = (data: ArrayBuffer) => {
      sent++;
      originalSend(data);
    };

    // Move every tick over 100 ms of simulated time at 90 FPS.
    for (let i = 0; i < 9; i++) {
      clock += 11.1;
      entity.getVectorView(Transform, 'position').set([i, 0, 0]);
      world.update(1 / 90, 0);
    }

    // At 10 Hz across ~100 ms, far fewer than 9 frames go out.
    expect(sent).toBeLessThanOrEqual(2);
    expect(sent).toBeGreaterThan(0);
  });
});

describe('client prediction and reconciliation', () => {
  it('moves the player immediately, without waiting for the server', () => {
    const bus = new LoopbackNetwork(100);
    const alice = bus.createPeer('alice');
    const { world } = makeWorld(alice, {
      mode: 'server_authoritative',
      moveSpeed: 10,
    });
    void alice.connect('memory://');

    const player = makeEntity(world, {
      networkId: 1,
      isLocalOwner: true,
      withInput: true,
    });

    // Full forward stick.
    player.getVectorView(NetworkInput, 'movement').set([0, 1]);

    world.update(0.1, 0); // 100 ms at 10 m/s = 1 m forward (-Z)

    const [, , z] = positionOf(player);
    expect(z).toBeCloseTo(-1, 5);
  });

  it('replays unacknowledged input after a correction', () => {
    const bus = new LoopbackNetwork(0);
    const alice = bus.createPeer('alice');
    const { world } = makeWorld(alice, {
      mode: 'server_authoritative',
      moveSpeed: 10,
    });
    void alice.connect('memory://');

    const player = makeEntity(world, {
      networkId: 1,
      isLocalOwner: true,
      withInput: true,
    });
    player.getVectorView(NetworkInput, 'movement').set([0, 1]);

    // Three prediction steps of 100 ms each => 3 m forward.
    world.update(0.1, 0);
    world.update(0.1, 0);
    world.update(0.1, 0);
    expect(positionOf(player)[2]).toBeCloseTo(-3, 5);

    const prediction = loose(world).getSystem(ClientPredictionSystem) as ClientPredictionSystem;
    expect(prediction.pendingCount).toBe(3);

    // The server acknowledges only input #1 and disagrees: it says we were at
    // z = -0.5 rather than -1 (say, a wall clipped the move).
    prediction.reconcile(1, 1, { x: 0, y: 0, z: -0.5 });

    // Inputs 2 and 3 are replayed on top of the authoritative position.
    expect(prediction.pendingCount).toBe(2);
    expect(positionOf(player)[2]).toBeCloseTo(-2.5, 5);
  });

  it('leaves position untouched when the prediction was already correct', () => {
    const bus = new LoopbackNetwork(0);
    const alice = bus.createPeer('alice');
    const { world } = makeWorld(alice, {
      mode: 'server_authoritative',
      moveSpeed: 10,
    });
    void alice.connect('memory://');

    const player = makeEntity(world, {
      networkId: 1,
      isLocalOwner: true,
      withInput: true,
    });
    player.getVectorView(NetworkInput, 'movement').set([0, 1]);

    world.update(0.1, 0);
    world.update(0.1, 0);
    const before = positionOf(player);

    const prediction = loose(world).getSystem(ClientPredictionSystem) as ClientPredictionSystem;
    // Server agrees exactly with our own prediction after input #1.
    prediction.reconcile(1, 1, { x: 0, y: 0, z: -1 });

    expect(positionOf(player)).toEqual(before);
    expect(prediction.corrections).toBe(0);
    expect(prediction.correctionsIgnored).toBe(1);
  });

  it('bounds the pending input log', () => {
    const bus = new LoopbackNetwork(0);
    const alice = bus.createPeer('alice');
    const { world } = makeWorld(alice, { mode: 'server_authoritative' });
    void alice.connect('memory://');

    makeEntity(world, { networkId: 1, isLocalOwner: true, withInput: true });

    for (let i = 0; i < 1000; i++) world.update(1 / 90, 0);

    const prediction = loose(world).getSystem(ClientPredictionSystem) as ClientPredictionSystem;
    expect(prediction.pendingCount).toBeLessThanOrEqual(256);
  });
});

describe('telemetry', () => {
  it('mirrors counters onto a NetworkStats entity', () => {
    const bus = new LoopbackNetwork(0);
    const alice = bus.createPeer('alice');
    const { world } = makeWorld(alice);
    void alice.connect('memory://');

    const statsEntity = world.createEntity();
    statsEntity.addComponent(NetworkStats);

    const entity = makeEntity(world, { networkId: 1, isLocalOwner: true });
    entity.getVectorView(Transform, 'position').set([1, 2, 3]);
    world.update(1 / 90, 0);

    expect(statsEntity.getValue(NetworkStats, 'framesSent')).toBe(1);
    expect(statsEntity.getValue(NetworkStats, 'bytesSent')).toBeGreaterThan(0);
  });
});

describe('ownership transfer', () => {
  /** World plus a peer standing in for the server's arbitration. */
  function scenario() {
    const bus = new LoopbackNetwork(0);
    const local = bus.createPeer('local');
    const server = bus.createPeer('server');

    const { world } = makeWorld(local);
    void local.connect('memory://');
    void server.connect('memory://');

    const net = loose(world).getSystem(PhoenixNetworkSystem) as PhoenixNetworkSystem;
    net.localOwnerId = 42;

    // An object currently owned by someone else.
    const prop = makeEntity(world, { networkId: 100, isLocalOwner: false });

    return { world, bus, server, net, prop };
  }

  it('sends a request and does not claim ownership optimistically', () => {
    const { world, net, prop } = scenario();

    const requestId = net.requestOwnership(prop);

    expect(requestId).toBeGreaterThan(0);
    expect(net.pendingOwnershipCount).toBe(1);
    // Critical: two players grabbing at once would both predict success and
    // fight over the transform. Wait for the verdict instead.
    expect(prop.getValue(Networked, 'isLocalOwner')).toBe(false);

    world.update(1 / 90, 0);
    expect(prop.getValue(Networked, 'isLocalOwner')).toBe(false);
  });

  it('takes ownership when the grant arrives', () => {
    const { world, bus, server, net, prop } = scenario();

    const requestId = net.requestOwnership(prop);

    server.send(
      BinaryProtocol.encodeOwnershipGrant({
        networkId: 100,
        ownerId: 42,
        requestId,
        granted: true,
      }),
    );
    bus.advance(0);
    world.update(1 / 90, 0);

    expect(prop.getValue(Networked, 'isLocalOwner')).toBe(true);
    expect(prop.getValue(Networked, 'ownerId')).toBe(42);
    expect(net.pendingOwnershipCount).toBe(0);
  });

  it('records the real owner on a denial', () => {
    const { world, bus, server, net, prop } = scenario();

    const requestId = net.requestOwnership(prop);

    server.send(
      BinaryProtocol.encodeOwnershipGrant({
        networkId: 100,
        ownerId: 7, // somebody else won
        requestId,
        granted: false,
      }),
    );
    bus.advance(0);
    world.update(1 / 90, 0);

    expect(prop.getValue(Networked, 'isLocalOwner')).toBe(false);
    expect(prop.getValue(Networked, 'ownerId')).toBe(7);
  });

  it('reports both outcomes through onOwnershipChange', () => {
    const { world, bus, server, net, prop } = scenario();
    const seen: { granted: boolean; isLocalOwner: boolean }[] = [];
    net.onOwnershipChange = (change) =>
      seen.push({ granted: change.granted, isLocalOwner: change.isLocalOwner });

    server.send(
      BinaryProtocol.encodeOwnershipGrant({
        networkId: 100,
        ownerId: 42,
        requestId: net.requestOwnership(prop),
        granted: true,
      }),
    );
    bus.advance(0);
    world.update(1 / 90, 0);

    server.send(
      BinaryProtocol.encodeOwnershipGrant({
        networkId: 100,
        ownerId: 9,
        requestId: net.requestOwnership(prop),
        granted: false,
      }),
    );
    bus.advance(0);
    world.update(1 / 90, 0);

    expect(seen).toEqual([
      { granted: true, isLocalOwner: true },
      { granted: false, isLocalOwner: false },
    ]);
  });

  it('resets the interpolation buffer when ownership moves away', () => {
    // Otherwise the entity lurches from a stale sample instead of being seeded
    // fresh by its new owner's first frame.
    const { world, bus, server, net, prop } = scenario();

    // Take ownership, then lose it.
    server.send(
      BinaryProtocol.encodeOwnershipGrant({
        networkId: 100,
        ownerId: 42,
        requestId: net.requestOwnership(prop),
        granted: true,
      }),
    );
    bus.advance(0);
    world.update(1 / 90, 0);
    expect(prop.getValue(Networked, 'isLocalOwner')).toBe(true);

    server.send(
      BinaryProtocol.encodeOwnershipGrant({
        networkId: 100,
        ownerId: 9,
        requestId: 0,
        granted: true,
      }),
    );
    bus.advance(0);
    world.update(1 / 90, 0);

    expect(prop.getValue(Networked, 'isLocalOwner')).toBe(false);
    expect(prop.getValue(NetworkedTransform, 'hasSnapshot')).toBe(false);
  });

  it('refuses to request ownership for an unassigned network id', () => {
    const { world, net } = scenario();
    const orphan = makeEntity(world, { networkId: 0, isLocalOwner: false });

    expect(net.requestOwnership(orphan)).toBe(0);
    expect(net.pendingOwnershipCount).toBe(0);
  });
});

describe('plugin lifecycle', () => {
  it('requires an endpoint unless offline or given an adapter', () => {
    const world = new World({ entityCapacity: 16, checksOn: false });
    world.registerComponent(Transform);
    expect(() => installPhoenixNetworking(world as never, {})).toThrow(/endpoint/);
  });

  it('unregisters its systems on dispose', () => {
    const adapter = new OfflineAdapter();
    const { world, handle } = makeWorld(adapter, { isOffline: true });

    expect(loose(world).hasSystem(PhoenixNetworkSystem)).toBe(true);
    handle.dispose();
    expect(loose(world).hasSystem(PhoenixNetworkSystem)).toBe(false);
  });
});
