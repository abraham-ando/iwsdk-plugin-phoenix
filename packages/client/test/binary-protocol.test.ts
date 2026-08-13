import { describe, expect, it } from 'vitest';
import {
  BinaryProtocol,
  ProtocolError,
  type TransformRecord,
} from '../src/protocol/BinaryProtocol.js';
import {
  INPUT_UPDATE_BYTES,
  OpCode,
  RECONCILE_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_RECORD_BYTES,
  SNAPSHOT_RECORD_QUANTIZED_BYTES,
  TRANSFORM_UPDATE_BYTES,
} from '../src/protocol/opcodes.js';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

describe('TRANSFORM_UPDATE', () => {
  it('is exactly 33 bytes, as specified', () => {
    const buffer = BinaryProtocol.encodeTransform(1, { x: 0, y: 0, z: 0 }, IDENTITY);
    expect(buffer.byteLength).toBe(33);
    expect(TRANSFORM_UPDATE_BYTES).toBe(33);
  });

  it('lays fields out at the documented offsets, little-endian', () => {
    const buffer = BinaryProtocol.encodeTransform(
      0xdeadbeef,
      { x: 1, y: 2, z: 3 },
      { x: 0.5, y: 0.5, z: 0.5, w: 0.5 },
    );
    const view = new DataView(buffer);

    expect(view.getUint8(0)).toBe(OpCode.TRANSFORM_UPDATE);
    expect(view.getUint32(1, true)).toBe(0xdeadbeef);
    expect(view.getFloat32(5, true)).toBe(1);
    expect(view.getFloat32(9, true)).toBe(2);
    expect(view.getFloat32(13, true)).toBe(3);
    expect(view.getFloat32(29, true)).toBe(0.5);

    // Little-endian is part of the contract: the big-endian read must differ.
    expect(view.getUint32(1, false)).not.toBe(0xdeadbeef);
  });

  it('round-trips through decode', () => {
    const position = { x: -12.5, y: 0.25, z: 1024.75 };
    const rotation = { x: 0.5, y: -0.5, z: 0.5, w: -0.5 };

    const decoded = BinaryProtocol.decodeTransform(
      BinaryProtocol.encodeTransform(42, position, rotation),
    );

    expect(decoded.networkId).toBe(42);
    expect(decoded.position).toEqual(position);
    expect(decoded.rotation).toEqual(rotation);
  });

  it('handles the maximum Uint32 network id', () => {
    const decoded = BinaryProtocol.decodeTransform(
      BinaryProtocol.encodeTransform(4294967295, { x: 0, y: 0, z: 0 }, IDENTITY),
    );
    expect(decoded.networkId).toBe(4294967295);
  });

  it('rejects a truncated frame', () => {
    expect(() => BinaryProtocol.decodeTransform(new ArrayBuffer(10))).toThrow(
      ProtocolError,
    );
  });
});

describe('SNAPSHOT', () => {
  const records: TransformRecord[] = [
    { networkId: 1, position: { x: 1, y: 2, z: 3 }, rotation: IDENTITY },
    {
      networkId: 2,
      position: { x: -4, y: 5.5, z: -6.25 },
      // Math.fround: the wire stores Float32, so a Float64 literal such as
      // Math.SQRT1_2 could never survive an "exact" round-trip assertion.
      rotation: {
        x: 0,
        y: Math.fround(Math.SQRT1_2),
        z: 0,
        w: Math.fround(Math.SQRT1_2),
      },
    },
    { networkId: 999, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY },
  ];

  it('sizes uncompressed frames as header + 32 bytes per record', () => {
    const buffer = BinaryProtocol.encodeSnapshot(records, 7);
    expect(buffer.byteLength).toBe(
      SNAPSHOT_HEADER_BYTES + records.length * SNAPSHOT_RECORD_BYTES,
    );
  });

  it('sizes quantized frames as header + 20 bytes per record', () => {
    const buffer = BinaryProtocol.encodeSnapshot(records, 7, true);
    expect(buffer.byteLength).toBe(
      SNAPSHOT_HEADER_BYTES + records.length * SNAPSHOT_RECORD_QUANTIZED_BYTES,
    );
  });

  it('round-trips uncompressed records exactly', () => {
    const frame = BinaryProtocol.decodeSnapshot(
      BinaryProtocol.encodeSnapshot(records, 12345),
    );

    expect(frame.serverTick).toBe(12345);
    expect(frame.quantized).toBe(false);
    expect(frame.records).toEqual(records);
  });

  it('round-trips quantized records within the compression tolerance', () => {
    const frame = BinaryProtocol.decodeSnapshot(
      BinaryProtocol.encodeSnapshot(records, 1, true),
    );

    expect(frame.quantized).toBe(true);
    expect(frame.records).toHaveLength(records.length);

    frame.records.forEach((decoded, index) => {
      const original = records[index]!;
      // Position stays Float32 -> exact.
      expect(decoded.position).toEqual(original.position);
      expect(decoded.networkId).toBe(original.networkId);
      // Rotation is lossy but must stay very close.
      expect(decoded.rotation.x).toBeCloseTo(original.rotation.x, 2);
      expect(decoded.rotation.y).toBeCloseTo(original.rotation.y, 2);
      expect(decoded.rotation.z).toBeCloseTo(original.rotation.z, 2);
      expect(decoded.rotation.w).toBeCloseTo(original.rotation.w, 2);
    });
  });

  it('handles an empty snapshot', () => {
    const frame = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot([], 3));
    expect(frame.records).toEqual([]);
    expect(frame.serverTick).toBe(3);
  });

  it('only beats N individual frames on raw bytes once N > 8', () => {
    // A snapshot record is 32 bytes against 33 for a flat frame, so the 8-byte
    // header is only repaid from the ninth entity onward. Stating the real
    // crossover keeps the batching decision honest.
    const rawCrossover = (n: number) => {
      const batched = SNAPSHOT_HEADER_BYTES + n * SNAPSHOT_RECORD_BYTES;
      const individual = n * TRANSFORM_UPDATE_BYTES;
      return batched < individual;
    };

    expect(rawCrossover(3)).toBe(false);
    expect(rawCrossover(8)).toBe(false);
    expect(rawCrossover(9)).toBe(true);
  });

  it('beats N individual frames decisively once per-message overhead counts', () => {
    // Raw payload size is not what actually travels. Every Phoenix binary
    // message carries a header (kind + join_ref/ref/topic/event lengths and
    // their bytes); for a topic like "room:lobby" that is ~19 bytes, before
    // WebSocket framing. That overhead is paid per message, so batching wins
    // immediately rather than at the raw crossover.
    const PHOENIX_MESSAGE_OVERHEAD = 19;

    const batched =
      PHOENIX_MESSAGE_OVERHEAD + BinaryProtocol.encodeSnapshot(records).byteLength;
    const individual =
      records.length * (PHOENIX_MESSAGE_OVERHEAD + TRANSFORM_UPDATE_BYTES);

    expect(batched).toBeLessThan(individual);

    // And the quantized form wins on raw bytes too, at any count.
    const quantized = BinaryProtocol.encodeSnapshot(records, 0, true).byteLength;
    expect(quantized).toBeLessThan(records.length * TRANSFORM_UPDATE_BYTES);
  });

  it('rejects a frame whose declared count exceeds its payload', () => {
    const buffer = BinaryProtocol.encodeSnapshot(records);
    // Claim 100 records while carrying 3.
    new DataView(buffer).setUint16(2, 100, true);
    expect(() => BinaryProtocol.decodeSnapshot(buffer)).toThrow(ProtocolError);
  });
});

