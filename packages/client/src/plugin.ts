/**
 * Plugin entrypoint.
 *
 * IWSDK has no plugin registry: a plugin is simply something that registers
 * components and systems on a `World`. `installPhoenixNetworking` does that in
 * the right order and with sane priorities, so an application gets working
 * replication from a single call.
 */
import type { World } from '@iwsdk/core';
import { OfflineAdapter } from './adapters/OfflineAdapter.js';
import { PhoenixAdapter, type PhoenixAdapterOptions } from './adapters/PhoenixAdapter.js';
import {
  NetworkInput,
  NetworkStats,
  Networked,
  NetworkedTransform,
} from './components/index.js';
import type { INetworkAdapter } from './interfaces/INetworkAdapter.js';
import { SlewedOffset } from './math/clock-sync.js';
import type { ClockReading } from './transport/clock-loop.js';
import { ClientPredictionSystem } from './systems/ClientPredictionSystem.js';
import { NetworkInterpolationSystem } from './systems/NetworkInterpolationSystem.js';
import { NetworkLODSystem } from './systems/NetworkLODSystem.js';
import { PhoenixNetworkSystem } from './systems/PhoenixNetworkSystem.js';

/**
 * System priorities.
 *
 * Order within a frame matters and is not arbitrary:
 *
 * 1. `LOD` decides publish rates before anything publishes.
 * 2. `PREDICTION` moves the local player, so its motion is included in the
 *    transforms published later this frame instead of a frame late.
 * 3. `NETWORK` drains inbound frames and publishes outbound ones.
 * 4. `INTERPOLATION` runs last so remote entities are posed using the samples
 *    that arrived this very frame, rather than last frame's.
 */
export const SystemPriority = {
  LOD: 90,
  PREDICTION: 100,
  NETWORK: 110,
  INTERPOLATION: 120,
} as const;

/** Options for {@link installPhoenixNetworking}. */
export interface PhoenixNetworkingOptions {
  /**
   * Phoenix socket endpoint, e.g. `wss://example.com/socket`. Required unless
   * {@link isOffline} is set or a custom {@link adapter} is supplied.
   */
  endpoint?: string;

  /** Room to join; becomes the Phoenix topic `room:<roomId>`. @defaultValue 'lobby' */
  roomId?: string;

  /** Authentication token forwarded to the server's `connect/3`. */
  token?: string;

  /** Authority model requested at join. @defaultValue 'host_relayed' */
  mode?: 'host_relayed' | 'server_authoritative';

  /**
   * Run without any networking. Every system still registers and runs, so the
   * single-player code path is the multiplayer code path minus the traffic.
   * @defaultValue false
   */
  isOffline?: boolean;

  /**
   * Supply a transport instead of building a {@link PhoenixAdapter}. Use for
   * tests ({@link LoopbackAdapter}) or an entirely different backend.
   */
  adapter?: INetworkAdapter;

  /** Forwarded to {@link PhoenixAdapter} when one is constructed. */
  adapterOptions?: PhoenixAdapterOptions;

  /** Connect immediately. Set false to call `adapter.connect()` yourself. @defaultValue true */
  autoConnect?: boolean;

  /** Publish rate ceiling in hertz. @defaultValue 30 */
  sendRateHz?: number;

  /** Batch owned transforms into one SNAPSHOT per tick. @defaultValue true */
  batchOutbound?: boolean;

  /** Compress outbound quaternions to 32 bits. @defaultValue false */
  quantize?: boolean;

  /** Register {@link ClientPredictionSystem}. @defaultValue true when mode is server_authoritative */
  prediction?: boolean;

  /** Register {@link NetworkLODSystem}. @defaultValue true */
  networkLod?: boolean;

  /** Metres/second used by prediction; must match the server. @defaultValue 4.5 */
  moveSpeed?: number;
}

/**
 * A live view of the server's clock. Every method is safe to call per frame.
 *
 * The point of a shared time base is that a timestamp means the same thing on
 * both ends of the wire — which is what lets the receiver decide how stale a
 * snapshot is, rather than assuming.
 */
export interface NetworkClock {
  /**
   * Estimated server time in milliseconds.
   *
   * Falls back to local `performance.now()` until an estimate exists, so it is
   * always usable; check {@link synced} when the distinction matters.
   */
  serverNow(): number;
  /** Round-trip time in milliseconds; `0` until measured. */
  rttMs(): number;
  /** Server node's boot identifier; `null` until synced. */
  epoch(): number | null;
  /** True once a full offset estimate exists. */
  synced(): boolean;
}

