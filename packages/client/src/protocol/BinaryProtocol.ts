/**
 * Binary wire codec shared with the Elixir `IwsdkPhoenix.Protocol` module.
 *
 * Every frame is a standalone `ArrayBuffer` so it can be handed to a Phoenix
 * channel unchanged — `phoenix.js` detects `ArrayBuffer` payloads and takes its
 * `binaryEncode` path, which prepends only a small header and never touches the
 * body. All multi-byte fields are little-endian, matching the native byte order
 * of every platform IWSDK targets.
 */
import {
  INPUT_UPDATE_BYTES,
  LITTLE_ENDIAN,
  OWNERSHIP_GRANT_BYTES,
  OWNERSHIP_REQUEST_BYTES,
  OpCode,
  PONG_EXTENDED_BYTES,
  SIGNAL_HEADER_BYTES,
  SIGNAL_MAX_PAYLOAD_BYTES,
  RECONCILE_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_RECORD_BYTES,
  SNAPSHOT_RECORD_QUANTIZED_BYTES,
  SnapshotFlags,
  TRANSFORM_UPDATE_BYTES,
} from './opcodes.js';
import {
  compressQuaternion,
  decompressQuaternion,
  type QuaternionLike,
} from './quaternion-compression.js';

/** Plain 3-component vector. */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/** A single entity transform as carried on the wire. */
export interface TransformRecord {
  networkId: number;
  position: Vector3Like;
  rotation: QuaternionLike;
}

/** Decoded {@link OpCode.SNAPSHOT} frame. */
export interface SnapshotFrame {
  serverTick: number;
  quantized: boolean;
  records: TransformRecord[];
}

/** Decoded {@link OpCode.INPUT_UPDATE} frame. */
export interface InputFrame {
  sequence: number;
  deltaMs: number;
  movement: { x: number; y: number };
  yaw: number;
  buttons: number;
}

/** Decoded {@link OpCode.RECONCILE} frame. */
export interface ReconcileFrame {
  networkId: number;
  lastProcessedSequence: number;
  position: Vector3Like;
}

/** Decoded {@link OpCode.SPAWN_ENTITY} frame. */
export interface SpawnFrame {
  networkId: number;
  prefabId: number;
  ownerId: number;
  position: Vector3Like;
  rotation: QuaternionLike;
}

/** Decoded {@link OpCode.OWNERSHIP_REQUEST} frame. */
export interface OwnershipRequestFrame {
  networkId: number;
  /** Client-chosen id, echoed in the grant so a client can match its request. */
  requestId: number;
}

/** Decoded {@link OpCode.OWNERSHIP_GRANT} frame. */
export interface OwnershipGrantFrame {
  networkId: number;
  /** Owner after arbitration. Meaningful whether or not the request succeeded. */
  ownerId: number;
  requestId: number;
  granted: boolean;
}

/** Decoded {@link OpCode.SIGNAL} frame. */
export interface SignalFrame {
  /** Intended recipient, or 0 to reach everyone else in the room. */
  targetNetworkId: number;
  /** Sender, stamped by the server so it cannot be forged by the client. */
  senderNetworkId: number;
  /** Opaque body — SDP or ICE, as far as this package is concerned. */
  payload: Uint8Array;
}

/**
 * Server timestamps carried by an extended {@link OpCode.PONG}.
 *
 * Absent when the peer answered with the legacy 9-byte form, which is how a
 * client tells "this server cannot be clock-synced" from "this reply was
 * lost" — the first degrades to RTT alone, the second is simply dropped.
 */
export interface PongTimes {
  /** Server receive time, in its own monotonic milliseconds. */
  t1: number;
  /** Server send time, same base. */
  t2: number;
  /** Server node's boot identifier; a change invalidates every past sample. */
  epoch: number;
}

