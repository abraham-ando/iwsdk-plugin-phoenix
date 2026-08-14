/**
 * Publishes locally owned transforms and ingests authoritative frames.
 *
 * This is the only system that talks to the adapter for transform traffic; the
 * interpolation, prediction and LOD systems all work off the ECS state it
 * maintains. Keeping ingestion in one place means a frame is decoded exactly
 * once no matter how many systems care about the result.
 */
import { Transform, Types, createSystem } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { Networked, NetworkStats, NetworkedTransform } from '../components/index.js';
import type { INetworkAdapter, NetworkMessage } from '../interfaces/INetworkAdapter.js';
import {
  BinaryProtocol,
  ProtocolError,
  type SignalFrame,
  type TransformRecord,
} from '../protocol/BinaryProtocol.js';
import { OpCode } from '../protocol/opcodes.js';
import type { MutableVector } from '../math/interpolation.js';
import { CARDINAL_REGISTRY } from '../cardinal/components.generated.js';
import { CardinalPublisher } from '../cardinal/publish.js';
import type { ComponentRecord } from '../protocol/BinaryProtocol.js';
import { EntityIndex } from './EntityIndex.js';

/** Adapters that can hand us frames in bulk once per tick. */
interface DrainableAdapter extends INetworkAdapter {
  drainInbound(): number;
  droppedFrames: number;
}

const isDrainable = (adapter: INetworkAdapter): adapter is DrainableAdapter =>
  typeof (adapter as DrainableAdapter).drainInbound === 'function';

