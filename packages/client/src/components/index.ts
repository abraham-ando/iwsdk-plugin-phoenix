/**
 * ECS components contributed by `@iwsdk/plugin-phoenix`.
 *
 * These use IWSDK's `createComponent` factory (re-exported from `elics`), which
 * stores component data in flat typed arrays rather than per-entity objects.
 * That is why every field is a primitive or a fixed-width vector: it keeps the
 * network hot path allocation-free.
 */
import { Types, createComponent } from '@iwsdk/core';

/**
 * Marks an entity as replicated and carries its network identity.
 *
 * @remarks
 * `networkId` is an `Int32` because elics has no unsigned 32-bit storage type,
 * while the wire protocol encodes it as a `Uint32`. Allocate ids from the
 * positive range `[1, 2147483647]`; `IwsdkPhoenix.Room` does exactly that. Id
 * `0` is reserved and means "not yet assigned".
 */
export const Networked = createComponent(
  'Networked',
  {
    /** Stable id shared by every peer. 0 until the server assigns one. */
    networkId: { type: Types.Int32, default: 0 },
    /** True when this client owns the entity and may publish its transform. */
    isLocalOwner: { type: Types.Boolean, default: false },
    /** Id of the peer that owns this entity. */
    ownerId: { type: Types.Int32, default: 0 },
    /** Application-defined archetype id, echoed in SPAWN_ENTITY frames. */
    prefabId: { type: Types.Int32, default: 0 },
    /**
     * Desired publish rate in hertz. `NetworkLODSystem` overwrites this based
     * on distance to the local viewer; set `networkLod: false` on the plugin to
     * keep whatever the application assigns.
     */
    sendRateHz: { type: Types.Float32, default: 30 },
    /** `performance.now()` timestamp of the last publish, in milliseconds. */
    lastSentAt: { type: Types.Float64, default: 0 },
  },
  'Network identity for a replicated entity',
);

/**
 * Interpolation state for an entity owned by a remote peer.
 *
 * @remarks
 * Holds the two most recent authoritative samples. `NetworkInterpolationSystem`
 * renders at `now - interpolationDelayMs`, which keeps playback between two
 * known samples instead of extrapolating from one. Extrapolation (dead
 * reckoning along `velocity`) only kicks in when a packet is late.
 */
export const NetworkedTransform = createComponent(
  'NetworkedTransform',
  {
    /** Most recent authoritative position. */
    targetPosition: { type: Types.Vec3, default: [0, 0, 0] },
    /** Most recent authoritative orientation (x, y, z, w). */
    targetOrientation: { type: Types.Vec4, default: [0, 0, 0, 1] },
    /** Previous authoritative position; the interpolation source. */
    previousPosition: { type: Types.Vec3, default: [0, 0, 0] },
    /** Previous authoritative orientation. */
    previousOrientation: { type: Types.Vec4, default: [0, 0, 0, 1] },
    /** Derived linear velocity in units/second, used for dead reckoning. */
    velocity: { type: Types.Vec3, default: [0, 0, 0] },
    /** `performance.now()` of the target sample, in milliseconds. */
    targetTime: { type: Types.Float64, default: 0 },
    /** `performance.now()` of the previous sample, in milliseconds. */
    previousTime: { type: Types.Float64, default: 0 },
    /**
     * How far behind live the entity is rendered, in milliseconds.
     *
     * **Computed, not configured**, unless the plugin was installed with
     * `adaptiveInterpolation: false`. `PhoenixNetworkSystem` measures each
     * remote entity's arrival jitter and sizes its buffer accordingly, so a
     * peer on a local network is rendered barely behind live while one on a
     * poor connection gets the headroom it actually needs. The 100 ms default
     * is only what an entity shows before its first samples arrive.
     */
    interpolationDelayMs: { type: Types.Float32, default: 100 },
    /**
     * Hard cap on dead reckoning, in milliseconds. Past this the entity holds
     * its last known pose instead of sliding away through walls.
     */
    maxExtrapolationMs: { type: Types.Float32, default: 250 },
    /** Set once the first authoritative sample has landed. */
    hasSnapshot: { type: Types.Boolean, default: false },
  },
  'Buffered remote transform samples for interpolation',
);

/**
 * Locomotion and action intent sampled from XR input on the owning client.
 *
 * @remarks
 * Head and hand *poses* are deliberately not carried here. They replicate as
 * ordinary `Networked` + `NetworkedTransform` entities (IWSDK already exposes
 * `world.playerSpaceEntities` for exactly those joints), which lets them reuse
 * interpolation, network LOD and area-of-interest filtering unchanged. This
 * component only carries the intent a server-authoritative room needs in order
 * to re-simulate the player.
 */
export const NetworkInput = createComponent(
  'NetworkInput',
  {
    /** Stick/keyboard movement axes, each in `[-1, 1]`. */
    movement: { type: Types.Vec2, default: [0, 0] },
    /** Player yaw in radians. */
    yaw: { type: Types.Float32, default: 0 },
    /** Bitmask of up to 24 pressed buttons. */
    buttons: { type: Types.Int32, default: 0 },
    /** Monotonically increasing sequence number for reconciliation. */
    sequence: { type: Types.Int32, default: 0 },
  },
  'Replicated XR input intent',
);

/**
 * Per-connection telemetry, mirrored onto an entity so application UI can bind
 * to it through ordinary queries.
 */
export const NetworkStats = createComponent(
  'NetworkStats',
  {
    /** Smoothed round-trip time in milliseconds. */
    rttMs: { type: Types.Float32, default: 0 },
    /** Frames received since connecting. */
    framesReceived: { type: Types.Float64, default: 0 },
    /** Frames published since connecting. */
    framesSent: { type: Types.Float64, default: 0 },
    /** Bytes received since connecting. */
    bytesReceived: { type: Types.Float64, default: 0 },
    /** Bytes published since connecting. */
    bytesSent: { type: Types.Float64, default: 0 },
    /** Inbound frames dropped because the ring buffer was full. */
    dropped: { type: Types.Float64, default: 0 },
  },
  'Connection telemetry',
);