/** Union of everything {@link BinaryProtocol.decode} can return. */
export type DecodedFrame =
  | { opCode: OpCode.TRANSFORM_UPDATE; transform: TransformRecord }
  | { opCode: OpCode.SNAPSHOT; snapshot: SnapshotFrame }
  | { opCode: OpCode.INPUT_UPDATE; input: InputFrame }
  | { opCode: OpCode.RECONCILE; reconcile: ReconcileFrame }
  | { opCode: OpCode.SPAWN_ENTITY; spawn: SpawnFrame }
  | { opCode: OpCode.DESPAWN_ENTITY; networkId: number }
  | { opCode: OpCode.PING | OpCode.PONG; timestamp: number; pong?: PongTimes }
  | { opCode: OpCode.OWNERSHIP_REQUEST; ownershipRequest: OwnershipRequestFrame }
  | { opCode: OpCode.OWNERSHIP_GRANT; ownershipGrant: OwnershipGrantFrame }
  | { opCode: OpCode.SIGNAL; signal: SignalFrame };

/** Thrown when a frame cannot be interpreted. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export class BinaryProtocol {
  // ---------------------------------------------------------------------------
  // TRANSFORM_UPDATE — 33 bytes, the canonical single-entity frame
  // ---------------------------------------------------------------------------

  /**
   * Encode one entity transform into the 33-byte layout:
   *
   * ```text
   * [0]     Uint8    OpCode (1)
   * [1..4]  Uint32   networkId
   * [5..16] Float32  position x, y, z
   * [17..32] Float32 rotation x, y, z, w
   * ```
   */
  static encodeTransform(
    networkId: number,
    position: Vector3Like,
    rotation: QuaternionLike,
  ): ArrayBuffer {
    const buffer = new ArrayBuffer(TRANSFORM_UPDATE_BYTES);
    const view = new DataView(buffer);

    view.setUint8(0, OpCode.TRANSFORM_UPDATE);
    view.setUint32(1, networkId, LITTLE_ENDIAN);

    view.setFloat32(5, position.x, LITTLE_ENDIAN);
    view.setFloat32(9, position.y, LITTLE_ENDIAN);
    view.setFloat32(13, position.z, LITTLE_ENDIAN);

    view.setFloat32(17, rotation.x, LITTLE_ENDIAN);
    view.setFloat32(21, rotation.y, LITTLE_ENDIAN);
    view.setFloat32(25, rotation.z, LITTLE_ENDIAN);
    view.setFloat32(29, rotation.w, LITTLE_ENDIAN);

    return buffer;
  }

  /** Decode a 33-byte {@link OpCode.TRANSFORM_UPDATE} frame. */
  static decodeTransform(buffer: ArrayBufferLike, byteOffset = 0): TransformRecord {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < TRANSFORM_UPDATE_BYTES) {
      throw new ProtocolError(
        `TRANSFORM_UPDATE needs ${TRANSFORM_UPDATE_BYTES} bytes, got ${view.byteLength}`,
      );
    }

    return {
      networkId: view.getUint32(1, LITTLE_ENDIAN),
      position: {
        x: view.getFloat32(5, LITTLE_ENDIAN),
        y: view.getFloat32(9, LITTLE_ENDIAN),
        z: view.getFloat32(13, LITTLE_ENDIAN),
      },
      rotation: {
        x: view.getFloat32(17, LITTLE_ENDIAN),
        y: view.getFloat32(21, LITTLE_ENDIAN),
        z: view.getFloat32(25, LITTLE_ENDIAN),
        w: view.getFloat32(29, LITTLE_ENDIAN),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // SNAPSHOT — batched transforms
  // ---------------------------------------------------------------------------

  /**
   * Encode many transforms into a single frame.
   *
   * Batching matters more than per-record size once a room holds more than a
   * handful of entities: each individual WebSocket frame costs framing bytes
   * plus a Phoenix message header, so N separate 33-byte frames are far more
   * expensive on the wire than one snapshot carrying N records.
   *
   * ```text
   * [0]     Uint8   OpCode (5)
   * [1]     Uint8   flags
   * [2..3]  Uint16  record count
   * [4..7]  Uint32  server tick
   * [8..]   records (32 bytes each, or 20 when QUANTIZED)
   * ```
   */
  static encodeSnapshot(
    records: readonly TransformRecord[],
    serverTick = 0,
    quantized = false,
  ): ArrayBuffer {
    const recordSize = quantized
      ? SNAPSHOT_RECORD_QUANTIZED_BYTES
      : SNAPSHOT_RECORD_BYTES;
    const buffer = new ArrayBuffer(
      SNAPSHOT_HEADER_BYTES + records.length * recordSize,
    );
    const view = new DataView(buffer);

    view.setUint8(0, OpCode.SNAPSHOT);
    view.setUint8(1, quantized ? SnapshotFlags.QUANTIZED : SnapshotFlags.NONE);
    view.setUint16(2, records.length, LITTLE_ENDIAN);
    view.setUint32(4, serverTick >>> 0, LITTLE_ENDIAN);

    let offset = SNAPSHOT_HEADER_BYTES;
    for (const record of records) {
      view.setUint32(offset, record.networkId, LITTLE_ENDIAN);
      view.setFloat32(offset + 4, record.position.x, LITTLE_ENDIAN);
      view.setFloat32(offset + 8, record.position.y, LITTLE_ENDIAN);
      view.setFloat32(offset + 12, record.position.z, LITTLE_ENDIAN);

      if (quantized) {
        view.setUint32(
          offset + 16,
          compressQuaternion(record.rotation),
          LITTLE_ENDIAN,
        );
      } else {
        view.setFloat32(offset + 16, record.rotation.x, LITTLE_ENDIAN);
        view.setFloat32(offset + 20, record.rotation.y, LITTLE_ENDIAN);
        view.setFloat32(offset + 24, record.rotation.z, LITTLE_ENDIAN);
        view.setFloat32(offset + 28, record.rotation.w, LITTLE_ENDIAN);
      }

      offset += recordSize;
    }

    return buffer;
  }

  /** Decode a {@link OpCode.SNAPSHOT} frame. */
  static decodeSnapshot(buffer: ArrayBufferLike, byteOffset = 0): SnapshotFrame {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < SNAPSHOT_HEADER_BYTES) {
      throw new ProtocolError('SNAPSHOT frame is shorter than its header');
    }

    const quantized = (view.getUint8(1) & SnapshotFlags.QUANTIZED) !== 0;
    const count = view.getUint16(2, LITTLE_ENDIAN);
    const serverTick = view.getUint32(4, LITTLE_ENDIAN);
    const recordSize = quantized
      ? SNAPSHOT_RECORD_QUANTIZED_BYTES
      : SNAPSHOT_RECORD_BYTES;

    const expected = SNAPSHOT_HEADER_BYTES + count * recordSize;
    if (view.byteLength < expected) {
      throw new ProtocolError(
        `SNAPSHOT declares ${count} records (${expected} bytes) but frame is ${view.byteLength} bytes`,
      );
    }

    const records: TransformRecord[] = new Array(count);
    let offset = SNAPSHOT_HEADER_BYTES;

    for (let i = 0; i < count; i++) {
      const networkId = view.getUint32(offset, LITTLE_ENDIAN);
      const position = {
        x: view.getFloat32(offset + 4, LITTLE_ENDIAN),
        y: view.getFloat32(offset + 8, LITTLE_ENDIAN),
        z: view.getFloat32(offset + 12, LITTLE_ENDIAN),
      };

      const rotation = quantized
        ? decompressQuaternion(view.getUint32(offset + 16, LITTLE_ENDIAN))
        : {
            x: view.getFloat32(offset + 16, LITTLE_ENDIAN),
            y: view.getFloat32(offset + 20, LITTLE_ENDIAN),
            z: view.getFloat32(offset + 24, LITTLE_ENDIAN),
            w: view.getFloat32(offset + 28, LITTLE_ENDIAN),
          };

      records[i] = { networkId, position, rotation };
      offset += recordSize;
    }

    return { serverTick, quantized, records };
  }

  // ---------------------------------------------------------------------------
  // INPUT_UPDATE — client intent for server-authoritative rooms
  // ---------------------------------------------------------------------------

  /**
   * ```text
   * [0]      Uint8   OpCode (2)
   * [1..4]   Uint32  sequence
   * [5..6]   Uint16  delta milliseconds
   * [7..10]  Float32 movement x
   * [11..14] Float32 movement y
   * [15..18] Float32 yaw (radians)
   * [19..21] Uint8x3 button bitmask (24 buttons)
   * ```
   */
  static encodeInput(input: InputFrame): ArrayBuffer {
    const buffer = new ArrayBuffer(INPUT_UPDATE_BYTES);
    const view = new DataView(buffer);

    view.setUint8(0, OpCode.INPUT_UPDATE);
    view.setUint32(1, input.sequence >>> 0, LITTLE_ENDIAN);
    // Clamp: a frame longer than 65 seconds is a stall, not a simulation step.
    view.setUint16(5, Math.min(65535, Math.max(0, Math.round(input.deltaMs))), LITTLE_ENDIAN);
    view.setFloat32(7, input.movement.x, LITTLE_ENDIAN);
    view.setFloat32(11, input.movement.y, LITTLE_ENDIAN);
    view.setFloat32(15, input.yaw, LITTLE_ENDIAN);

    const buttons = input.buttons >>> 0;
    view.setUint8(19, buttons & 0xff);
    view.setUint8(20, (buttons >>> 8) & 0xff);
    view.setUint8(21, (buttons >>> 16) & 0xff);

    return buffer;
  }

  /** Decode an {@link OpCode.INPUT_UPDATE} frame. */
  static decodeInput(buffer: ArrayBufferLike, byteOffset = 0): InputFrame {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < INPUT_UPDATE_BYTES) {
      throw new ProtocolError(
        `INPUT_UPDATE needs ${INPUT_UPDATE_BYTES} bytes, got ${view.byteLength}`,
      );
    }

    return {
      sequence: view.getUint32(1, LITTLE_ENDIAN),
      deltaMs: view.getUint16(5, LITTLE_ENDIAN),
      movement: {
        x: view.getFloat32(7, LITTLE_ENDIAN),
        y: view.getFloat32(11, LITTLE_ENDIAN),
      },
      yaw: view.getFloat32(15, LITTLE_ENDIAN),
      buttons:
        (view.getUint8(19) |
          (view.getUint8(20) << 8) |
          (view.getUint8(21) << 16)) >>>
        0,
    };
  }

  // ---------------------------------------------------------------------------
  // RECONCILE — authoritative correction
  // ---------------------------------------------------------------------------

  /**
   * ```text
   * [0]     Uint8   OpCode (6)
   * [1..4]  Uint32  networkId
   * [5..8]  Uint32  last processed input sequence
   * [9..20] Float32 authoritative position x, y, z
   * ```
   */
  static encodeReconcile(frame: ReconcileFrame): ArrayBuffer {
    const buffer = new ArrayBuffer(RECONCILE_BYTES);
    const view = new DataView(buffer);

    view.setUint8(0, OpCode.RECONCILE);
    view.setUint32(1, frame.networkId, LITTLE_ENDIAN);
    view.setUint32(5, frame.lastProcessedSequence >>> 0, LITTLE_ENDIAN);
    view.setFloat32(9, frame.position.x, LITTLE_ENDIAN);
    view.setFloat32(13, frame.position.y, LITTLE_ENDIAN);
    view.setFloat32(17, frame.position.z, LITTLE_ENDIAN);

    return buffer;
  }

  /** Decode an {@link OpCode.RECONCILE} frame. */
  static decodeReconcile(buffer: ArrayBufferLike, byteOffset = 0): ReconcileFrame {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < RECONCILE_BYTES) {
      throw new ProtocolError(
        `RECONCILE needs ${RECONCILE_BYTES} bytes, got ${view.byteLength}`,
      );
    }

    return {
      networkId: view.getUint32(1, LITTLE_ENDIAN),
      lastProcessedSequence: view.getUint32(5, LITTLE_ENDIAN),
      position: {
        x: view.getFloat32(9, LITTLE_ENDIAN),
        y: view.getFloat32(13, LITTLE_ENDIAN),
        z: view.getFloat32(17, LITTLE_ENDIAN),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // SPAWN / DESPAWN
  // ---------------------------------------------------------------------------

  /**
   * ```text
   * [0]      Uint8   OpCode (3)
   * [1..4]   Uint32  networkId
   * [5..8]   Uint32  prefabId
   * [9..12]  Uint32  ownerId
   * [13..24] Float32 position x, y, z
   * [25..40] Float32 rotation x, y, z, w
   * ```
   */
  static encodeSpawn(frame: SpawnFrame): ArrayBuffer {
    const buffer = new ArrayBuffer(41);
    const view = new DataView(buffer);

    view.setUint8(0, OpCode.SPAWN_ENTITY);
    view.setUint32(1, frame.networkId, LITTLE_ENDIAN);
    view.setUint32(5, frame.prefabId, LITTLE_ENDIAN);
    view.setUint32(9, frame.ownerId, LITTLE_ENDIAN);
    view.setFloat32(13, frame.position.x, LITTLE_ENDIAN);
    view.setFloat32(17, frame.position.y, LITTLE_ENDIAN);
    view.setFloat32(21, frame.position.z, LITTLE_ENDIAN);
    view.setFloat32(25, frame.rotation.x, LITTLE_ENDIAN);
    view.setFloat32(29, frame.rotation.y, LITTLE_ENDIAN);
    view.setFloat32(33, frame.rotation.z, LITTLE_ENDIAN);
    view.setFloat32(37, frame.rotation.w, LITTLE_ENDIAN);

    return buffer;
  }

  /** Decode an {@link OpCode.SPAWN_ENTITY} frame. */
  static decodeSpawn(buffer: ArrayBufferLike, byteOffset = 0): SpawnFrame {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < 41) {
      throw new ProtocolError(`SPAWN_ENTITY needs 41 bytes, got ${view.byteLength}`);
    }

    return {
      networkId: view.getUint32(1, LITTLE_ENDIAN),
      prefabId: view.getUint32(5, LITTLE_ENDIAN),
      ownerId: view.getUint32(9, LITTLE_ENDIAN),
      position: {
        x: view.getFloat32(13, LITTLE_ENDIAN),
        y: view.getFloat32(17, LITTLE_ENDIAN),
        z: view.getFloat32(21, LITTLE_ENDIAN),
      },
      rotation: {
        x: view.getFloat32(25, LITTLE_ENDIAN),
        y: view.getFloat32(29, LITTLE_ENDIAN),
        z: view.getFloat32(33, LITTLE_ENDIAN),
        w: view.getFloat32(37, LITTLE_ENDIAN),
      },
    };
  }

  /** Encode a 5-byte {@link OpCode.DESPAWN_ENTITY} frame. */
  static encodeDespawn(networkId: number): ArrayBuffer {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, OpCode.DESPAWN_ENTITY);
    view.setUint32(1, networkId, LITTLE_ENDIAN);
    return buffer;
  }

  // ---------------------------------------------------------------------------
  // PING / PONG
  // ---------------------------------------------------------------------------

  /**
   * Latency probe. The timestamp is a `Float64` so `performance.now()` survives
   * the round trip without losing sub-millisecond resolution.
   */
  static encodePing(timestamp: number, pong = false): ArrayBuffer {
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, pong ? OpCode.PONG : OpCode.PING);
    view.setFloat64(1, timestamp, LITTLE_ENDIAN);
    return buffer;
  }

  /**
   * Extended PONG — the server's half of a clock-sync exchange.
   *
   * Only three timestamps travel: `t3`, the moment the reply lands, is
   * stamped by whoever receives this frame. Sending it would be meaningless
   * anyway, since it belongs to the receiver's clock.
   */
  static encodePong(t0: number, t1: number, t2: number, epoch: number): ArrayBuffer {
    const buffer = new ArrayBuffer(PONG_EXTENDED_BYTES);
    const view = new DataView(buffer);
    view.setUint8(0, OpCode.PONG);
    view.setFloat64(1, t0, LITTLE_ENDIAN);
    view.setFloat64(9, t1, LITTLE_ENDIAN);
    view.setFloat64(17, t2, LITTLE_ENDIAN);
    view.setUint32(25, epoch, LITTLE_ENDIAN);
    return buffer;
  }

  // ---------------------------------------------------------------------------
  // Ownership transfer
  // ---------------------------------------------------------------------------

  /**
   * Ask the server for authority over an entity.
   *
   * ```text
   * [0]     Uint8   OpCode (9)
   * [1..4]  Uint32  networkId
   * [5..8]  Uint32  requestId
   * ```
   *
   * `requestId` is chosen by the client and echoed back in the grant, so a
   * client that has several requests in flight can tell which one was answered
   * without inferring it from ordering.
   */
  static encodeOwnershipRequest(networkId: number, requestId: number): ArrayBuffer {
    const buffer = new ArrayBuffer(OWNERSHIP_REQUEST_BYTES);
    const view = new DataView(buffer);
    view.setUint8(0, OpCode.OWNERSHIP_REQUEST);
    view.setUint32(1, networkId, LITTLE_ENDIAN);
    view.setUint32(5, requestId >>> 0, LITTLE_ENDIAN);
    return buffer;
  }

  /** Decode an {@link OpCode.OWNERSHIP_REQUEST} frame. */
  static decodeOwnershipRequest(
    buffer: ArrayBufferLike,
    byteOffset = 0,
  ): OwnershipRequestFrame {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < OWNERSHIP_REQUEST_BYTES) {
      throw new ProtocolError(
        `OWNERSHIP_REQUEST needs ${OWNERSHIP_REQUEST_BYTES} bytes, got ${view.byteLength}`,
      );
    }
    return {
      networkId: view.getUint32(1, LITTLE_ENDIAN),
      requestId: view.getUint32(5, LITTLE_ENDIAN),
    };
  }

  /**
   * The server's verdict, broadcast to the entire room.
   *
   * ```text
   * [0]      Uint8   OpCode (10)
   * [1..4]   Uint32  networkId
   * [5..8]   Uint32  ownerId after arbitration
   * [9..12]  Uint32  requestId
   * [13]     Uint8   1 = granted, 0 = denied
   * ```
   *
   * It goes to everyone, not just the requester, because ownership is room-wide
   * state: every peer needs to know who may now move the entity, and a denied
   * requester still learns the current owner from the same frame.
   */
  static encodeOwnershipGrant(frame: OwnershipGrantFrame): ArrayBuffer {
    const buffer = new ArrayBuffer(OWNERSHIP_GRANT_BYTES);
    const view = new DataView(buffer);
    view.setUint8(0, OpCode.OWNERSHIP_GRANT);
    view.setUint32(1, frame.networkId, LITTLE_ENDIAN);
    view.setUint32(5, frame.ownerId >>> 0, LITTLE_ENDIAN);
    view.setUint32(9, frame.requestId >>> 0, LITTLE_ENDIAN);
    view.setUint8(13, frame.granted ? 1 : 0);
    return buffer;
  }

  /** Decode an {@link OpCode.OWNERSHIP_GRANT} frame. */
  static decodeOwnershipGrant(
    buffer: ArrayBufferLike,
    byteOffset = 0,
  ): OwnershipGrantFrame {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < OWNERSHIP_GRANT_BYTES) {
      throw new ProtocolError(
        `OWNERSHIP_GRANT needs ${OWNERSHIP_GRANT_BYTES} bytes, got ${view.byteLength}`,
      );
    }
    return {
      networkId: view.getUint32(1, LITTLE_ENDIAN),
      ownerId: view.getUint32(5, LITTLE_ENDIAN),
      requestId: view.getUint32(9, LITTLE_ENDIAN),
      granted: view.getUint8(13) === 1,
    };
  }

  // ---------------------------------------------------------------------------
  // SIGNAL — opaque peer-to-peer relay
  // ---------------------------------------------------------------------------

  /**
   * Wrap an opaque signalling payload for relay through the server.
   *
   * ```text
   * [0]      Uint8   OpCode (11)
   * [1..4]   Uint32  targetNetworkId, 0 = everyone else
   * [5..8]   Uint32  senderNetworkId, stamped by the server
   * [9..10]  Uint16  payload length
   * [11..]   payload
   * ```
   *
   * The server never parses the payload. Keeping WebRTC negotiation opaque
   * means SDP and ICE can evolve — new codecs, trickle ICE, renegotiation —
   * without touching the server at all.
   *
   * `senderNetworkId` is overwritten server-side rather than trusted from the
   * client, so a peer cannot impersonate another during negotiation.
   */
  static encodeSignal(
    targetNetworkId: number,
    payload: Uint8Array,
    senderNetworkId = 0,
  ): ArrayBuffer {
    if (payload.byteLength > SIGNAL_MAX_PAYLOAD_BYTES) {
      throw new ProtocolError(
        `SIGNAL payload of ${payload.byteLength} bytes exceeds the ${SIGNAL_MAX_PAYLOAD_BYTES} byte cap`,
      );
    }

    const buffer = new ArrayBuffer(SIGNAL_HEADER_BYTES + payload.byteLength);
    const view = new DataView(buffer);

    view.setUint8(0, OpCode.SIGNAL);
    view.setUint32(1, targetNetworkId >>> 0, LITTLE_ENDIAN);
    view.setUint32(5, senderNetworkId >>> 0, LITTLE_ENDIAN);
    view.setUint16(9, payload.byteLength, LITTLE_ENDIAN);
    new Uint8Array(buffer, SIGNAL_HEADER_BYTES).set(payload);

    return buffer;
  }

  /** Decode a {@link OpCode.SIGNAL} frame. */
  static decodeSignal(buffer: ArrayBufferLike, byteOffset = 0): SignalFrame {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < SIGNAL_HEADER_BYTES) {
      throw new ProtocolError('SIGNAL frame is shorter than its header');
    }

    const length = view.getUint16(9, LITTLE_ENDIAN);
    if (view.byteLength < SIGNAL_HEADER_BYTES + length) {
      throw new ProtocolError(
        `SIGNAL declares ${length} payload bytes but frame carries ${view.byteLength - SIGNAL_HEADER_BYTES}`,
      );
    }

    return {
      targetNetworkId: view.getUint32(1, LITTLE_ENDIAN),
      senderNetworkId: view.getUint32(5, LITTLE_ENDIAN),
      // Copy rather than view: the caller keeps this past the frame's lifetime,
      // and on the ring-buffer path the backing bytes are reused immediately.
      payload: new Uint8Array(
        (buffer as ArrayBuffer).slice(
          byteOffset + SIGNAL_HEADER_BYTES,
          byteOffset + SIGNAL_HEADER_BYTES + length,
        ),
      ),
    };
  }

  /** Convenience: encode a UTF-8 string payload, e.g. JSON-encoded SDP. */
  static encodeSignalText(
    targetNetworkId: number,
    text: string,
    senderNetworkId = 0,
  ): ArrayBuffer {
    return BinaryProtocol.encodeSignal(
      targetNetworkId,
      new TextEncoder().encode(text),
      senderNetworkId,
    );
  }

  /** Convenience: read a signalling payload back as UTF-8 text. */
  static decodeSignalText(frame: SignalFrame): string {
    return new TextDecoder().decode(frame.payload);
  }

  // ---------------------------------------------------------------------------
  // Generic dispatch
  // ---------------------------------------------------------------------------

  /** Read the opcode of a frame without decoding its body. */
  static peekOpCode(buffer: ArrayBufferLike, byteOffset = 0): OpCode {
    const view = new DataView(buffer as ArrayBuffer, byteOffset);
    if (view.byteLength < 1) throw new ProtocolError('Empty frame');
    return view.getUint8(0) as OpCode;
  }

  /**
   * Decode any supported frame. Prefer the specific `decodeX` helpers on hot
   * paths where the opcode is already known — this dispatcher exists for the
   * receive loop, which cannot know the frame type ahead of time.
   */
  static decode(buffer: ArrayBufferLike, byteOffset = 0): DecodedFrame {
    const opCode = BinaryProtocol.peekOpCode(buffer, byteOffset);

    switch (opCode) {
      case OpCode.TRANSFORM_UPDATE:
        return {
          opCode,
          transform: BinaryProtocol.decodeTransform(buffer, byteOffset),
        };
      case OpCode.SNAPSHOT:
        return {
          opCode,
          snapshot: BinaryProtocol.decodeSnapshot(buffer, byteOffset),
        };
      case OpCode.INPUT_UPDATE:
        return { opCode, input: BinaryProtocol.decodeInput(buffer, byteOffset) };
      case OpCode.RECONCILE:
        return {
          opCode,
          reconcile: BinaryProtocol.decodeReconcile(buffer, byteOffset),
        };
      case OpCode.SPAWN_ENTITY:
        return { opCode, spawn: BinaryProtocol.decodeSpawn(buffer, byteOffset) };
      case OpCode.DESPAWN_ENTITY: {
        const view = new DataView(buffer as ArrayBuffer, byteOffset);
        if (view.byteLength < 5) {
          throw new ProtocolError('DESPAWN_ENTITY needs 5 bytes');
        }
        return { opCode, networkId: view.getUint32(1, LITTLE_ENDIAN) };
      }
      case OpCode.OWNERSHIP_REQUEST:
        return {
          opCode,
          ownershipRequest: BinaryProtocol.decodeOwnershipRequest(buffer, byteOffset),
        };
      case OpCode.OWNERSHIP_GRANT:
        return {
          opCode,
          ownershipGrant: BinaryProtocol.decodeOwnershipGrant(buffer, byteOffset),
        };
      case OpCode.SIGNAL:
        return { opCode, signal: BinaryProtocol.decodeSignal(buffer, byteOffset) };
      case OpCode.PING:
      case OpCode.PONG: {
        const view = new DataView(buffer as ArrayBuffer, byteOffset);
        if (view.byteLength < 9) throw new ProtocolError('PING/PONG needs 9 bytes');
        const timestamp = view.getFloat64(1, LITTLE_ENDIAN);

        // Discriminated by length, not by a version number: a server that
        // predates clock sync answers with 9 bytes and the caller simply sees
        // no `pong` — RTT still works, the offset just never appears.
        if (opCode === OpCode.PONG && view.byteLength >= PONG_EXTENDED_BYTES) {
          return {
            opCode,
            timestamp,
            pong: {
              t1: view.getFloat64(9, LITTLE_ENDIAN),
              t2: view.getFloat64(17, LITTLE_ENDIAN),
              epoch: view.getUint32(25, LITTLE_ENDIAN),
            },
          };
        }

        return { opCode, timestamp };
      }
      default:
        throw new ProtocolError(`Unknown opcode ${opCode}`);
    }
  }
}