/** Detail of the `iwsdk-phoenix:spawn` / `:despawn` callbacks. */
export interface SpawnRequest {
  networkId: number;
  prefabId: number;
  ownerId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

export class PhoenixNetworkSystem extends createSystem(
  {
    /** Every replicated entity, owned or not. */
    replicated: { required: [Networked, Transform] },
    /** Entities carrying interpolation state (i.e. remotely owned). */
    interpolated: { required: [Networked, NetworkedTransform] },
    /** Optional telemetry sink. */
    stats: { required: [NetworkStats] },
  },
  {
    /**
     * The transport. Supplied by `installPhoenixNetworking`; typed as `Object`
     * because elics config values are signals over primitives plus opaque
     * objects.
     */
    adapter: { type: Types.Object, default: null },
    /**
     * Skip all network I/O. The rest of the pipeline — interpolation,
     * prediction, Havok — keeps running untouched, so a single-player session
     * behaves identically minus the traffic.
     */
    isOffline: { type: Types.Boolean, default: false },
    /** Publish rate ceiling in hertz for owned entities. */
    sendRateHz: { type: Types.Float32, default: 30 },
    /** Batch owned transforms into one SNAPSHOT frame instead of N frames. */
    batchOutbound: { type: Types.Boolean, default: true },
    /** Use smallest-three quaternion compression on outbound snapshots. */
    quantize: { type: Types.Boolean, default: false },
    /**
     * Minimum positional change, in metres, before an owned entity is
     * republished. Suppresses traffic for objects at rest.
     */
    positionEpsilon: { type: Types.Float32, default: 0.001 },
    /**
     * Minimum rotational change, in radians, before an owned entity is
     * republished. Defaults to ~0.5 degrees.
     *
     * Rotation must be part of the test, not just position: a headset that
     * turns on the spot changes orientation without translating at all, and a
     * position-only check would freeze every remote avatar's head.
     */
    rotationEpsilon: { type: Types.Float32, default: 0.0087 },
  },
) {
  private readonly index = new EntityIndex();
  private readonly cardinal = new CardinalPublisher();
  private readonly unsubscribes: (() => void)[] = [];

  /** Scratch list reused every tick so batching allocates nothing steady-state. */
  private readonly outbound: TransformRecord[] = [];

  private frameCounter = 0;
  private framesReceived = 0;
  private framesSent = 0;
  private bytesReceived = 0;
  private bytesSent = 0;

  /** Application hooks for entity lifecycle driven by the server. */
  onSpawn: ((request: SpawnRequest) => void) | null = null;
  onDespawn: ((networkId: number) => void) | null = null;

  /**
   * Called for every ownership verdict, granted or denied.
   *
   * Denials matter as much as grants: a player who reached for an object and
   * lost the race needs their local "picking up" affordance cancelled, and the
   * frame tells them who won.
   */
  onOwnershipChange:
    | ((change: {
        networkId: number;
        ownerId: number;
        granted: boolean;
        requestId: number;
        isLocalOwner: boolean;
      }) => void)
    | null = null;

  /**
   * This client's own network id.
   *
   * Adopted automatically from the adapter's join reply; an application only
   * needs to assign it by hand when driving a transport that cannot supply one.
   * Used to decide whether an ownership grant refers to us, and to filter our
   * own broadcast signalling back out.
   */
  localOwnerId = 0;

  /**
   * Called for every signalling frame addressed to this client.
   *
   * The payload is opaque here — typically JSON-encoded SDP or an ICE
   * candidate. Feed it to your `RTCPeerConnection`; this package only carries
   * it, which is what lets WebRTC negotiation evolve without a server change.
   */
  onSignal: ((signal: SignalFrame) => void) | null = null;

  private nextRequestId = 1;
  private readonly pendingOwnership = new Map<number, number>();

  override init(): void {
    const adapter = this.adapter;
    if (!adapter) return;

    this.unsubscribes.push(
      adapter.onMessage((message) => this.handleMessage(message)),
    );

    // The server assigns this client's wire id in the join reply. Adopt it as
    // soon as it exists, and again on every reconnect, so an application never
    // has to thread the identity through by hand.
    this.adoptLocalOwnerId(adapter);
    if (adapter.onStateChange) {
      this.unsubscribes.push(
        adapter.onStateChange(() => this.adoptLocalOwnerId(adapter)),
      );
    }

    // Keep the id index warm as entities come and go.
    this.unsubscribes.push(
      this.queries.replicated.subscribe('qualify', (entity) => this.index.add(entity)),
    );
    this.unsubscribes.push(
      this.queries.replicated.subscribe('disqualify', (entity) =>
        this.index.remove(entity),
      ),
    );

    // Seed the index with entities that already exist. `subscribe` above only
    // reports future transitions unless replay is requested, and the plugin may
    // well be installed after the level has spawned its entities.
    this.index.rebuild(this.queries.replicated.entities);
  }

  override destroy(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.index.clear();
  }

  override update(delta: number, _time: number): void {
    this.frameCounter++;

    const adapter = this.adapter;
    if (!adapter || this.config.isOffline.value) return;

    // Pull everything the worker has queued since the last frame. Doing this
    // first means inbound state is current before anything reads it.
    if (isDrainable(adapter)) adapter.drainInbound();

    this.publishOwned(delta);
    this.publishStats(adapter);
  }

  /** The configured adapter, or `null` when the plugin was installed offline. */
  get adapter(): INetworkAdapter | null {
    return (this.config.adapter.value as INetworkAdapter | null) ?? null;
  }

  /**
   * Copy the adapter's server-assigned id onto {@link localOwnerId}.
   *
   * Deliberately one-way: an id of `0` means "not known yet" and never
   * overwrites one we already hold. A dropped socket keeps reporting 0 while it
   * reconnects, and clearing our identity in the meantime would make every
   * ownership grant that arrives on reconnect look like it belonged to someone
   * else. The room re-issues the same id for the same peer, so holding on to
   * the last known value is also the correct answer.
   */
  private adoptLocalOwnerId(adapter: INetworkAdapter): void {
    const assigned = adapter.networkId ?? 0;
    if (assigned !== 0) this.localOwnerId = assigned;
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  private publishOwned(_delta: number): void {
    const adapter = this.adapter;
    if (!adapter || adapter.state !== 'connected') return;

    const now = nowMs();
    const epsilon = this.config.positionEpsilon.value;
    const rotationEpsilon = this.config.rotationEpsilon.value;
    const batch = this.config.batchOutbound.value;

    this.outbound.length = 0;

    for (const entity of this.queries.replicated.entities) {
      if (!entity.getValue(Networked, 'isLocalOwner')) continue;

      const networkId = entity.getValue(Networked, 'networkId') ?? 0;
      if (networkId === 0) continue;

      // Per-entity rate limiting: NetworkLODSystem lowers sendRateHz for
      // distant objects, and this is where that decision takes effect.
      const rate = entity.getValue(Networked, 'sendRateHz') || this.config.sendRateHz.value;
      const interval = rate > 0 ? 1000 / rate : Infinity;
      const lastSent = entity.getValue(Networked, 'lastSentAt') ?? 0;
      if (now - lastSent < interval) continue;

      const position = entity.getVectorView(Transform, 'position');
      const orientation = entity.getVectorView(Transform, 'orientation');

      if (!this.hasChangedEnough(entity, position, orientation, epsilon, rotationEpsilon))
        continue;

      entity.setValue(Networked, 'lastSentAt', now);

      const record: TransformRecord = {
        networkId,
        position: {
          x: position[0] as number,
          y: position[1] as number,
          z: position[2] as number,
        },
        rotation: {
          x: orientation[0] as number,
          y: orientation[1] as number,
          z: orientation[2] as number,
          w: orientation[3] as number,
        },
      };

      if (batch) {
        this.outbound.push(record);
      } else {
        this.dispatch(
          adapter,
          BinaryProtocol.encodeTransform(networkId, record.position, record.rotation),
        );
      }
    }

    if (batch && this.outbound.length > 0) {
      this.dispatch(
        adapter,
        BinaryProtocol.encodeSnapshot(
          this.outbound,
          this.frameCounter,
          this.config.quantize.value,
        ),
      );
    }

    this.publishComponents(adapter);
  }

  /**
   * Publish every owned entity's changed Cardinal components, in one frame.
   *
   * One frame for all of them, never one per component: a lone record falls
   * under the BEAM's 64-byte threshold and would be copied to every recipient
   * instead of shared by reference.
   *
   * Not rate-limited the way transforms are. A transform changes every frame,
   * so it needs a cadence; a component changes when something happens to it,
   * and delaying that by up to a tick would add latency to a rare event for no
   * bandwidth saving — the dirty check already means an unchanged component
   * costs nothing.
   */
  private publishComponents(adapter: INetworkAdapter): void {
    const records: ComponentRecord[] = [];

    for (const entity of this.queries.replicated.entities) {
      if (!entity.getValue(Networked, 'isLocalOwner')) continue;

      const networkId = entity.getValue(Networked, 'networkId') ?? 0;
      if (networkId === 0) continue;

      records.push(...this.cardinal.collect(entity, networkId));
    }

    if (records.length > 0) {
      this.dispatch(
        adapter,
        BinaryProtocol.encodeComponentUpdate(records, this.frameCounter),
      );
    }
  }

  /**
   * Suppress republishing an entity whose pose has not meaningfully changed.
   *
   * Compares against the last *published* pose, which for an owned entity is
   * stored in the otherwise-unused `NetworkedTransform` target fields — those
   * only carry inbound samples for entities owned by someone else, so reusing
   * them here avoids keeping a second copy of every transform.
   *
   * Both translation and rotation are tested. Either one exceeding its
   * threshold republishes the whole pose.
   */
  private hasChangedEnough(
    entity: Entity,
    position: MutableVector,
    orientation: MutableVector,
    positionEpsilon: number,
    rotationEpsilon: number,
  ): boolean {
    if (positionEpsilon <= 0 && rotationEpsilon <= 0) return true;
    if (!entity.hasComponent(NetworkedTransform)) return true;

    const lastPosition = entity.getVectorView(NetworkedTransform, 'targetPosition');
    const lastOrientation = entity.getVectorView(
      NetworkedTransform,
      'targetOrientation',
    );

    const dx = (position[0] as number) - (lastPosition[0] as number);
    const dy = (position[1] as number) - (lastPosition[1] as number);
    const dz = (position[2] as number) - (lastPosition[2] as number);
    const moved = dx * dx + dy * dy + dz * dz >= positionEpsilon * positionEpsilon;

    // |dot| of two unit quaternions is cos(halfAngle); comparing against
    // cos(epsilon/2) avoids an acos on the hot path.
    const dot = Math.abs(
      (orientation[0] as number) * (lastOrientation[0] as number) +
        (orientation[1] as number) * (lastOrientation[1] as number) +
        (orientation[2] as number) * (lastOrientation[2] as number) +
        (orientation[3] as number) * (lastOrientation[3] as number),
    );
    const turned = dot < Math.cos(rotationEpsilon / 2);

    if (!moved && !turned) return false;

    lastPosition[0] = position[0] as number;
    lastPosition[1] = position[1] as number;
    lastPosition[2] = position[2] as number;
    lastOrientation[0] = orientation[0] as number;
    lastOrientation[1] = orientation[1] as number;
    lastOrientation[2] = orientation[2] as number;
    lastOrientation[3] = orientation[3] as number;
    return true;
  }

  private dispatch(adapter: INetworkAdapter, buffer: ArrayBuffer): void {
    this.framesSent++;
    this.bytesSent += buffer.byteLength;
    adapter.send(buffer);
  }

  // ---------------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------------

  /**
   * Ask the server for authority over an entity — the "I picked this up" call.
   *
   * Deliberately does **not** set `isLocalOwner` optimistically. Ownership is
   * the one piece of state where optimistic prediction is the wrong choice:
   * when two players grab the same object at the same moment, both would
   * predict success and both would start publishing transforms, so the object
   * visibly fights between two positions until the server's verdict lands. It
   * is far better to wait one round trip and be right. Predict the *animation*
   * locally if you need immediate feedback; leave the authority to the server.
   *
   * @returns The request id, echoed in the matching grant, or `0` if there is
   *   no connected adapter.
   */
  requestOwnership(entity: Entity): number {
    const adapter = this.adapter;
    const networkId = entity.getValue(Networked, 'networkId') ?? 0;
    if (!adapter || networkId === 0) return 0;

    const requestId = this.nextRequestId++;
    this.pendingOwnership.set(requestId, networkId);
    adapter.send(BinaryProtocol.encodeOwnershipRequest(networkId, requestId));
    return requestId;
  }

  /** Ownership requests still awaiting a verdict. */
  get pendingOwnershipCount(): number {
    return this.pendingOwnership.size;
  }

  private applyOwnership(frame: {
    networkId: number;
    ownerId: number;
    requestId: number;
    granted: boolean;
  }): void {
    this.pendingOwnership.delete(frame.requestId);

    const entity = this.index.get(
      frame.networkId,
      this.queries.replicated.entities,
      this.frameCounter,
    );

    const isLocalOwner = this.localOwnerId !== 0 && frame.ownerId === this.localOwnerId;

    if (entity) {
      entity.setValue(Networked, 'ownerId', frame.ownerId);
      entity.setValue(Networked, 'isLocalOwner', isLocalOwner);

      if (!isLocalOwner && entity.hasComponent(NetworkedTransform)) {
        // Ownership just moved away from us. Clear the interpolation buffer so
        // the entity does not lurch from a stale sample: the first frame from
        // the new owner should seed it fresh, exactly like a newly-seen entity.
        entity.setValue(NetworkedTransform, 'hasSnapshot', false);
      }
    }

    this.onOwnershipChange?.({ ...frame, isLocalOwner });
  }

  // ---------------------------------------------------------------------------
  // Signalling
  // ---------------------------------------------------------------------------

  /**
   * Relay an opaque payload to one peer, or to the whole room.
   *
   * @param targetNetworkId Recipient, or 0 to reach every other peer — useful
   *   for announcing yourself before you know anyone's id.
   * @param payload SDP, an ICE candidate, or anything else your negotiation
   *   needs. Capped at 16 KiB by the protocol.
   * @returns `false` when there is no connected adapter.
   */
  sendSignal(targetNetworkId: number, payload: Uint8Array | string): boolean {
    const adapter = this.adapter;
    if (!adapter || adapter.state !== 'connected') return false;

    const frame =
      typeof payload === 'string'
        ? BinaryProtocol.encodeSignalText(targetNetworkId, payload)
        : BinaryProtocol.encodeSignal(targetNetworkId, payload);

    // The sender field is left at 0: the server overwrites it with our real id,
    // so it cannot be forged.
    adapter.send(frame);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------------

  private handleMessage(message: NetworkMessage): void {
    this.framesReceived++;
    this.bytesReceived += message.payload.byteLength;

    try {
      switch (message.opCode) {
        case OpCode.TRANSFORM_UPDATE:
          this.applyRecord(BinaryProtocol.decodeTransform(message.payload));
          break;

        case OpCode.SNAPSHOT: {
          const snapshot = BinaryProtocol.decodeSnapshot(message.payload);
          for (const record of snapshot.records) this.applyRecord(record);
          break;
        }

        case OpCode.SPAWN_ENTITY: {
          const spawn = BinaryProtocol.decodeSpawn(message.payload);
          this.onSpawn?.(spawn);
          break;
        }

        case OpCode.DESPAWN_ENTITY: {
          const decoded = BinaryProtocol.decode(message.payload);
          if (decoded.opCode === OpCode.DESPAWN_ENTITY) {
            // Forget its publish history too, so a reused id starts clean
            // rather than being suppressed by a dead entity's last bytes.
            this.cardinal.forget(decoded.networkId);
            this.onDespawn?.(decoded.networkId);
          }
          break;
        }

        case OpCode.COMPONENT_UPDATE: {
          const { records } = BinaryProtocol.decodeComponentUpdate(message.payload);
          for (const record of records) {
            const entity = this.index.get(
              record.networkId,
              this.queries.replicated.entities,
              this.frameCounter,
            );
            // A record for an entity we have not spawned yet is dropped, not
            // queued: the server replays its cache after the spawns, so the
            // only way to be early is a frame racing its own spawn.
            if (!entity) continue;
            CARDINAL_REGISTRY.get(record.componentId)?.write(entity, record.data);
          }
          break;
        }

        case OpCode.OWNERSHIP_GRANT:
          this.applyOwnership(BinaryProtocol.decodeOwnershipGrant(message.payload));
          break;

        case OpCode.SIGNAL: {
          const signal = BinaryProtocol.decodeSignal(message.payload);
          // Ignore our own broadcast coming back; only relevant for target 0.
          if (signal.senderNetworkId !== this.localOwnerId) this.onSignal?.(signal);
          break;
        }

        // RECONCILE is consumed by ClientPredictionSystem, which subscribes to
        // the adapter directly. PING/PONG are handled by the stats path.
        default:
          break;
      }
    } catch (error) {
      // A malformed frame must never take down the render loop. Log and drop.
      if (error instanceof ProtocolError) {
        console.warn('[plugin-phoenix] dropped malformed frame:', error.message);
      } else {
        throw error;
      }
    }
  }

  /**
   * Fold one authoritative sample into an entity's interpolation buffer.
   *
   * Frames for entities this client owns are ignored: the local simulation is
   * ahead of anything the server can echo back, and applying it would undo
   * client-side prediction.
   */
  private applyRecord(record: TransformRecord): void {
    const entity = this.index.get(
      record.networkId,
      this.queries.replicated.entities,
      this.frameCounter,
    );
    if (!entity) return;
    if (entity.getValue(Networked, 'isLocalOwner')) return;
    if (!entity.hasComponent(NetworkedTransform)) return;

    const now = nowMs();

    const target = entity.getVectorView(NetworkedTransform, 'targetPosition');
    const previous = entity.getVectorView(NetworkedTransform, 'previousPosition');
    const targetRotation = entity.getVectorView(NetworkedTransform, 'targetOrientation');
    const previousRotation = entity.getVectorView(
      NetworkedTransform,
      'previousOrientation',
    );
    const velocity = entity.getVectorView(NetworkedTransform, 'velocity');

    const hadSnapshot = entity.getValue(NetworkedTransform, 'hasSnapshot') ?? false;
    const targetTime = entity.getValue(NetworkedTransform, 'targetTime') ?? 0;

    if (hadSnapshot) {
      previous[0] = target[0] as number;
      previous[1] = target[1] as number;
      previous[2] = target[2] as number;
      previousRotation[0] = targetRotation[0] as number;
      previousRotation[1] = targetRotation[1] as number;
      previousRotation[2] = targetRotation[2] as number;
      previousRotation[3] = targetRotation[3] as number;
      entity.setValue(NetworkedTransform, 'previousTime', targetTime);
    } else {
      // First sample: seed both ends so the entity appears in place rather than
      // sliding in from the origin.
      previous[0] = record.position.x;
      previous[1] = record.position.y;
      previous[2] = record.position.z;
      previousRotation[0] = record.rotation.x;
      previousRotation[1] = record.rotation.y;
      previousRotation[2] = record.rotation.z;
      previousRotation[3] = record.rotation.w;
      entity.setValue(NetworkedTransform, 'previousTime', now);

      const transformPosition = entity.getVectorView(Transform, 'position');
      transformPosition[0] = record.position.x;
      transformPosition[1] = record.position.y;
      transformPosition[2] = record.position.z;

      const transformOrientation = entity.getVectorView(Transform, 'orientation');
      transformOrientation[0] = record.rotation.x;
      transformOrientation[1] = record.rotation.y;
      transformOrientation[2] = record.rotation.z;
      transformOrientation[3] = record.rotation.w;
    }

    target[0] = record.position.x;
    target[1] = record.position.y;
    target[2] = record.position.z;
    targetRotation[0] = record.rotation.x;
    targetRotation[1] = record.rotation.y;
    targetRotation[2] = record.rotation.z;
    targetRotation[3] = record.rotation.w;

    entity.setValue(NetworkedTransform, 'targetTime', now);
    entity.setValue(NetworkedTransform, 'hasSnapshot', true);

    // Derive velocity for dead reckoning when the next packet is late.
    const previousTime = entity.getValue(NetworkedTransform, 'previousTime') ?? now;
    const deltaSeconds = (now - previousTime) / 1000;
    if (deltaSeconds > 0) {
      velocity[0] = ((target[0] as number) - (previous[0] as number)) / deltaSeconds;
      velocity[1] = ((target[1] as number) - (previous[1] as number)) / deltaSeconds;
      velocity[2] = ((target[2] as number) - (previous[2] as number)) / deltaSeconds;
    } else {
      velocity[0] = 0;
      velocity[1] = 0;
      velocity[2] = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Telemetry
  // ---------------------------------------------------------------------------

  private publishStats(adapter: INetworkAdapter): void {
    for (const entity of this.queries.stats.entities) {
      entity.setValue(NetworkStats, 'framesReceived', this.framesReceived);
      entity.setValue(NetworkStats, 'framesSent', this.framesSent);
      entity.setValue(NetworkStats, 'bytesReceived', this.bytesReceived);
      entity.setValue(NetworkStats, 'bytesSent', this.bytesSent);
      // Until clock sync existed nothing ever wrote this field, so every
      // reader saw a permanent zero.
      entity.setValue(NetworkStats, 'rttMs', adapter.clockEstimate?.rttMs ?? 0);
      if (isDrainable(adapter)) {
        entity.setValue(NetworkStats, 'dropped', adapter.droppedFrames);
      }
    }
  }
}

/**
 * Monotonic clock in milliseconds.
 *
 * `performance.now()` everywhere it exists (browsers, workers, modern Node);
 * `Date.now()` only as a last resort, where a wall-clock jump would perturb
 * interpolation.
 */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
