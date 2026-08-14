/**
 * The Cardinal type table.
 *
 * Run with Node's own test runner rather than vitest: these modules are build
 * tooling, they live outside the client package's `rootDir`, and testing them
 * with the runtime that consumes them keeps the two in step.
 *
 *   node --test scripts/__tests__/
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TYPES,
  fieldSize,
  fieldSlots,
  isVectorField,
} from '../../cardinal/types.mjs';

describe('cardinal type table', () => {
  it('gives every v1 scalar a byte size', () => {
    const expected = {
      bool: 1,
      u8: 1,
      u16: 2,
      u32: 4,
      i32: 4,
      f32: 4,
      f64: 8,
      vec3: 12,
      quat: 4,
    };

    for (const [name, bytes] of Object.entries(expected)) {
      assert.ok(TYPES[name], `missing type ${name}`);
      assert.equal(TYPES[name].bytes, bytes, `bytes for ${name}`);
    }
  });

  it('has exactly the v1 closed type set — no strings, no maps', () => {
    assert.deepEqual(Object.keys(TYPES).sort(), [
      'bool',
      'f32',
      'f64',
      'i32',
      'quat',
      'u16',
      'u32',
      'u8',
      'vec3',
    ]);
  });

  it('sizes a fixed-length array as element size times length', () => {
    assert.equal(fieldSize({ name: 'slots', type: 'array', of: 'u32', length: 16 }), 64);
  });

  it('sizes a scalar field from the table', () => {
    assert.equal(fieldSize({ name: 'hp', type: 'f32' }), 4);
  });

  it('rejects an unknown type rather than guessing a size', () => {
    assert.throws(() => fieldSize({ name: 'x', type: 'string' }), /unknown type/i);
  });

  it('rejects a malformed array length', () => {
    assert.throws(
      () => fieldSize({ name: 'x', type: 'array', of: 'u32', length: 0 }),
      /positive integer length/i,
    );
  });

  it('gives every type at least two distinct sample values', () => {
    for (const [name, entry] of Object.entries(TYPES)) {
      assert.ok(entry.samples.length >= 2, `samples for ${name}`);
    }
  });

  it('maps quat to four bytes because it uses smallest-three compression', () => {
    // Not 16: the existing u32 quaternion codec is reused wholesale.
    assert.equal(TYPES.quat.bytes, 4);
    assert.equal(TYPES.quat.ts, 'Vec4');
  });

  it('knows which fields are multi-slot, because that picks the ECS accessor', () => {
    // elics hands out a typed-array view for multi-slot fields and a plain
    // value for single-slot ones. Choosing wrong fails silently: the read
    // returns undefined and the component publishes zeros forever.
    assert.equal(fieldSlots({ name: 'hp', type: 'f32' }), 1);
    assert.equal(fieldSlots({ name: 'p', type: 'vec3' }), 3);
    assert.equal(fieldSlots({ name: 'r', type: 'quat' }), 4);
    assert.equal(fieldSlots({ name: 's', type: 'array', of: 'u32', length: 16 }), 16);

    assert.equal(isVectorField({ name: 'hp', type: 'f32' }), false);
    assert.equal(isVectorField({ name: 'p', type: 'vec3' }), true);
    assert.equal(isVectorField({ name: 'r', type: 'quat' }), true);
  });

  it('names the real quaternion codec functions', () => {
    // The repo exports compressQuaternion / decompressQuaternion — not
    // pack/unpack. A wrong name here becomes a generated file that will not
    // even parse, and the starting schema has no quat field, so nothing would
    // surface it for months. Pin it.
    const emitted = [
      TYPES.quat.read('view', '0'),
      TYPES.quat.write('view', '0', 'value'),
    ].join(' ');

    assert.match(emitted, /decompressQuaternion/);
    assert.match(emitted, /compressQuaternion/);
  });
});