/**
 * Build a clock over whatever the adapter currently believes.
 *
 * The slew lives here, on the reading side, rather than in the worker: a fresh
 * estimate should bend `serverNow()` toward the truth, never jump it, and only
 * the reader knows how often it is being asked.
 */
export function createNetworkClock(
  adapter: Pick<INetworkAdapter, 'clockEstimate'>,
): NetworkClock {
  const slew = new SlewedOffset();
  const reading = (): ClockReading | null => adapter.clockEstimate ?? null;

  return {
    serverNow() {
      const current = reading();
      if (!current || current.offsetMs === null || current.epoch === null) {
        return performance.now();
      }

      const now = performance.now();
      return (
        now +
        slew.update(
          { offsetMs: current.offsetMs, rttMs: current.rttMs, epoch: current.epoch },
          now,
        )
      );
    },
    rttMs: () => reading()?.rttMs ?? 0,
    epoch: () => reading()?.epoch ?? null,
    synced: () => reading()?.offsetMs != null,
  };
}

/** What {@link installPhoenixNetworking} hands back. */
export interface PhoenixNetworkingHandle {
  /** The transport in use. */
  adapter: INetworkAdapter;
  /** Estimated server clock; see {@link NetworkClock}. */
  clock: NetworkClock;
  /** Resolves once the room is joined; resolves immediately when offline. */
  ready: Promise<void>;
  /** Disconnect and unregister every system this call added. */
  dispose(): void;
}

/**
 * Register the plugin's components and systems on a world.
 *
 * @example
 * ```ts
 * const world = await World.create(container, { xr: { sessionMode: SessionMode.ImmersiveVR } });
 *
 * const net = installPhoenixNetworking(world, {
 *   endpoint: 'wss://example.com/socket',
 *   roomId: 'lobby',
 *   mode: 'server_authoritative',
 * });
 * await net.ready;
 * ```
 */
export function installPhoenixNetworking(
  world: World,
  options: PhoenixNetworkingOptions = {},
): PhoenixNetworkingHandle {
  const {
    endpoint,
    roomId = 'lobby',
    token,
    mode = 'host_relayed',
    isOffline = false,
    autoConnect = true,
    sendRateHz = 30,
    batchOutbound = true,
    quantize = false,
    networkLod = true,
    moveSpeed = 4.5,
  } = options;

  const prediction = options.prediction ?? mode === 'server_authoritative';

  const adapter: INetworkAdapter =
    options.adapter ??
    (isOffline ? new OfflineAdapter() : new PhoenixAdapter(options.adapterOptions));

  if (!isOffline && !options.adapter && !endpoint) {
    throw new Error(
      'installPhoenixNetworking: `endpoint` is required unless `isOffline` is true or a custom `adapter` is supplied',
    );
  }

  world
    .registerComponent(Networked)
    .registerComponent(NetworkedTransform)
    .registerComponent(NetworkInput)
    .registerComponent(NetworkStats);

  if (networkLod) {
    world.registerSystem(NetworkLODSystem, { priority: SystemPriority.LOD });
  }

  if (prediction) {
    world.registerSystem(ClientPredictionSystem, {
      priority: SystemPriority.PREDICTION,
      configData: { adapter, moveSpeed },
    });
  }

  world.registerSystem(PhoenixNetworkSystem, {
    priority: SystemPriority.NETWORK,
    configData: { adapter, isOffline, sendRateHz, batchOutbound, quantize },
  });

  world.registerSystem(NetworkInterpolationSystem, {
    priority: SystemPriority.INTERPOLATION,
  });

  const ready =
    autoConnect && !isOffline && endpoint
      ? adapter.connect(endpoint, { roomId, token, mode })
      : Promise.resolve();

  return {
    adapter,
    clock: createNetworkClock(adapter),
    ready,
    dispose() {
      adapter.disconnect();
      world.unregisterSystem(NetworkInterpolationSystem);
      world.unregisterSystem(PhoenixNetworkSystem);
      if (prediction) world.unregisterSystem(ClientPredictionSystem);
      if (networkLod) world.unregisterSystem(NetworkLODSystem);
    },
  };
}
