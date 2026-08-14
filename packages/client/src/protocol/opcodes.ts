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
  /** Client asks to take authority over an entity. */
  OWNERSHIP_REQUEST = 9,
  /** Server's verdict on an ownership request, broadcast to the whole room. */
  OWNERSHIP_GRANT = 10,
  /**
   * Opaque peer-to-peer signalling, relayed by the server.
   *
   * Carries WebRTC SDP offers/answers and ICE candidates without the server
   * needing to understand any of it.
   */
  SIGNAL = 11,
  /**
   * Batched Cardinal component payloads.
   *
   * @see COMPONENT_UPDATE_HEADER_BYTES
   * @see {@link file://../cardinal/components.generated.ts} for the layouts,
   * which are generated from `cardinal/components.mjs`.
   */
  COMPONENT_UPDATE = 12,
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

/** Byte size of a {@link OpCode.COMPONENT_UPDATE} header: op + count + tick. */
export const COMPONENT_UPDATE_HEADER_BYTES = 7;

/**
 * Byte size of one component record's header, before its payload.
 *
 * There is no length field: the payload size is a property of the component
 * id, looked up in the registry. That keeps per-record overhead at 6 bytes —
 * and it means an unknown id makes the rest of the frame unreadable, since
 * there is no way to know how far to skip. Schema agreement is checked once,
 * at join, which is what pays for this.
 */
export const COMPONENT_UPDATE_RECORD_HEADER_BYTES = 6;

/**
 * Byte size of an extended {@link OpCode.PONG} frame.
 *
 * `op` + `t0` + `t1` + `t2` (an `f64` each) + a `u32` epoch. The 9-byte form
 * — opcode plus the echoed timestamp alone — remains valid: that is what a
 * server predating clock synchronization sends, and the two are told apart by
 * length rather than by any version number.
 */
export const PONG_EXTENDED_BYTES = 29;

/** Byte size of an {@link OpCode.OWNERSHIP_REQUEST} frame. */
export const OWNERSHIP_REQUEST_BYTES = 9;

/** Byte size of an {@link OpCode.OWNERSHIP_GRANT} frame. */
export const OWNERSHIP_GRANT_BYTES = 14;

/** Byte size of a {@link OpCode.SIGNAL} frame header, before its payload. */
export const SIGNAL_HEADER_BYTES = 11;

/**
 * Largest signalling payload accepted, in bytes.
 *
 * An SDP offer with many codecs runs to a few kilobytes; 16 KiB is generous.
 * The cap exists because this frame is the one place a client hands the server
 * a length-prefixed blob, and an unbounded length is exactly how a relay
 * becomes an amplification vector.
 */
export const SIGNAL_MAX_PAYLOAD_BYTES = 16 * 1024;

/** Every multi-byte field on the wire is little-endian. */
export const LITTLE_ENDIAN = true;