describe('INPUT_UPDATE', () => {
  it('round-trips, including the 24-bit button mask', () => {
    const input = {
      sequence: 123456,
      deltaMs: 16,
      movement: { x: -1, y: 0.5 },
      yaw: 1.5707963705062866, // Float32-representable
      buttons: 0xabcdef,
    };

    const buffer = BinaryProtocol.encodeInput(input);
    expect(buffer.byteLength).toBe(INPUT_UPDATE_BYTES);

    expect(BinaryProtocol.decodeInput(buffer)).toEqual(input);
  });

  it('clamps an absurd delta instead of overflowing the Uint16', () => {
    const decoded = BinaryProtocol.decodeInput(
      BinaryProtocol.encodeInput({
        sequence: 1,
        deltaMs: 999999,
        movement: { x: 0, y: 0 },
        yaw: 0,
        buttons: 0,
      }),
    );
    expect(decoded.deltaMs).toBe(65535);
  });
});

describe('RECONCILE', () => {
  it('round-trips', () => {
    const frame = {
      networkId: 77,
      lastProcessedSequence: 4242,
      position: { x: 10, y: -2.5, z: 0.125 },
    };
    const buffer = BinaryProtocol.encodeReconcile(frame);
    expect(buffer.byteLength).toBe(RECONCILE_BYTES);
    expect(BinaryProtocol.decodeReconcile(buffer)).toEqual(frame);
  });
});

describe('SPAWN / DESPAWN', () => {
  it('round-trips a spawn', () => {
    const frame = {
      networkId: 5,
      prefabId: 9,
      ownerId: 3,
      position: { x: 1, y: 2, z: 3 },
      rotation: IDENTITY,
    };
    expect(BinaryProtocol.decodeSpawn(BinaryProtocol.encodeSpawn(frame))).toEqual(
      frame,
    );
  });

  it('encodes a despawn in 5 bytes', () => {
    const buffer = BinaryProtocol.encodeDespawn(88);
    expect(buffer.byteLength).toBe(5);

    const decoded = BinaryProtocol.decode(buffer);
    expect(decoded.opCode).toBe(OpCode.DESPAWN_ENTITY);
    if (decoded.opCode === OpCode.DESPAWN_ENTITY) {
      expect(decoded.networkId).toBe(88);
    }
  });
});

describe('generic decode dispatch', () => {
  it('routes each opcode to the right decoder', () => {
    const transform = BinaryProtocol.decode(
      BinaryProtocol.encodeTransform(1, { x: 0, y: 0, z: 0 }, IDENTITY),
    );
    expect(transform.opCode).toBe(OpCode.TRANSFORM_UPDATE);

    const snapshot = BinaryProtocol.decode(BinaryProtocol.encodeSnapshot([], 0));
    expect(snapshot.opCode).toBe(OpCode.SNAPSHOT);

    const ping = BinaryProtocol.decode(BinaryProtocol.encodePing(1234.5));
    expect(ping.opCode).toBe(OpCode.PING);
    if (ping.opCode === OpCode.PING) {
      // Float64 preserves performance.now() precision exactly.
      expect(ping.timestamp).toBe(1234.5);
    }

    const pong = BinaryProtocol.decode(BinaryProtocol.encodePing(9, true));
    expect(pong.opCode).toBe(OpCode.PONG);
  });

  it('throws on an unknown opcode', () => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setUint8(0, 200);
    expect(() => BinaryProtocol.decode(buffer)).toThrow(/Unknown opcode 200/);
  });

  it('throws on an empty frame', () => {
    expect(() => BinaryProtocol.decode(new ArrayBuffer(0))).toThrow(ProtocolError);
  });
});
