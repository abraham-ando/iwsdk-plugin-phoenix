/**
 * The v1 Cardinal type system.
 *
 * Closed on purpose. Every type here has a constant byte size, which is what
 * lets a COMPONENT_UPDATE record carry no length field: the reader looks the
 * component up and knows how far to advance. Strings and maps would break
 * that, and the SIGNAL frame already carries variable-length blobs — so they
 * arrive when a real component needs them, not before.
 *
 * `read` and `write` return *source code strings*, not values: this table is
 * consumed by a generator, and emitting straight-line DataView calls beats
 * shipping an interpreter to the hot path.
 */

/**
 * `slots` is how many storage slots the field occupies, and it decides the ECS
 * accessor: elics hands out a typed-array view for multi-slot fields and a
 * plain value for single-slot ones. Omitted means 1.
 *
 * `quat` is 4 bytes rather than 16 because the existing smallest-three u32
 * codec is reused wholesale — but it still occupies a 4-slot `Vec4` in
 * storage, which is why the codec converts between the two shapes.
 */
export const TYPES = Object.freeze({
  bool: {
    bytes: 1,
    ts: 'Boolean',
    elixir: 'boolean()',
    read: (v, o) => `(${v}.getUint8(${o}) !== 0)`,
    write: (v, o, x) => `${v}.setUint8(${o}, ${x} ? 1 : 0)`,
    samples: [false, true],
  },
  u8: {
    bytes: 1,
    ts: 'Int32',
    elixir: 'non_neg_integer()',
    read: (v, o) => `${v}.getUint8(${o})`,
    write: (v, o, x) => `${v}.setUint8(${o}, ${x})`,
    samples: [0, 255, 7],
  },
  u16: {
    bytes: 2,
    ts: 'Int32',
    elixir: 'non_neg_integer()',
    read: (v, o) => `${v}.getUint16(${o}, true)`,
    write: (v, o, x) => `${v}.setUint16(${o}, ${x}, true)`,
    samples: [0, 65535, 4096],
  },
  u32: {
    // elics has no unsigned 32-bit storage, so the ECS side widens to Int32.
    // Allocate values from the positive range, exactly as `Networked.networkId`
    // already documents.
    bytes: 4,
    ts: 'Int32',
    elixir: 'non_neg_integer()',
    read: (v, o) => `${v}.getUint32(${o}, true)`,
    write: (v, o, x) => `${v}.setUint32(${o}, ${x}, true)`,
    samples: [0, 2147483647, 42],
  },
  i32: {
    bytes: 4,
    ts: 'Int32',
    elixir: 'integer()',
    read: (v, o) => `${v}.getInt32(${o}, true)`,
    write: (v, o, x) => `${v}.setInt32(${o}, ${x}, true)`,
    samples: [0, -2147483648, 2147483647],
  },
  f32: {
    bytes: 4,
    ts: 'Float32',
    elixir: 'float()',
    read: (v, o) => `${v}.getFloat32(${o}, true)`,
    write: (v, o, x) => `${v}.setFloat32(${o}, ${x}, true)`,
    samples: [0, 1.5, -2.25],
  },
  f64: {
    bytes: 8,
    ts: 'Float64',
    elixir: 'float()',
    read: (v, o) => `${v}.getFloat64(${o}, true)`,
    write: (v, o, x) => `${v}.setFloat64(${o}, ${x}, true)`,
    samples: [0, 1234.5, -0.125],
  },
  vec3: {
    bytes: 12,
    ts: 'Vec3',
    elixir: 'IwsdkPhoenix.Protocol.vec3()',
    slots: 3,
    read: (v, o) =>
      `[${v}.getFloat32(${o}, true), ${v}.getFloat32(${o} + 4, true), ${v}.getFloat32(${o} + 8, true)]`,
    write: (v, o, x) =>
      `${v}.setFloat32(${o}, ${x}[0], true); ${v}.setFloat32(${o} + 4, ${x}[1], true); ${v}.setFloat32(${o} + 8, ${x}[2], true)`,
    samples: [
      [0, 0, 0],
      [1, -2, 3.5],
    ],
  },
  quat: {
    bytes: 4,
    ts: 'Vec4',
    // Storage is an elics Vec4 (a 4-slot array), but the existing codec speaks
    // `{x, y, z, w}` objects — hence the conversion on both sides. Verified
    // names: `compressQuaternion` / `decompressQuaternion` in
    // protocol/quaternion-compression.ts.
    elixir: 'IwsdkPhoenix.Protocol.quat()',
    slots: 4,
    read: (v, o) => `quatToSlots(decompressQuaternion(${v}.getUint32(${o}, true)))`,
    write: (v, o, x) => `${v}.setUint32(${o}, compressQuaternion(slotsToQuat(${x})), true)`,
    samples: [
      [0, 0, 0, 1],
      [0, 0.7071067811865476, 0, 0.7071067811865476],
    ],
  },
});

/** Name of a field's element type, for both scalars and arrays. */
export function fieldTypeName(field) {
  return field.type === 'array' ? field.of : field.type;
}

/** Byte size of a field. Throws rather than guessing — see the v1 closed set. */
export function fieldSize(field) {
  const name = fieldTypeName(field);
  const entry = TYPES[name];
  if (!entry) throw new Error(`unknown type "${name}" on field "${field.name}"`);
  if (field.type !== 'array') return entry.bytes;

  if (!Number.isInteger(field.length) || field.length < 1) {
    throw new Error(`array field "${field.name}" needs a positive integer length`);
  }
  return entry.bytes * field.length;
}

/**
 * How many storage slots a field occupies.
 *
 * This is what decides the ECS accessor: elics hands out a typed-array view
 * for multi-slot fields (`getVectorView`) and a plain value for single-slot
 * ones (`getValue`). Getting it wrong is silent — you read `undefined` and
 * publish zeros.
 */
export function fieldSlots(field) {
  if (field.type === 'array') return field.length;
  return TYPES[fieldTypeName(field)].slots ?? 1;
}

/** True when a field must be reached through `getVectorView`. */
export function isVectorField(field) {
  return fieldSlots(field) > 1;
}
