/**
 * Wire opcodes shared by `@iwsdk/plugin-phoenix` (TypeScript) and
 * `iwsdk_phoenix` (Elixir). Every frame starts with a single `Uint8` opcode.
 *
 * The numeric values are part of the wire contract: changing one is a breaking
 * protocol change and must be mirrored in `IwsdkPhoenix.Protocol`.
 */
export enum OpCode {
  /** Single entity transform, 33 bytes, uncompressed. */
  TRANSFORM_UPDATE = 1,
  /** Player input sample for server-authoritative rooms. */
  INPUT_UPDATE = 2,
  /** Entity creation broadcast. */
  SPAWN_ENTITY = 3,
  /** Entity removal broadcast. */
  DESPAWN_ENTITY = 4,
  /** Batched world snapshot: many transforms in one frame. */
  SNAPSHOT = 5,
  /** Server -> client correction carrying the last processed input sequence. */
  RECONCILE = 6,
  /** Latency probe. */
  PING = 7,
  /** Latency probe response. */
  PONG = 8,
}

/**
 * Per-frame flags carried by {@link OpCode.SNAPSHOT}.
 */
export const SnapshotFlags = {
  /** Records use the 32-byte uncompressed layout. */
  NONE: 0x00,
  /**
   * Records use the 20-byte quantized layout: position stays `Float32` while
   * the quaternion is packed into a single `Uint32` via smallest-three.
   */
  QUANTIZED: 0x01,
} as const;

export type SnapshotFlag = (typeof SnapshotFlags)[keyof typeof SnapshotFlags];

/** Byte size of a flat {@link OpCode.TRANSFORM_UPDATE} frame. */
export const TRANSFORM_UPDATE_BYTES = 33;

/** Byte size of a {@link OpCode.SNAPSHOT} frame header. */
export const SNAPSHOT_HEADER_BYTES = 8;

/** Byte size of one uncompressed record inside a snapshot. */
export const SNAPSHOT_RECORD_BYTES = 32;

/** Byte size of one quantized record inside a snapshot. */
export const SNAPSHOT_RECORD_QUANTIZED_BYTES = 20;

/** Byte size of an {@link OpCode.INPUT_UPDATE} frame. */
export const INPUT_UPDATE_BYTES = 22;

/** Byte size of a {@link OpCode.RECONCILE} frame. */
export const RECONCILE_BYTES = 21;

/** Every multi-byte field on the wire is little-endian. */
export const LITTLE_ENDIAN = true;
