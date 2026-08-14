# Cardinal Unified Component Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define every replicated component once in a neutral schema and generate the TypeScript ECS definitions, the Elixir structs, the binary codecs, and the parity vectors from it.

**Architecture:** A hand-written JS schema module is the single source of truth. One generator emits three committed artifacts — a client module, a server module, and golden-vector rows — plus a schema hash both sides compare at join. Components travel in a new batched `COMPONENT_UPDATE` frame; systems stay hand-written and idiomatic on each side.

**Tech Stack:** Node ESM generator (no dependencies), TypeScript + vitest, Elixir + ExUnit, the repo's existing golden-vector parity pipeline.

**Spec:** `docs/superpowers/specs/2026-08-14-cardinal-runtime-design.md` — read it first; every decision below argues from it.

## Global Constraints

- All multi-byte wire fields are **little-endian** (`LITTLE_ENDIAN` in `BinaryProtocol.ts`, `-little-` in `protocol.ex`).
- The v1 type system is **closed**: `bool, u8, u16, u32, i32, f32, f64, vec3, quat`, plus fixed-length arrays `{ type: 'array', of: <scalar>, length: <n> }`. No strings, no maps.
- Component `id` is **explicit and permanent**; never derived from file order, never recycled after removal.
- Every component has a **constant `byteSize`** — the property the wire format depends on.
- Generated files are **committed**, deterministic (sorted by id, no timestamps), and carry a `GENERATED — do not edit` header.
- No new runtime dependencies, client or server.
- TDD: each task writes its failing test first and commits when green.
- The generator runs as `node --experimental-strip-types scripts/generate-cardinal.mjs` — it imports the generated TypeScript so the golden vectors are produced by the codec that actually ships.
- Repo facts this plan relies on, **each verified against the code on 2026-08-14** — the ones marked ⚠ contradicted an earlier draft of this plan and are the reason for this list:
  - `Room.State` is a flat `defstruct` with no component concept.
  - `PhoenixNetworkSystem.handleMessage` is the single ingestion switch (~line 449).
  - `Handler.dispatch/4` branches per mode with `cond`; `Handler.validate_join/1` reads string-keyed params and is already covered by tests in `packages/server/test/room_test.exs:300`.
  - The client passes join params in `PhoenixConnection.connect` (~line 113).
  - `elics` has no unsigned 32-bit storage type, so `u32` maps to `Types.Int32`.
  - ⚠ **Multi-slot fields are reached with `entity.getVectorView(Component, 'field')`, never `getValue`/`setValue`.** Every `Vec3`/`Vec4` access in the repo uses the view; `setValue` appears only on scalars. Using `getValue` on a vector field fails *silently* — it returns `undefined` and the component publishes zeros.
  - ⚠ **The quaternion codec is `compressQuaternion` / `decompressQuaternion`** (`protocol/quaternion-compression.ts`) and `compress_quaternion` / `decompress_quaternion` (`IwsdkPhoenix.Protocol.Quantization`). It speaks `{x, y, z, w}` objects, while elics `Vec4` storage is a 4-slot array — conversion is required at the boundary.
  - ⚠ **`jason` is an *optional* dependency of `packages/server`.** Nothing in the test path may require it, which is why the fixture format is flat scalars rather than JSON.
  - ⚠ **There is no ownership predicate to reuse in `handler.ex`.** In `host_relayed` the transform path *swallows* ownership failures and relays anyway; `client_authority_denied` exists only in `server_authoritative`. Components follow this exactly — see Task 9.
  - ⚠ **`entity.addComponent(Component)` takes no initial values**; set them afterwards (`packages/client/test/replication.test.ts:62`).
  - `SpatialGrid.cell_topic/1` exists but is not wired to any broadcast: area-of-interest filtering happens through `SpatialGrid.within?/3` on the server-authoritative snapshot path only. Component frames therefore ride the same unfiltered room broadcast as transforms in `host_relayed` — consistent, and out of scope here.

## File Structure

| File | Role |
|---|---|
| `cardinal/components.mjs` (create) | the schema — hand-written source of truth |
| `cardinal/types.mjs` (create) | type table: byte size, TS/Elixir mapping, codec emission, test values |
| `scripts/generate-cardinal.mjs` (create) | validate schema, emit all three artifacts |
| `scripts/check-cardinal-drift.mjs` (create) | regenerate into a temp dir, diff against committed |
| `packages/client/src/cardinal/components.generated.ts` (generated) | elics definitions, codecs, registry, `SCHEMA_HASH` |
| `packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex` (generated) | per-component modules, `Registry`, `schema_hash/0` |
| `fixtures/protocol_vectors.tsv` (modify) | `cardinal`, `cardinal_schema_hash`, `component_update` rows |
| `packages/client/src/protocol/opcodes.ts` (modify) | `COMPONENT_UPDATE = 12`, header/record size constants |
| `packages/client/src/protocol/BinaryProtocol.ts` (modify) | `encodeComponentUpdate` / `decodeComponentUpdate` |
| `packages/server/lib/iwsdk_phoenix/protocol.ex` (modify) | `@op_component_update 12`, encode/decode |
| `packages/server/lib/iwsdk_phoenix/cardinal/cache.ex` (create) | the `(network_id, component_id)` cache, both modes |
| `packages/server/lib/iwsdk_phoenix/room/state.ex` (modify) | `components:` field + accessors |
| `packages/server/lib/iwsdk_phoenix/room/handler.ex` (modify) | op-12 clause in both dispatch branches |
| `packages/server/lib/iwsdk_phoenix/room_channel.ex` (modify) | schema-hash join check, cache replay in `after_join` |
| `packages/client/src/cardinal/publish.ts` (create) | dirty-by-memcmp outbound tracker |
| `packages/client/src/systems/PhoenixNetworkSystem.ts` (modify) | ingest op 12, publish changed components |
| `packages/client/src/plugin.ts` (modify) | call `registerCardinalComponents(world)` |
| `packages/client/src/transport/PhoenixConnection.ts` (modify) | send `schema_hash` in join params |
| `docs/PROTOCOL.md` (modify) | opcode table + `COMPONENT_UPDATE` section |

---

### Task 1: Type table

**Files:**
- Create: `cardinal/types.mjs`
- Test: `scripts/__tests__/cardinal-types.test.mjs` (run by vitest from the client package — see Step 2 for the exact command)

**Interfaces:**
- Consumes: nothing.
- Produces: `TYPES` — a frozen object keyed by type name, each entry `{ bytes, arity, ts, elixir, read, write, samples }` where `arity` is how many numeric slots elics stores (1 for scalars, 3 for `vec3`, 4 for `quat`), `ts` is the elics `Types.*` member name, `elixir` is a typespec string, `read(view, offset)` / `write(view, offset, value)` emit **source-code strings**, and `samples` is an array of representative values. Also `fieldSize(field)`, `fieldTypeName(field)`, `fieldArity(field)`. Tasks 2–4 consume all of these.

- [ ] **Step 1: Write the failing test**

```js
// scripts/__tests__/cardinal-types.test.mjs
import { describe, expect, it } from 'vitest';
import {
  TYPES,
  fieldSize,
  fieldSlots,
  isVectorField,
} from '../../cardinal/types.mjs';

describe('cardinal type table', () => {
  it('gives every v1 scalar a byte size', () => {
    const expected = {
      bool: 1, u8: 1, u16: 2, u32: 4, i32: 4,
      f32: 4, f64: 8, vec3: 12, quat: 4,
    };
    for (const [name, bytes] of Object.entries(expected)) {
      expect(TYPES[name], `missing type ${name}`).toBeDefined();
      expect(TYPES[name].bytes, `bytes for ${name}`).toBe(bytes);
    }
  });

  it('has exactly the v1 closed type set — no strings, no maps', () => {
    expect(Object.keys(TYPES).sort()).toEqual(
      ['bool', 'f32', 'f64', 'i32', 'quat', 'u16', 'u32', 'u8', 'vec3'],
    );
  });

  it('sizes a fixed-length array as element size times length', () => {
    expect(fieldSize({ name: 'slots', type: 'array', of: 'u32', length: 16 })).toBe(64);
  });

  it('sizes a scalar field from the table', () => {
    expect(fieldSize({ name: 'hp', type: 'f32' })).toBe(4);
  });

  it('rejects an unknown type rather than guessing a size', () => {
    expect(() => fieldSize({ name: 'x', type: 'string' })).toThrow(/unknown type/i);
  });

  it('gives every type at least two distinct sample values', () => {
    for (const [name, entry] of Object.entries(TYPES)) {
      expect(entry.samples.length, `samples for ${name}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('maps quat to four bytes because it uses smallest-three compression', () => {
    // Not 16: the existing u32 quaternion codec is reused wholesale.
    expect(TYPES.quat.bytes).toBe(4);
    expect(TYPES.quat.ts).toBe('Vec4');
  });

  it('knows which fields are multi-slot, because that picks the ECS accessor', () => {
    // elics hands out a typed-array view for multi-slot fields and a plain
    // value for single-slot ones. Choosing wrong fails silently: the read
    // returns undefined and the component publishes zeros forever.
    expect(fieldSlots({ name: 'hp', type: 'f32' })).toBe(1);
    expect(fieldSlots({ name: 'p', type: 'vec3' })).toBe(3);
    expect(fieldSlots({ name: 'r', type: 'quat' })).toBe(4);
    expect(fieldSlots({ name: 's', type: 'array', of: 'u32', length: 16 })).toBe(16);

    expect(isVectorField({ name: 'hp', type: 'f32' })).toBe(false);
    expect(isVectorField({ name: 'p', type: 'vec3' })).toBe(true);
    expect(isVectorField({ name: 'r', type: 'quat' })).toBe(true);
  });

  it('names the real quaternion codec functions', () => {
    // The repo exports compressQuaternion / decompressQuaternion — not
    // pack/unpack. A wrong name here becomes a generated file that will not
    // even parse, so pin it.
    const emitted = [
      TYPES.quat.read('view', '0'),
      TYPES.quat.write('view', '0', 'value'),
    ].join(' ');
    expect(emitted).toContain('decompressQuaternion');
    expect(emitted).toContain('compressQuaternion');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix exec vitest run --root ../.. scripts/__tests__/cardinal-types.test.mjs`

If that root override is awkward in this repo's vitest config, instead add `scripts/__tests__/**/*.test.mjs` to the client package's vitest `include` and run `pnpm --filter @iwsdk/plugin-phoenix test -- cardinal-types`. Pick one and use it consistently for Tasks 1–2.

Expected: FAIL — `cardinal/types.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// cardinal/types.mjs
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

/** `quat` reuses the existing smallest-three u32 codec, hence 4 bytes not 16. */
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
    samples: [[0, 0, 0], [1, -2, 3.5]],
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
    samples: [[0, 0, 0, 1], [0, 0.7071067811865476, 0, 0.7071067811865476]],
  },
});

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
```

- [ ] **Step 4: Run test to verify it passes**

Run the command chosen in Step 2.
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add cardinal/types.mjs scripts/__tests__/cardinal-types.test.mjs
git commit -m "feat(cardinal): closed v1 type table with fixed byte sizes"
```

---

### Task 2: Schema and validator

**Files:**
- Create: `cardinal/components.mjs`
- Create: `cardinal/validate.mjs`
- Test: `scripts/__tests__/cardinal-validate.test.mjs`

**Interfaces:**
- Consumes: `TYPES`, `fieldSize`, `fieldTypeName` (Task 1).
- Produces: `validateSchema(components) -> void` (throws on any violation); `componentSize(component) -> number`; `schemaHash(components) -> string` (8 lowercase hex chars); and `cardinal/components.mjs` exporting `components`. Tasks 3–4 consume all four.

- [ ] **Step 1: Write the failing test**

```js
// scripts/__tests__/cardinal-validate.test.mjs
import { describe, expect, it } from 'vitest';
import {
  componentSize,
  schemaHash,
  validateSchema,
} from '../../cardinal/validate.mjs';
import { components } from '../../cardinal/components.mjs';

const ok = [
  { id: 1, name: 'Health', fields: [{ name: 'current', type: 'f32' }] },
];

describe('validateSchema', () => {
  it('accepts the committed schema', () => {
    expect(() => validateSchema(components)).not.toThrow();
  });

  it('rejects duplicate ids — an id is a permanent wire identity', () => {
    expect(() =>
      validateSchema([...ok, { id: 1, name: 'Other', fields: [{ name: 'a', type: 'u8' }] }]),
    ).toThrow(/duplicate id/i);
  });

  it('rejects duplicate names', () => {
    expect(() =>
      validateSchema([...ok, { id: 2, name: 'Health', fields: [{ name: 'a', type: 'u8' }] }]),
    ).toThrow(/duplicate name/i);
  });

  it('rejects an id outside the u16 wire range', () => {
    expect(() =>
      validateSchema([{ id: 70000, name: 'Big', fields: [{ name: 'a', type: 'u8' }] }]),
    ).toThrow(/id .* range/i);
  });

  it('rejects id 0 — reserved, like network id 0', () => {
    expect(() =>
      validateSchema([{ id: 0, name: 'Zero', fields: [{ name: 'a', type: 'u8' }] }]),
    ).toThrow(/id .* range/i);
  });

  it('rejects a component name that is not PascalCase', () => {
    // Must be a legal TS identifier AND a legal Elixir module segment.
    expect(() =>
      validateSchema([{ id: 1, name: 'health-bar', fields: [{ name: 'a', type: 'u8' }] }]),
    ).toThrow(/PascalCase/i);
  });

  it('rejects a field name that is not snake-safe camelCase', () => {
    expect(() =>
      validateSchema([{ id: 1, name: 'Health', fields: [{ name: 'Current-HP', type: 'u8' }] }]),
    ).toThrow(/field name/i);
  });

  it('rejects an unknown field type', () => {
    expect(() =>
      validateSchema([{ id: 1, name: 'Health', fields: [{ name: 'label', type: 'string' }] }]),
    ).toThrow(/unknown type/i);
  });

  it('rejects a component with no fields', () => {
    expect(() => validateSchema([{ id: 1, name: 'Empty', fields: [] }])).toThrow(/at least one/i);
  });

  it('rejects duplicate field names inside one component', () => {
    expect(() =>
      validateSchema([
        { id: 1, name: 'Health', fields: [{ name: 'a', type: 'u8' }, { name: 'a', type: 'u8' }] },
      ]),
    ).toThrow(/duplicate field/i);
  });
});

describe('componentSize', () => {
  it('sums its fields', () => {
    expect(
      componentSize({
        id: 2,
        name: 'Grabbable',
        fields: [
          { name: 'holderId', type: 'u32' },
          { name: 'grabPoint', type: 'vec3' },
        ],
      }),
    ).toBe(16);
  });
});

describe('schemaHash', () => {
  it('is eight lowercase hex characters', () => {
    expect(schemaHash(components)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is stable across calls', () => {
    expect(schemaHash(components)).toBe(schemaHash(components));
  });

  it('ignores component order — ids are the identity, not position', () => {
    const forward = [
      { id: 1, name: 'A', fields: [{ name: 'x', type: 'u8' }] },
      { id: 2, name: 'B', fields: [{ name: 'y', type: 'u8' }] },
    ];
    expect(schemaHash(forward)).toBe(schemaHash([...forward].reverse()));
  });

  it('changes when a field type changes', () => {
    const before = [{ id: 1, name: 'A', fields: [{ name: 'x', type: 'u8' }] }];
    const after = [{ id: 1, name: 'A', fields: [{ name: 'x', type: 'u16' }] }];
    expect(schemaHash(before)).not.toBe(schemaHash(after));
  });

  it('changes when a field is renamed', () => {
    const before = [{ id: 1, name: 'A', fields: [{ name: 'x', type: 'u8' }] }];
    const after = [{ id: 1, name: 'A', fields: [{ name: 'z', type: 'u8' }] }];
    expect(schemaHash(before)).not.toBe(schemaHash(after));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run the Task-1 command with `cardinal-validate` instead.
Expected: FAIL — `cardinal/validate.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// cardinal/validate.mjs
/**
 * Schema validation and hashing.
 *
 * Everything downstream — both generated runtimes, the parity vectors, the
 * wire format — assumes a valid schema, so this is the only place that checks.
 * What ships is correct by construction and the hot path re-validates nothing.
 */
import { createHash } from 'node:crypto';
import { TYPES, fieldSize, fieldTypeName } from './types.mjs';

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;

/** Throws on the first violation, naming the offending component and field. */
export function validateSchema(components) {
  if (!Array.isArray(components)) throw new Error('schema must be an array');

  const seenIds = new Map();
  const seenNames = new Map();

  for (const component of components) {
    const { id, name, fields } = component;

    // u16 on the wire, and 0 is reserved for the same reason network id 0 is:
    // it has to mean "absent" without colliding with a real component.
    if (!Number.isInteger(id) || id < 1 || id > 65535) {
      throw new Error(`component "${name}": id ${id} out of range (1..65535)`);
    }
    if (seenIds.has(id)) {
      throw new Error(`duplicate id ${id}: "${seenIds.get(id)}" and "${name}"`);
    }
    seenIds.set(id, name);

    // Has to be a legal TS identifier *and* a legal Elixir module segment.
    if (typeof name !== 'string' || !PASCAL_CASE.test(name)) {
      throw new Error(`component id ${id}: name "${name}" must be PascalCase`);
    }
    if (seenNames.has(name)) {
      throw new Error(`duplicate name "${name}": ids ${seenNames.get(name)} and ${id}`);
    }
    seenNames.set(name, id);

    if (!Array.isArray(fields) || fields.length === 0) {
      throw new Error(`component "${name}" needs at least one field`);
    }

    const seenFields = new Set();
    for (const field of fields) {
      if (typeof field.name !== 'string' || !CAMEL_CASE.test(field.name)) {
        throw new Error(`component "${name}": field name "${field.name}" must be camelCase`);
      }
      if (seenFields.has(field.name)) {
        throw new Error(`component "${name}": duplicate field "${field.name}"`);
      }
      seenFields.add(field.name);

      if (!TYPES[fieldTypeName(field)]) {
        throw new Error(
          `component "${name}": unknown type "${fieldTypeName(field)}" on field "${field.name}"`,
        );
      }
      fieldSize(field); // throws on a malformed array length
    }
  }
}

/** Total wire size of one component, in bytes. Constant by construction. */
export function componentSize(component) {
  return component.fields.reduce((total, field) => total + fieldSize(field), 0);
}

/**
 * Fingerprint of the whole schema — what client and server compare at join.
 *
 * Sorted by id so file order cannot change it: reordering the source must not
 * look like a protocol change. Field names are included because a rename
 * changes what the two sides believe a byte range means, even though the
 * layout is untouched.
 */
export function schemaHash(components) {
  const canonical = [...components]
    .sort((a, b) => a.id - b.id)
    .map((component) => ({
      id: component.id,
      name: component.name,
      fields: component.fields.map((field) => ({
        name: field.name,
        type: field.type,
        ...(field.type === 'array' ? { of: field.of, length: field.length } : {}),
      })),
    }));

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 8);
}
```

```js
// cardinal/components.mjs
/**
 * The Cardinal component schema — the single source of truth.
 *
 * Everything replicated as component data is declared here once, and
 * `scripts/generate-cardinal.mjs` turns it into the client's ECS definitions,
 * the server's structs, both binary codecs, and the parity vectors that prove
 * the two agree. Editing a generated file instead of this one is caught by
 * `scripts/check-cardinal-drift.mjs` in `pnpm test`.
 *
 * Rules that are enforced, not merely suggested (see `validate.mjs`):
 *
 *   * `id` is a permanent wire identity. Never renumber, never recycle a
 *     removed id, never let file order imply it.
 *   * The type set is closed — see `types.mjs`. It holds only fixed-size
 *     types, which is what lets a wire record carry no length field.
 *   * Changing any of this changes the schema hash, and a client whose hash
 *     differs from the server's is refused at join.
 *
 * The two components below are the starting set: one trivially scalar, one
 * mixing an id with a vector, so every generated path has a live example.
 */
export const components = [
  {
    id: 1,
    name: 'Health',
    fields: [
      { name: 'current', type: 'f32' },
      { name: 'max', type: 'f32' },
    ],
  },
  {
    id: 2,
    name: 'Grabbable',
    fields: [
      /** Network id of the holder; 0 means nobody. */
      { name: 'holderId', type: 'u32' },
      /** Grab anchor in the entity's local space. */
      { name: 'grabPoint', type: 'vec3' },
    ],
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run the Task-1 command with `cardinal-validate`.
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add cardinal/components.mjs cardinal/validate.mjs scripts/__tests__/cardinal-validate.test.mjs
git commit -m "feat(cardinal): component schema with validation and stable hash"
```

---

### Task 3: Generator — client artifact

**Files:**
- Create: `scripts/generate-cardinal.mjs`
- Generated: `packages/client/src/cardinal/components.generated.ts`
- Test: `packages/client/test/cardinal-components.test.ts`

**Interfaces:**
- Consumes: `components` (Task 2), `validateSchema`, `componentSize`, `schemaHash`, `TYPES`, `fieldSize`, `fieldTypeName`.
- Produces, in `components.generated.ts`:
  - `export const SCHEMA_HASH: string`
  - `export const Health` / `export const Grabbable` — elics components
  - `export interface HealthData { current: number; max: number }`, `GrabbableData { holderId: number; grabPoint: number[] }`
  - `export const CARDINAL_REGISTRY: ReadonlyMap<number, CardinalComponentSpec>` where
    ```ts
    interface CardinalComponentSpec {
      id: number; name: string; bytes: number;
      component: AnyComponent;
      encode(view: DataView, offset: number, data: Record<string, unknown>): void;
      decode(view: DataView, offset: number): Record<string, unknown>;
      read(entity: Entity): Record<string, unknown>;
      write(entity: Entity, data: Record<string, unknown>): void;
    }
    ```
  - `export function registerCardinalComponents(world: World): void`
  Tasks 5, 8, 9, 10 consume these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/test/cardinal-components.test.ts
import { describe, expect, it } from 'vitest';
import {
  CARDINAL_REGISTRY,
  Grabbable,
  Health,
  SCHEMA_HASH,
} from '../src/cardinal/components.generated.js';

describe('generated client components', () => {
  it('exposes an eight-hex-character schema hash', () => {
    expect(SCHEMA_HASH).toMatch(/^[0-9a-f]{8}$/);
  });

  it('registers every schema component by id', () => {
    expect([...CARDINAL_REGISTRY.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(CARDINAL_REGISTRY.get(1)!.name).toBe('Health');
    expect(CARDINAL_REGISTRY.get(2)!.name).toBe('Grabbable');
  });

  it('reports constant byte sizes', () => {
    expect(CARDINAL_REGISTRY.get(1)!.bytes).toBe(8); // f32 + f32
    expect(CARDINAL_REGISTRY.get(2)!.bytes).toBe(16); // u32 + vec3
  });

  it('exports the elics component objects themselves', () => {
    expect(CARDINAL_REGISTRY.get(1)!.component).toBe(Health);
    expect(CARDINAL_REGISTRY.get(2)!.component).toBe(Grabbable);
  });

  it('round-trips Health through its codec', () => {
    const spec = CARDINAL_REGISTRY.get(1)!;
    const view = new DataView(new ArrayBuffer(spec.bytes));
    spec.encode(view, 0, { current: 12.5, max: 100 });
    expect(spec.decode(view, 0)).toEqual({ current: 12.5, max: 100 });
  });

  it('round-trips Grabbable, vec3 included', () => {
    const spec = CARDINAL_REGISTRY.get(2)!;
    const view = new DataView(new ArrayBuffer(spec.bytes));
    spec.encode(view, 0, { holderId: 42, grabPoint: [1, -2, 3.5] });
    const decoded = spec.decode(view, 0) as { holderId: number; grabPoint: number[] };
    expect(decoded.holderId).toBe(42);
    expect(decoded.grabPoint).toEqual([1, -2, 3.5]);
  });

  it('encodes at a non-zero offset without touching its neighbours', () => {
    // The batched frame packs records back to back, so every codec has to
    // honour the offset it is handed.
    const spec = CARDINAL_REGISTRY.get(1)!;
    const view = new DataView(new ArrayBuffer(spec.bytes + 8));
    view.setUint32(0, 0xdeadbeef, true);
    spec.encode(view, 4, { current: 1.5, max: 2.5 });
    expect(view.getUint32(0, true)).toBe(0xdeadbeef);
    expect(spec.decode(view, 4)).toEqual({ current: 1.5, max: 2.5 });
  });

  it('writes little-endian, matching the rest of the protocol', () => {
    const spec = CARDINAL_REGISTRY.get(2)!;
    const view = new DataView(new ArrayBuffer(spec.bytes));
    spec.encode(view, 0, { holderId: 1, grabPoint: [0, 0, 0] });
    expect(view.getUint8(0)).toBe(1); // low byte first
    expect(view.getUint8(3)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- cardinal-components`
Expected: FAIL — the generated module does not exist.

- [ ] **Step 3: Write the generator's client half**

```js
// scripts/generate-cardinal.mjs
/**
 * Cardinal code generation.
 *
 * One schema in, three artifacts out: the client's ECS definitions and
 * codecs, the server's structs and codecs, and the golden vectors that prove
 * the two produce identical bytes. All three are committed, so a diff shows a
 * reviewer exactly what changed on the wire — the same philosophy
 * `docs/PROTOCOL.md` already states for the hand-written frames.
 *
 * Output is deterministic: sorted by id, no timestamps. That is what lets
 * `check-cardinal-drift.mjs` be a plain diff.
 *
 *   node --experimental-strip-types scripts/generate-cardinal.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { components } from '../cardinal/components.mjs';
import {
  TYPES,
  fieldSize,
  fieldSlots,
  fieldTypeName,
  isVectorField,
} from '../cardinal/types.mjs';
import { componentSize, schemaHash, validateSchema } from '../cardinal/validate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

validateSchema(components);
const sorted = [...components].sort((a, b) => a.id - b.id);
const hash = schemaHash(components);

const BANNER = (source) => `/**
 * GENERATED by scripts/generate-cardinal.mjs -- do not edit.
 *
 * Source of truth: ${source}
 * Regenerate with: node --experimental-strip-types scripts/generate-cardinal.mjs
 */`;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Field offsets within a component's payload, in declaration order. */
function offsets(component) {
  let offset = 0;
  return component.fields.map((field) => {
    const at = offset;
    offset += fieldSize(field);
    return { field, offset: at };
  });
}

/** The elics default literal for a field. */
function tsDefault(field) {
  const name = fieldTypeName(field);
  if (field.type === 'array') return `new Array(${field.length}).fill(0)`;
  if (name === 'bool') return 'false';
  if (name === 'vec3') return '[0, 0, 0]';
  if (name === 'quat') return '[0, 0, 0, 1]';
  return '0';
}

/** The TS type of a field's value. */
function tsType(field) {
  const name = fieldTypeName(field);
  if (field.type === 'array') return 'number[]';
  if (name === 'bool') return 'boolean';
  if (name === 'vec3' || name === 'quat') return 'number[]';
  return 'number';
}

function tsEncodeField(field, offset) {
  const entry = TYPES[fieldTypeName(field)];
  if (field.type !== 'array') {
    return `  ${entry.write('view', `offset + ${offset}`, `(data.${field.name} as ${tsType(field)})`)};`;
  }
  const stride = entry.bytes;
  return [
    `  {`,
    `    const items = data.${field.name} as number[];`,
    `    for (let i = 0; i < ${field.length}; i++) {`,
    `      ${entry.write('view', `offset + ${offset} + i * ${stride}`, 'items[i] ?? 0')};`,
    `    }`,
    `  }`,
  ].join('\n');
}

function tsDecodeField(field, offset) {
  const entry = TYPES[fieldTypeName(field)];
  if (field.type !== 'array') {
    return `    ${field.name}: ${entry.read('view', `offset + ${offset}`)},`;
  }
  const stride = entry.bytes;
  return [
    `    ${field.name}: Array.from({ length: ${field.length} }, (_unused, i) =>`,
    `      ${entry.read('view', `offset + ${offset} + i * ${stride}`)}),`,
  ].join('\n');
}

function clientArtifact() {
  const usesQuat = sorted.some((c) => c.fields.some((f) => fieldTypeName(f) === 'quat'));

  const lines = [
    BANNER('cardinal/components.mjs'),
    '',
    "import { Types, createComponent } from '@iwsdk/core';",
    "import type { AnyComponent, Entity, World } from '@iwsdk/core';",
  ];

  if (usesQuat) {
    lines.push(
      "import {",
      '  compressQuaternion,',
      '  decompressQuaternion,',
      "} from '../protocol/quaternion-compression.js';",
      '',
      '/** The codec speaks `{x,y,z,w}`; elics Vec4 storage is a 4-slot array. */',
      'function quatToSlots(q: { x: number; y: number; z: number; w: number }): number[] {',
      '  return [q.x, q.y, q.z, q.w];',
      '}',
      '',
      'function slotsToQuat(slots: number[]): { x: number; y: number; z: number; w: number } {',
      '  return { x: slots[0] ?? 0, y: slots[1] ?? 0, z: slots[2] ?? 0, w: slots[3] ?? 1 };',
      '}',
    );
  }

  lines.push(
    '',
    '/** Everything the runtime needs to move one component across the wire. */',
    'export interface CardinalComponentSpec {',
    '  id: number;',
    '  name: string;',
    '  /** Constant — the wire format relies on it to skip records. */',
    '  bytes: number;',
    '  /**',
    '   * Field names and slot counts, in declaration order.',
    '   *',
    '   * Exposed because a consumer that only has an id needs the structure to',
    '   * make sense of a flat value list — the golden-vector reader is exactly',
    '   * that case.',
    '   */',
    '  fields: readonly { name: string; slots: number }[];',
    '  component: AnyComponent;',
    '  encode(view: DataView, offset: number, data: Record<string, unknown>): void;',
    '  decode(view: DataView, offset: number): Record<string, unknown>;',
    '  read(entity: Entity): Record<string, unknown>;',
    '  write(entity: Entity, data: Record<string, unknown>): void;',
    '}',
    '',
    `/** Fingerprint of the schema these definitions came from. */`,
    `export const SCHEMA_HASH = '${hash}';`,
    '',
  );

  for (const component of sorted) {
    const laid = offsets(component);
    const size = componentSize(component);

    lines.push(
      `/** Component ${component.id}, ${size} bytes. */`,
      `export interface ${component.name}Data {`,
      ...component.fields.map((f) => `  ${f.name}: ${tsType(f)};`),
      '}',
      '',
      `export const ${component.name} = createComponent(`,
      `  '${component.name}',`,
      '  {',
      ...component.fields.map(
        (f) => `    ${f.name}: { type: Types.${TYPES[fieldTypeName(f)].ts}, default: ${tsDefault(f)} },`,
      ),
      '  },',
      `  'Cardinal component ${component.id}',`,
      ');',
      '',
      `function encode${component.name}(view: DataView, offset: number, data: Record<string, unknown>): void {`,
      ...laid.map(({ field, offset: at }) => tsEncodeField(field, at)),
      '}',
      '',
      `function decode${component.name}(view: DataView, offset: number): Record<string, unknown> {`,
      '  return {',
      ...laid.map(({ field, offset: at }) => tsDecodeField(field, at)),
      '  };',
      '}',
      '',
    );
  }

  lines.push(
    '/** Every schema component, keyed by its permanent wire id. */',
    'export const CARDINAL_REGISTRY: ReadonlyMap<number, CardinalComponentSpec> = new Map([',
  );

  for (const component of sorted) {
    lines.push(
      `  [${component.id}, {`,
      `    id: ${component.id},`,
      `    name: '${component.name}',`,
      `    bytes: ${componentSize(component)},`,
      `    fields: [`,
      ...component.fields.map(
        (f) => `      { name: '${f.name}', slots: ${fieldSlots(f)} },`,
      ),
      `    ],`,
      `    component: ${component.name} as unknown as AnyComponent,`,
      `    encode: encode${component.name},`,
      `    decode: decode${component.name},`,
      `    read: (entity: Entity) => ({`,
      // Multi-slot fields live in flat typed arrays; elics exposes them only
      // as views. `getValue` on one returns undefined, which would publish
      // zeros forever without ever erroring — hence the split.
      ...component.fields.map((f) =>
        isVectorField(f)
          ? `      ${f.name}: Array.from(entity.getVectorView(${component.name}, '${f.name}')),`
          : `      ${f.name}: entity.getValue(${component.name}, '${f.name}'),`,
      ),
      `    }),`,
      `    write: (entity: Entity, data: Record<string, unknown>) => {`,
      ...component.fields.flatMap((f) =>
        isVectorField(f)
          ? [
              `      {`,
              `        const view = entity.getVectorView(${component.name}, '${f.name}');`,
              `        const source = data.${f.name} as number[];`,
              `        for (let i = 0; i < ${fieldSlots(f)}; i++) view[i] = source[i] ?? 0;`,
              `      }`,
            ]
          : [
              `      entity.setValue(${component.name}, '${f.name}', data.${f.name} as never);`,
            ],
      ),
      `    },`,
      `  }],`,
    );
  }

  lines.push(
    ']);',
    '',
    '/**',
    ' * Register every Cardinal component on a world.',
    ' *',
    ' * Called by `installPhoenixNetworking`; an application only needs it',
    ' * directly when building a world without the plugin.',
    ' */',
    'export function registerCardinalComponents(world: World): void {',
    ...sorted.map((c) => `  world.registerComponent(${c.name});`),
    '}',
    '',
  );

  return lines.join('\n');
}

const clientPath = join(root, 'packages/client/src/cardinal/components.generated.ts');
mkdirSync(dirname(clientPath), { recursive: true });
writeFileSync(clientPath, clientArtifact());
console.log(`Wrote ${clientPath}`);
```

- [ ] **Step 4: Generate and run the test**

Run: `node --experimental-strip-types scripts/generate-cardinal.mjs && pnpm --filter @iwsdk/plugin-phoenix test -- cardinal-components`
Expected: PASS, 8 tests.

If `world.registerComponent` is not the exact API in this IWSDK version, check how `plugin.ts` registers `Networked` (it chains `.registerComponent(...)`) and match that call shape in the emitted `registerCardinalComponents`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @iwsdk/plugin-phoenix typecheck`
Expected: clean. The client package has `noUncheckedIndexedAccess`; if the emitted array loops trip it, the `?? 0` in `tsEncodeField` is the intended guard — extend the same pattern rather than loosening the config.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-cardinal.mjs packages/client/src/cardinal/components.generated.ts packages/client/test/cardinal-components.test.ts
git commit -m "feat(cardinal): generate client ECS definitions and codecs from the schema"
```

---

### Task 4: Generator — server artifact

**Files:**
- Modify: `scripts/generate-cardinal.mjs` (append the server half)
- Generated: `packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex`
- Test: `packages/server/test/cardinal_components_test.exs`

**Interfaces:**
- Consumes: everything Task 3 consumes.
- Produces, in the generated Elixir:
  - `IwsdkPhoenix.Cardinal.Health` / `.Grabbable` — each with `defstruct`, `@type t`, `encode/1 :: binary`, `decode/1 :: {:ok, t} | :error`, `byte_size/0`
  - `IwsdkPhoenix.Cardinal.Registry` — `module_for(id) :: module | nil`, `byte_size_for(id) :: pos_integer | nil`, `ids() :: [pos_integer]`, `schema_hash() :: String.t`
  Tasks 6, 7, 9 consume these.

- [ ] **Step 1: Write the failing test**

```elixir
# packages/server/test/cardinal_components_test.exs
defmodule IwsdkPhoenix.CardinalComponentsTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Cardinal.{Grabbable, Health, Registry}

  describe "registry" do
    test "knows every schema component by id" do
      assert Enum.sort(Registry.ids()) == [1, 2]
      assert Registry.module_for(1) == Health
      assert Registry.module_for(2) == Grabbable
    end

    test "returns nil for an unknown id rather than raising" do
      # An unknown id can only reach here as a bug — the join-time hash check
      # rules out schema drift — so it must degrade, not crash the room.
      assert Registry.module_for(9999) == nil
      assert Registry.byte_size_for(9999) == nil
    end

    test "reports constant byte sizes" do
      assert Registry.byte_size_for(1) == 8
      assert Registry.byte_size_for(2) == 16
    end

    test "exposes an eight-hex-character schema hash" do
      assert Registry.schema_hash() =~ ~r/^[0-9a-f]{8}$/
    end
  end

  describe "Health" do
    test "round-trips" do
      encoded = Health.encode(%Health{current: 12.5, max: 100.0})
      assert byte_size(encoded) == 8
      assert {:ok, %Health{current: 12.5, max: 100.0}} = Health.decode(encoded)
    end

    test "rejects a payload of the wrong size" do
      assert Health.decode(<<0, 0, 0>>) == :error
    end
  end

  describe "Grabbable" do
    test "round-trips, vec3 included" do
      value = %Grabbable{holder_id: 42, grab_point: %{x: 1.0, y: -2.0, z: 3.5}}
      assert {:ok, decoded} = value |> Grabbable.encode() |> Grabbable.decode()
      assert decoded.holder_id == 42
      assert decoded.grab_point == %{x: 1.0, y: -2.0, z: 3.5}
    end

    test "encodes little-endian" do
      encoded = Grabbable.encode(%Grabbable{holder_id: 1, grab_point: %{x: 0.0, y: 0.0, z: 0.0}})
      assert <<1, 0, 0, 0, _rest::binary>> = encoded
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/cardinal_components_test.exs`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Append the server half to the generator**

Add to `scripts/generate-cardinal.mjs`, before the client write block or after it — order does not matter, but keep both writes at the bottom together:

```js
// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** snake_case field name for Elixir. */
function snake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Default literal for an Elixir struct field. */
function exDefault(field) {
  const name = fieldTypeName(field);
  if (field.type === 'array') return `List.duplicate(0, ${field.length})`;
  if (name === 'bool') return 'false';
  if (name === 'vec3') return '%{x: 0.0, y: 0.0, z: 0.0}';
  if (name === 'quat') return '%{x: 0.0, y: 0.0, z: 0.0, w: 1.0}';
  if (name === 'f32' || name === 'f64') return '0.0';
  return '0';
}

/** Elixir typespec for a field. */
function exType(field) {
  const entry = TYPES[fieldTypeName(field)];
  return field.type === 'array' ? `[${entry.elixir}]` : entry.elixir;
}

/** Bitstring segment for one scalar of a given type, given a variable name. */
function exSegment(typeName, variable) {
  switch (typeName) {
    case 'bool':
      return `${variable}::unsigned-integer-size(8)`;
    case 'u8':
      return `${variable}::unsigned-integer-size(8)`;
    case 'u16':
      return `${variable}::unsigned-little-integer-size(16)`;
    case 'u32':
      return `${variable}::unsigned-little-integer-size(32)`;
    case 'i32':
      return `${variable}::signed-little-integer-size(32)`;
    case 'f32':
      return `${variable}::float-little-size(32)`;
    case 'f64':
      return `${variable}::float-little-size(64)`;
    case 'quat':
      return `${variable}::unsigned-little-integer-size(32)`;
    default:
      throw new Error(`no bitstring segment for ${typeName}`);
  }
}

function serverArtifact() {
  const lines = [
    '# GENERATED by scripts/generate-cardinal.mjs -- do not edit.',
    '#',
    '# Source of truth: cardinal/components.mjs',
    '# Regenerate with: node --experimental-strip-types scripts/generate-cardinal.mjs',
    '',
  ];

  for (const component of sorted) {
    const size = componentSize(component);
    const mod = `IwsdkPhoenix.Cardinal.${component.name}`;

    // Encode: one bitstring literal per field, concatenated.
    const encodeParts = [];
    // Decode: one pattern per field, in declaration order.
    const decodePatterns = [];
    const decodeAssigns = [];

    for (const field of component.fields) {
      const typeName = fieldTypeName(field);
      const key = snake(field.name);

      if (field.type === 'array') {
        encodeParts.push(
          `      for value <- pad(struct.${key}, ${field.length}), into: <<>>, do: <<${exSegment(typeName, 'value')}>>`,
        );
        decodePatterns.push(`${key}_bin::binary-size(${fieldSize(field)})`);
        decodeAssigns.push(
          `      ${key}: for(<<${exSegment(typeName, 'value')} <- ${key}_bin>>, do: value),`,
        );
        continue;
      }

      if (typeName === 'vec3') {
        encodeParts.push(
          `      <<struct.${key}.x::float-little-size(32), struct.${key}.y::float-little-size(32), struct.${key}.z::float-little-size(32)>>`,
        );
        decodePatterns.push(
          `${key}_x::float-little-size(32), ${key}_y::float-little-size(32), ${key}_z::float-little-size(32)`,
        );
        decodeAssigns.push(`      ${key}: %{x: ${key}_x, y: ${key}_y, z: ${key}_z},`);
        continue;
      }

      if (typeName === 'quat') {
        // Verified names: compress_quaternion / decompress_quaternion in
        // IwsdkPhoenix.Protocol.Quantization. They take and return
        // `%{x:, y:, z:, w:}` maps, which is exactly the struct field shape.
        encodeParts.push(
          `      <<IwsdkPhoenix.Protocol.Quantization.compress_quaternion(struct.${key})::unsigned-little-integer-size(32)>>`,
        );
        decodePatterns.push(`${key}_packed::unsigned-little-integer-size(32)`);
        decodeAssigns.push(
          `      ${key}: IwsdkPhoenix.Protocol.Quantization.decompress_quaternion(${key}_packed),`,
        );
        continue;
      }

      if (typeName === 'bool') {
        encodeParts.push(`      <<if(struct.${key}, do: 1, else: 0)::unsigned-integer-size(8)>>`);
        decodePatterns.push(`${key}_raw::unsigned-integer-size(8)`);
        decodeAssigns.push(`      ${key}: ${key}_raw != 0,`);
        continue;
      }

      encodeParts.push(`      <<${exSegment(typeName, `struct.${key}`)}>>`);
      decodePatterns.push(exSegment(typeName, key));
      decodeAssigns.push(`      ${key}: ${key},`);
    }

    const usesPad = component.fields.some((f) => f.type === 'array');

    lines.push(
      `defmodule ${mod} do`,
      `  @moduledoc "Cardinal component ${component.id}. ${size} bytes on the wire."`,
      '',
      '  defstruct ' +
        component.fields.map((f) => `${snake(f.name)}: ${exDefault(f)}`).join(', '),
      '',
      '  @type t :: %__MODULE__{',
      ...component.fields.map((f) => `          ${snake(f.name)}: ${exType(f)},`),
      '        }',
      '',
      `  @doc "Wire size in bytes. Constant."`,
      `  @spec byte_size() :: pos_integer()`,
      `  def byte_size, do: ${size}`,
      '',
      `  @spec encode(t()) :: binary()`,
      '  def encode(%__MODULE__{} = struct) do',
      '    IO.iodata_to_binary([',
      encodeParts.join(',\n'),
      '    ])',
      '  end',
      '',
      `  @spec decode(binary()) :: {:ok, t()} | :error`,
      `  def decode(<<${decodePatterns.join(', ')}>>) do`,
      '    {:ok,',
      '     %__MODULE__{',
      ...decodeAssigns,
      '     }}',
      '  end',
      '',
      '  def decode(_other), do: :error',
    );

    if (usesPad) {
      lines.push(
        '',
        '  # A short list is padded rather than rejected: the wire size is fixed,',
        '  # and a caller that supplied fewer entries meant the rest to be empty.',
        '  defp pad(list, length) do',
        '    list |> Enum.take(length) |> then(&(&1 ++ List.duplicate(0, length - length(&1))))',
        '  end',
      );
    }

    lines.push('end', '');
  }

  lines.push(
    'defmodule IwsdkPhoenix.Cardinal.Registry do',
    '  @moduledoc """',
    '  Lookup from wire id to generated component module.',
    '',
    '  Unknown ids return `nil` rather than raising: the join-time schema hash',
    '  check rules out drift, so an unknown id can only be a bug, and a bug must',
    '  not take the room down with it.',
    '  """',
    '',
    `  @schema_hash "${hash}"`,
    '',
    '  @spec schema_hash() :: String.t()',
    '  def schema_hash, do: @schema_hash',
    '',
    '  @spec ids() :: [pos_integer()]',
    `  def ids, do: [${sorted.map((c) => c.id).join(', ')}]`,
    '',
    '  @spec module_for(integer()) :: module() | nil',
    ...sorted.map((c) => `  def module_for(${c.id}), do: IwsdkPhoenix.Cardinal.${c.name}`),
    '  def module_for(_other), do: nil',
    '',
    '  @spec byte_size_for(integer()) :: pos_integer() | nil',
    ...sorted.map((c) => `  def byte_size_for(${c.id}), do: ${componentSize(c)}`),
    '  def byte_size_for(_other), do: nil',
    'end',
    '',
  );

  return lines.join('\n');
}

const serverPath = join(
  root,
  'packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex',
);
mkdirSync(dirname(serverPath), { recursive: true });
writeFileSync(serverPath, serverArtifact());
console.log(`Wrote ${serverPath}`);
```

- [ ] **Step 4: Generate and run the test**

Run: `node --experimental-strip-types scripts/generate-cardinal.mjs && cd packages/server && mix test test/cardinal_components_test.exs`
Expected: PASS, 8 tests, **zero compiler warnings**. If Elixir warns about an unused variable in a decode pattern, prefix it with `_` in the generator's pattern emission — do not silence the warning globally.

The quaternion function names are verified and pinned by a test in Task 1
(`compressQuaternion` / `decompressQuaternion`, `compress_quaternion` /
`decompress_quaternion`). They matter here because the starting schema has no
`quat` field: a wrong name would not surface until someone added one, months
later, as a generated file that will not parse. Task 1's assertion is what
makes that impossible.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-cardinal.mjs packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex packages/server/test/cardinal_components_test.exs
git commit -m "feat(cardinal): generate server structs and codecs from the schema"
```

---

### Task 5: Parity vectors and the drift tripwire

**Files:**
- Modify: `scripts/generate-cardinal.mjs` (emit vector rows)
- Create: `scripts/check-cardinal-drift.mjs`
- Modify: `fixtures/protocol_vectors.tsv` (regenerated)
- Modify: `packages/client/test/parity.test.ts`
- Modify: `packages/server/test/parity_test.exs`
- Modify: `package.json` (root `test` script)

**Interfaces:**
- Consumes: `CARDINAL_REGISTRY` (Task 3), `IwsdkPhoenix.Cardinal.Registry` (Task 4).
- Produces: TSV rows `cardinal <componentId> <jsonValues> <hex>` and `cardinal_schema_hash <hash>`; both parity suites iterate them generically.

- [ ] **Step 1: Emit vector rows from the generator**

The vectors must be appended to the existing `fixtures/protocol_vectors.tsv` without disturbing `generate-fixtures.mjs`. Keep the two generators independent by having `generate-cardinal.mjs` write its rows to `fixtures/cardinal_vectors.tsv` instead — a second file, same format, same comment header. Add to `generate-cardinal.mjs`:

```js
// ---------------------------------------------------------------------------
// Golden vectors
// ---------------------------------------------------------------------------

/**
 * Sample values for one component: index i takes each field's i-th sample,
 * cycling shorter sample lists. Cheap, deterministic, and it exercises every
 * field's extremes without a combinatorial explosion.
 */
function sampleRows(component) {
  const depth = Math.max(
    ...component.fields.map((f) => TYPES[fieldTypeName(f)].samples.length),
  );

  return Array.from({ length: depth }, (_unused, i) =>
    Object.fromEntries(
      component.fields.map((field) => {
        const entry = TYPES[fieldTypeName(field)];
        const sample = entry.samples[i % entry.samples.length];
        return [
          field.name,
          field.type === 'array' ? new Array(field.length).fill(sample) : sample,
        ];
      }),
    ),
  );
}

/**
 * Flatten a value object into tab fields, in declaration order.
 *
 * Values are written as bare numbers rather than JSON: the existing fixture
 * format is tab-separated scalars (see the `quat` rows in
 * protocol_vectors.tsv), and — decisively — `jason` is an *optional*
 * dependency of the server package, so a JSON payload could not be read at
 * all when the suite runs dependency-free. A reader recovers the structure by
 * looking the component up and walking its fields, consuming `fieldSlots`
 * numbers each.
 */
function flattenValues(component, values) {
  const out = [];
  for (const field of component.fields) {
    const value = values[field.name];
    if (isVectorField(field)) out.push(...value.map(num));
    else out.push(num(value));
  }
  return out;
}

/** Canonical number formatting: booleans as 0/1, floats never in exponent form. */
function num(value) {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(10).replace(/0+$/, '0');
}
```

The vectors must be encoded **through the shipped client codec** — a second
encoder written here would prove only that it agrees with itself. That means
importing the generated TypeScript, which in turn means two ordering rules
this generator must obey, both of which broke an earlier draft:

1. **Write the client artifact before importing it.** On a first run the file
   does not exist yet; the write has to happen earlier in the script.
2. **Import once, at the top level** — not inside the component loop.

So the bottom of the generator reads, in this exact order:

```js
// 1. Write the two code artifacts first — the vectors depend on the client one.
const clientPath = join(root, 'packages/client/src/cardinal/components.generated.ts');
mkdirSync(dirname(clientPath), { recursive: true });
writeFileSync(clientPath, clientArtifact());

const serverPath = join(
  root,
  'packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex',
);
mkdirSync(dirname(serverPath), { recursive: true });
writeFileSync(serverPath, serverArtifact());

// 2. Now the file exists, so the shipped codec can be loaded and used.
//    Requires `node --experimental-strip-types`; see the header comment.
const { CARDINAL_REGISTRY } = await import(clientPath);

const vectorLines = [
  '# Cardinal component golden vectors.',
  '# GENERATED by scripts/generate-cardinal.mjs -- do not edit by hand.',
  '# Tab-separated. Values are bare numbers (bools as 0/1); binaries are',
  '# lowercase hex. Field structure is recovered from the component id.',
  '#',
  '# cardinal_schema_hash <hash>',
  `cardinal_schema_hash\t${hash}`,
  '#',
  '# cardinal <componentId> <field values, flattened> <hex>',
];

for (const component of sorted) {
  const spec = CARDINAL_REGISTRY.get(component.id);
  for (const values of sampleRows(component)) {
    const view = new DataView(new ArrayBuffer(spec.bytes));
    spec.encode(view, 0, values);
    vectorLines.push(
      [
        'cardinal',
        component.id,
        ...flattenValues(component, values),
        Buffer.from(view.buffer).toString('hex'),
      ].join('\t'),
    );
  }
}

// 3. Vectors last.
const vectorPath = join(root, 'fixtures/cardinal_vectors.tsv');
writeFileSync(vectorPath, vectorLines.join('\n') + '\n');

for (const path of [clientPath, serverPath, vectorPath]) console.log(`Wrote ${path}`);
```

Delete the standalone `writeFileSync(clientPath, ...)` and
`writeFileSync(serverPath, ...)` blocks from Tasks 3 and 4 when you reach this
step — this ordered block replaces both. Add
`node --experimental-strip-types` to the generator's header comment and to
every command in this plan that runs it.

- [ ] **Step 2: Write the failing parity assertions**

Create `packages/client/test/cardinal-fixtures.ts` — a sibling loader for the
new file, in the same shape as the one at the top of `parity.test.ts`:

```ts
/**
 * Reader for `fixtures/cardinal_vectors.tsv`.
 *
 * Values arrive as a flat run of numbers because the fixture format is
 * tab-separated scalars; the component's own field list is what recovers the
 * structure. The registry carries that list precisely so this reader — and
 * its Elixir twin — need no schema of their own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CARDINAL_REGISTRY } from '../src/cardinal/components.generated.js';

const path = fileURLToPath(
  new URL('../../../fixtures/cardinal_vectors.tsv', import.meta.url),
);

const rows = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#'))
  .map((line) => line.split('\t'));

/** Rows of one kind, with the kind column stripped. */
export const cardinalOf = (kind: string): string[][] =>
  rows.filter((row) => row[0] === kind).map((row) => row.slice(1));

/** Rebuild a value object from a component id and its flat number fields. */
export function valuesFor(componentId: number, flat: string[]): Record<string, unknown> {
  const spec = CARDINAL_REGISTRY.get(componentId);
  if (!spec) throw new Error(`no component with id ${componentId}`);

  const values: Record<string, unknown> = {};
  let cursor = 0;
  for (const field of spec.fields) {
    if (field.slots === 1) {
      values[field.name] = Number(flat[cursor]);
      cursor += 1;
    } else {
      values[field.name] = flat
        .slice(cursor, cursor + field.slots)
        .map((entry) => Number(entry));
      cursor += field.slots;
    }
  }
  return values;
}
```

Then in `parity.test.ts`, alongside the existing vector tests:

```ts
  it('Cardinal component vectors match', () => {
    const cases = cardinalOf('cardinal');
    expect(cases.length).toBeGreaterThan(0);

    for (const row of cases) {
      const componentId = Number(row[0]);
      const expected = row.at(-1)!;
      const values = valuesFor(componentId, row.slice(1, -1));

      const spec = CARDINAL_REGISTRY.get(componentId)!;
      const view = new DataView(new ArrayBuffer(spec.bytes));
      spec.encode(view, 0, values);
      expect(hex(view.buffer)).toBe(expected);
    }
  });

  it('schema hash matches the fixture', () => {
    expect(SCHEMA_HASH).toBe(cardinalOf('cardinal_schema_hash')[0]![0]);
  });
```

Create `packages/server/test/support/cardinal_fixtures.ex` — the Elixir twin.
Note it uses **no JSON decoder**: `jason` is an *optional* dependency of this
package, so a helper that needed it would fail in the dependency-free test
run.

```elixir
defmodule IwsdkPhoenix.CardinalFixtures do
  @moduledoc """
  Reader for `fixtures/cardinal_vectors.tsv`.

  The twin of `packages/client/test/cardinal-fixtures.ts`. Values are a flat
  run of numbers, and the component's own field order recovers the structure —
  no JSON is involved, deliberately: `jason` is optional here, and the core
  suite must run without it.
  """

  alias IwsdkPhoenix.Cardinal.Registry

  @fixture_path Path.expand("../../../../fixtures/cardinal_vectors.tsv", __DIR__)

  def fixture_path, do: @fixture_path

  @doc "Rows of one kind, kind column stripped."
  def rows(kind) do
    @fixture_path
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.reject(&String.starts_with?(&1, "#"))
    |> Enum.map(&String.split(&1, "\t"))
    |> Enum.filter(&match?([^kind | _], &1))
    |> Enum.map(fn [_kind | fields] -> fields end)
  end

  @doc """
  Rebuild a component struct from its id and flat field values.

  Order comes from the module's generated `field_order/0`, never from struct
  key order — Elixir sorts struct keys, and the fixture is written in
  declaration order. Slot counts come from each field's default: a map means a
  vector, a list means an array, anything else is a scalar. That keeps this
  helper free of a second copy of the schema.
  """
  def to_struct(component_id, flat) do
    module = Registry.module_for(component_id)
    empty = struct(module)

    {fields, []} =
      Enum.reduce(module.field_order(), {%{}, flat}, fn key, {acc, remaining} ->
        {value, rest} = take_field(Map.fetch!(empty, key), remaining)
        {Map.put(acc, key, value), rest}
      end)

    struct(module, fields)
  end

  defp take_field(%{} = default, remaining) when not is_struct(default) do
    keys = default |> Map.keys() |> Enum.sort_by(&vector_key_order/1)
    {taken, rest} = Enum.split(remaining, length(keys))
    {keys |> Enum.zip(Enum.map(taken, &to_number/1)) |> Map.new(), rest}
  end

  defp take_field(default, remaining) when is_list(default) do
    {taken, rest} = Enum.split(remaining, length(default))
    {Enum.map(taken, &to_number/1), rest}
  end

  defp take_field(default, [head | rest]) when is_boolean(default),
    do: {String.trim(head) == "1", rest}

  defp take_field(default, [head | rest]) when is_float(default),
    do: {to_number(head) * 1.0, rest}

  defp take_field(_default, [head | rest]), do: {trunc(to_number(head)), rest}

  # x, y, z, w — the order the generator flattens vectors in.
  defp vector_key_order(:x), do: 0
  defp vector_key_order(:y), do: 1
  defp vector_key_order(:z), do: 2
  defp vector_key_order(:w), do: 3

  defp to_number(text) do
    text = String.trim(text)

    case Integer.parse(text) do
      {value, ""} -> value
      _ -> text |> Float.parse() |> elem(0)
    end
  end
end
```

This depends on each generated module exposing `field_order/0`. Add it to the
server emission in Task 4, right after `byte_size/0`:

```js
      `  @doc "Field names in declaration order — struct key order is sorted, not declared."`,
      `  @spec field_order() :: [atom()]`,
      `  def field_order, do: [${component.fields.map((f) => `:${snake(f.name)}`).join(', ')}]`,
      '',
```

Then in `parity_test.exs`:

```elixir
    test "Cardinal component vectors match byte for byte" do
      rows = CardinalFixtures.rows("cardinal")
      assert rows != []

      for row <- rows do
        [id | rest] = row
        {hex, flat} = List.pop_at(rest, -1)
        component_id = String.to_integer(String.trim(id))

        module = Registry.module_for(component_id)
        assert module != nil, "no module for component #{component_id}"

        value = CardinalFixtures.to_struct(component_id, flat)
        assert Base.encode16(module.encode(value), case: :lower) == String.trim(hex)
      end
    end

    test "schema hash matches the fixture" do
      [[fixture_hash]] = CardinalFixtures.rows("cardinal_schema_hash")
      assert Registry.schema_hash() == String.trim(fixture_hash)
    end
```

- [ ] **Step 3: Run both suites**

Run: `node --experimental-strip-types scripts/generate-cardinal.mjs && pnpm test && (cd packages/server && mix test test/parity_test.exs)`
Expected: PASS both sides — byte-identical output from two independent implementations.

- [ ] **Step 4: Write the drift tripwire**

```js
// scripts/check-cardinal-drift.mjs
/**
 * Fails when a generated Cardinal artifact does not match the schema.
 *
 * The generated files are committed so their diffs serve as the protocol
 * change record. That only holds if they cannot drift: this regenerates into
 * a temp directory and compares. It catches both halves of the mistake —
 * editing the schema without regenerating, and editing a generated file by
 * hand.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Path of each artifact, relative to whichever root the generator writes to. */
const artifacts = [
  'packages/client/src/cardinal/components.generated.ts',
  'packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex',
  'fixtures/cardinal_vectors.tsv',
];

// Regenerate into a scratch tree and compare. Never into the working tree:
// an in-place regeneration would have to be undone afterwards, and undoing it
// with `git checkout` would destroy any legitimate uncommitted edit the
// developer happened to be holding.
const scratch = mkdtempSync(join(tmpdir(), 'cardinal-drift-'));

try {
  execFileSync(
    'node',
    ['--experimental-strip-types', 'scripts/generate-cardinal.mjs'],
    { cwd: root, stdio: 'pipe', env: { ...process.env, CARDINAL_OUT_DIR: scratch } },
  );

  const drifted = artifacts.filter(
    (relative) =>
      readFileSync(join(root, relative), 'utf8') !==
      readFileSync(join(scratch, relative), 'utf8'),
  );

  if (drifted.length > 0) {
    console.error('check-cardinal-drift: FAIL');
    for (const relative of drifted) console.error(`  - out of date: ${relative}`);
    console.error(
      '\nThe schema and its generated artifacts disagree. Run:' +
        '\n  node --experimental-strip-types scripts/generate-cardinal.mjs' +
        '\nand commit the result — the diff is the protocol change record.',
    );
    process.exit(1);
  }

  console.log('check-cardinal-drift: OK (generated artifacts match the schema)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
```

This needs the generator to honour an output root. In
`scripts/generate-cardinal.mjs`, replace the single `root` constant with two:

```js
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where artifacts are written. The drift check points this at a scratch tree
 * so it can compare without touching the working copy.
 */
const outRoot = process.env.CARDINAL_OUT_DIR ?? root;
```

and build every output path from `outRoot` instead of `root`. The one path
that must keep using `root` is the dynamic `import(clientPath)` for the
vectors — a scratch-tree copy would import a module whose relative
`../protocol/quaternion-compression.js` does not resolve. Write to `outRoot`,
import from `root`:

```js
const clientPath = join(outRoot, 'packages/client/src/cardinal/components.generated.ts');
// …write it…
const { CARDINAL_REGISTRY } = await import(
  join(root, 'packages/client/src/cardinal/components.generated.ts')
);
```

When the two roots differ, that means the vectors are encoded with the
*committed* codec while the code artifacts come from the *current* schema — so
a schema change that alters a layout shows up as drift in the vector file
too. That is the behaviour you want: the check reports disagreement, it does
not paper over it.

- [ ] **Step 5: Verify the tripwire actually trips**

```bash
node scripts/check-cardinal-drift.mjs                        # expect OK
# Break it on purpose:
printf '\n// drift\n' >> packages/client/src/cardinal/components.generated.ts
node scripts/check-cardinal-drift.mjs                        # expect FAIL, naming that file
git checkout -- packages/client/src/cardinal/components.generated.ts
node scripts/check-cardinal-drift.mjs                        # expect OK again
```

A tripwire that has never been seen to fail is not a tripwire. Do not skip this step.

- [ ] **Step 6: Wire it into the test script**

In the root `package.json`, extend the `test` script — it already chains `check-single-three.mjs`:

```json
"test": "node scripts/check-single-three.mjs && node scripts/check-cardinal-drift.mjs && pnpm --filter @iwsdk/plugin-phoenix test",
```

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-cardinal.mjs scripts/check-cardinal-drift.mjs fixtures/cardinal_vectors.tsv packages/client/test/parity.test.ts packages/server/test/parity_test.exs packages/server/test/support package.json
git commit -m "test(cardinal): per-component golden vectors and a drift tripwire"
```

---

### Task 6: COMPONENT_UPDATE frame — client codec

**Files:**
- Modify: `packages/client/src/protocol/opcodes.ts`
- Modify: `packages/client/src/protocol/BinaryProtocol.ts`
- Test: `packages/client/test/binary-protocol.test.ts`

**Interfaces:**
- Consumes: `CARDINAL_REGISTRY` (Task 3).
- Produces:
  ```ts
  export const COMPONENT_UPDATE_HEADER_BYTES = 7;   // op + count(u16) + tick(u32)
  export const COMPONENT_UPDATE_RECORD_HEADER_BYTES = 6; // networkId(u32) + componentId(u16)
  export interface ComponentRecord { networkId: number; componentId: number; data: Record<string, unknown> }
  export interface ComponentUpdateFrame { serverTick: number; records: ComponentRecord[] }
  BinaryProtocol.encodeComponentUpdate(records: ComponentRecord[], serverTick?: number): ArrayBuffer
  BinaryProtocol.decodeComponentUpdate(buffer: ArrayBuffer, byteOffset?: number): ComponentUpdateFrame
  ```
  `OpCode.COMPONENT_UPDATE = 12`. Tasks 9 and 10 consume these.

- [ ] **Step 1: Write the failing test**

```ts
describe('COMPONENT_UPDATE', () => {
  const health = { networkId: 7, componentId: 1, data: { current: 12.5, max: 100 } };
  const grab = { networkId: 9, componentId: 2, data: { holderId: 3, grabPoint: [1, -2, 3.5] } };

  it('round-trips a heterogeneous batch', () => {
    const frame = BinaryProtocol.encodeComponentUpdate([health, grab], 4242);
    const decoded = BinaryProtocol.decodeComponentUpdate(frame);

    expect(decoded.serverTick).toBe(4242);
    expect(decoded.records).toHaveLength(2);
    expect(decoded.records[0]).toEqual(health);
    expect(decoded.records[1]!.networkId).toBe(9);
    expect(decoded.records[1]!.componentId).toBe(2);
    expect(decoded.records[1]!.data.holderId).toBe(3);
    expect(decoded.records[1]!.data.grabPoint).toEqual([1, -2, 3.5]);
  });

  it('sizes the frame from the schema, with no per-record length field', () => {
    const frame = BinaryProtocol.encodeComponentUpdate([health, grab], 0);
    // 7 header + (6 + 8) + (6 + 16)
    expect(frame.byteLength).toBe(7 + 14 + 22);
  });

  it('carries the opcode', () => {
    const frame = BinaryProtocol.encodeComponentUpdate([health], 0);
    expect(new DataView(frame).getUint8(0)).toBe(OpCode.COMPONENT_UPDATE);
  });

  it('encodes an empty batch as a header alone', () => {
    const frame = BinaryProtocol.encodeComponentUpdate([], 1);
    expect(frame.byteLength).toBe(COMPONENT_UPDATE_HEADER_BYTES);
    expect(BinaryProtocol.decodeComponentUpdate(frame).records).toEqual([]);
  });

  it('throws on an unknown component id — it cannot skip what it cannot size', () => {
    // With no length field the reader has no way to advance past an unknown
    // record. That is the deliberate trade the join-time hash check pays for.
    const frame = BinaryProtocol.encodeComponentUpdate([health], 0);
    new DataView(frame).setUint16(7 + 4, 999, true);
    expect(() => BinaryProtocol.decodeComponentUpdate(frame)).toThrow(ProtocolError);
  });

  it('throws on a truncated frame rather than reading past the end', () => {
    const frame = BinaryProtocol.encodeComponentUpdate([health, grab], 0);
    expect(() => BinaryProtocol.decodeComponentUpdate(frame.slice(0, 20))).toThrow(ProtocolError);
  });

  it('decodes through the generic decode() entry point', () => {
    const frame = BinaryProtocol.encodeComponentUpdate([health], 5);
    const decoded = BinaryProtocol.decode(frame);
    if (decoded.opCode !== OpCode.COMPONENT_UPDATE) throw new Error('wrong opcode');
    expect(decoded.componentUpdate.records[0]).toEqual(health);
  });
});
```

Add `COMPONENT_UPDATE_HEADER_BYTES` to the file's import list from `../src/protocol/opcodes.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- binary-protocol`
Expected: FAIL — `OpCode.COMPONENT_UPDATE` is undefined.

- [ ] **Step 3: Write the implementation**

`opcodes.ts`, with the other opcodes and size constants:

```ts
  /** Batched component payloads. @see COMPONENT_UPDATE_HEADER_BYTES */
  COMPONENT_UPDATE = 12,
```

```ts
/** Byte size of a {@link OpCode.COMPONENT_UPDATE} header: op + count + tick. */
export const COMPONENT_UPDATE_HEADER_BYTES = 7;

/**
 * Byte size of one record's header, before its payload.
 *
 * There is no length field: the payload size is a property of the component
 * id, looked up in the registry. That is what keeps a record at 6 bytes of
 * overhead — and why an unknown id is fatal to the whole frame rather than
 * skippable.
 */
export const COMPONENT_UPDATE_RECORD_HEADER_BYTES = 6;
```

`BinaryProtocol.ts` — types near the other frame interfaces:

```ts
/** One component's value for one entity. */
export interface ComponentRecord {
  networkId: number;
  componentId: number;
  data: Record<string, unknown>;
}

/** A batch of component values sharing one server tick. */
export interface ComponentUpdateFrame {
  serverTick: number;
  records: ComponentRecord[];
}
```

Add to the `DecodedFrame` union:

```ts
  | { opCode: OpCode.COMPONENT_UPDATE; componentUpdate: ComponentUpdateFrame }
```

The codec itself:

```ts
  /**
   * Batch component values into one frame.
   *
   * Always batched, never one frame per component: a lone record would be
   * ~15 bytes, under the BEAM's 64-byte heap-binary threshold, so the server
   * would *copy* it to every recipient instead of sharing one reference. A
   * tick's batch crosses that threshold almost immediately.
   */
  static encodeComponentUpdate(
    records: ComponentRecord[],
    serverTick = 0,
  ): ArrayBuffer {
    let total = COMPONENT_UPDATE_HEADER_BYTES;
    for (const record of records) {
      const spec = CARDINAL_REGISTRY.get(record.componentId);
      if (!spec) {
        throw new ProtocolError(`unknown component id ${record.componentId}`);
      }
      total += COMPONENT_UPDATE_RECORD_HEADER_BYTES + spec.bytes;
    }

    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    view.setUint8(0, OpCode.COMPONENT_UPDATE);
    view.setUint16(1, records.length, LITTLE_ENDIAN);
    view.setUint32(3, serverTick, LITTLE_ENDIAN);

    let offset = COMPONENT_UPDATE_HEADER_BYTES;
    for (const record of records) {
      const spec = CARDINAL_REGISTRY.get(record.componentId)!;
      view.setUint32(offset, record.networkId, LITTLE_ENDIAN);
      view.setUint16(offset + 4, record.componentId, LITTLE_ENDIAN);
      spec.encode(view, offset + COMPONENT_UPDATE_RECORD_HEADER_BYTES, record.data);
      offset += COMPONENT_UPDATE_RECORD_HEADER_BYTES + spec.bytes;
    }

    return buffer;
  }

  static decodeComponentUpdate(
    buffer: ArrayBuffer,
    byteOffset = 0,
  ): ComponentUpdateFrame {
    const view = new DataView(buffer, byteOffset);
    if (view.byteLength < COMPONENT_UPDATE_HEADER_BYTES) {
      throw new ProtocolError('COMPONENT_UPDATE header truncated');
    }

    const count = view.getUint16(1, LITTLE_ENDIAN);
    const serverTick = view.getUint32(3, LITTLE_ENDIAN);
    const records: ComponentRecord[] = [];

    let offset = COMPONENT_UPDATE_HEADER_BYTES;
    for (let i = 0; i < count; i++) {
      if (offset + COMPONENT_UPDATE_RECORD_HEADER_BYTES > view.byteLength) {
        throw new ProtocolError('COMPONENT_UPDATE record header truncated');
      }

      const networkId = view.getUint32(offset, LITTLE_ENDIAN);
      const componentId = view.getUint16(offset + 4, LITTLE_ENDIAN);
      const spec = CARDINAL_REGISTRY.get(componentId);
      // Fatal, not skippable: without a length field there is no way to know
      // how far past an unknown record to advance. The join-time schema hash
      // check is what makes this acceptable — see the design's Section 4.
      if (!spec) {
        throw new ProtocolError(`unknown component id ${componentId}`);
      }

      const payloadAt = offset + COMPONENT_UPDATE_RECORD_HEADER_BYTES;
      if (payloadAt + spec.bytes > view.byteLength) {
        throw new ProtocolError(`COMPONENT_UPDATE payload truncated for id ${componentId}`);
      }

      records.push({ networkId, componentId, data: spec.decode(view, payloadAt) });
      offset = payloadAt + spec.bytes;
    }

    return { serverTick, records };
  }
```

And a case in the generic `decode()` switch:

```ts
      case OpCode.COMPONENT_UPDATE:
        return {
          opCode,
          componentUpdate: BinaryProtocol.decodeComponentUpdate(buffer, byteOffset),
        };
```

Import `CARDINAL_REGISTRY` from `../cardinal/components.generated.js` and the two new constants from `./opcodes.js`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @iwsdk/plugin-phoenix test && pnpm --filter @iwsdk/plugin-phoenix typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/protocol/opcodes.ts packages/client/src/protocol/BinaryProtocol.ts packages/client/test/binary-protocol.test.ts
git commit -m "feat(cardinal): COMPONENT_UPDATE frame codec on the client"
```

---

### Task 7: COMPONENT_UPDATE frame — server codec

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/protocol.ex`
- Test: `packages/server/test/protocol_test.exs`
- Modify: `scripts/generate-cardinal.mjs` (frame-level vectors)
- Modify: `packages/client/test/parity.test.ts`, `packages/server/test/parity_test.exs`

**Interfaces:**
- Consumes: `IwsdkPhoenix.Cardinal.Registry` (Task 4).
- Produces:
  - `Protocol.op_component_update() :: 12`
  - `Protocol.encode_component_update(records, server_tick) :: binary` where `records` is a list of `%{network_id: pos_integer, component_id: pos_integer, payload: binary}` — **raw payloads**, because the relay path must never decode
  - `Protocol.decode/1` returning `{:ok, :component_update, %{server_tick: t, records: [...]}}` with raw `payload` binaries
  - `Protocol.component_update_network_ids(binary) :: {:ok, [pos_integer]} | {:error, atom}` — the authority scan, no payload decoding
  Tasks 8 and 9 consume these.

- [ ] **Step 1: Write the failing test**

Append to `IwsdkPhoenix.ProtocolTest`:

```elixir
  describe "component_update" do
    test "round-trips a heterogeneous batch, payloads untouched" do
      health = %{network_id: 7, component_id: 1, payload: <<1, 2, 3, 4, 5, 6, 7, 8>>}
      grab = %{network_id: 9, component_id: 2, payload: :binary.copy(<<9>>, 16)}

      frame = Protocol.encode_component_update([health, grab], 4242)
      assert byte_size(frame) == 7 + 14 + 22

      assert {:ok, :component_update, decoded} = Protocol.decode(frame)
      assert decoded.server_tick == 4242
      assert decoded.records == [health, grab]
    end

    test "encodes an empty batch as a header alone" do
      frame = Protocol.encode_component_update([], 1)
      assert byte_size(frame) == 7
      assert {:ok, :component_update, %{records: []}} = Protocol.decode(frame)
    end

    test "component_update_network_ids scans without decoding payloads" do
      # The relay path's whole point: learn who owns what, forward verbatim.
      frame =
        Protocol.encode_component_update(
          [
            %{network_id: 7, component_id: 1, payload: <<0::size(64)>>},
            %{network_id: 11, component_id: 1, payload: <<0::size(64)>>}
          ],
          0
        )

      assert Protocol.component_update_network_ids(frame) == {:ok, [7, 11]}
    end

    test "rejects an unknown component id" do
      frame = Protocol.encode_component_update([%{network_id: 7, component_id: 1, payload: <<0::size(64)>>}], 0)
      <<head::binary-size(11), _id::binary-size(2), rest::binary>> = frame
      broken = head <> <<999::unsigned-little-integer-size(16)>> <> rest

      assert Protocol.decode(broken) == {:error, :unknown_component}
      assert Protocol.component_update_network_ids(broken) == {:error, :unknown_component}
    end

    test "rejects a truncated frame" do
      frame = Protocol.encode_component_update([%{network_id: 7, component_id: 1, payload: <<0::size(64)>>}], 0)
      assert Protocol.decode(binary_part(frame, 0, 10)) == {:error, :malformed_frame}
    end

    test "rejects a payload whose size does not match the schema" do
      assert_raise ArgumentError, fn ->
        Protocol.encode_component_update([%{network_id: 7, component_id: 1, payload: <<0, 0>>}], 0)
      end
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/protocol_test.exs`
Expected: FAIL — `encode_component_update/2` is undefined.

- [ ] **Step 3: Write the implementation**

In `protocol.ex`, with the other opcodes:

```elixir
  @op_component_update 12
```

```elixir
  def op_component_update, do: @op_component_update
```

```elixir
  @component_update_header 7
  @component_update_record_header 6

  @doc """
  Batch component payloads into one frame.

  Payloads are raw binaries and stay that way: in a relayed room the server
  never decodes them, and even in an authoritative one this function is only
  responsible for framing. The size of each payload is checked against the
  schema, because a wrong-sized payload would silently corrupt every record
  after it — there is no length field to resynchronise on.
  """
  @spec encode_component_update([map()], non_neg_integer()) :: binary()
  def encode_component_update(records, server_tick) do
    body =
      for %{network_id: network_id, component_id: component_id, payload: payload} <- records do
        expected = IwsdkPhoenix.Cardinal.Registry.byte_size_for(component_id)

        cond do
          expected == nil ->
            raise ArgumentError, "unknown component id #{component_id}"

          byte_size(payload) != expected ->
            raise ArgumentError,
                  "component #{component_id} expects #{expected} bytes, got #{byte_size(payload)}"

          true ->
            <<network_id::unsigned-little-integer-size(32),
              component_id::unsigned-little-integer-size(16), payload::binary>>
        end
      end

    IO.iodata_to_binary([
      <<@op_component_update, length(records)::unsigned-little-integer-size(16),
        server_tick::unsigned-little-integer-size(32)>>
      | body
    ])
  end

  @doc """
  Network ids carried by a COMPONENT_UPDATE frame, without decoding payloads.

  This is what the relay path uses to check ownership: it has to know *whose*
  entities a frame touches, and nothing more. Walking the records costs a
  registry lookup each; decoding them would cost the zero-decode fast path.
  """
  @spec component_update_network_ids(binary()) :: {:ok, [pos_integer()]} | {:error, atom()}
  def component_update_network_ids(
        <<@op_component_update, count::unsigned-little-integer-size(16),
          _tick::unsigned-little-integer-size(32), rest::binary>>
      ) do
    scan_component_ids(rest, count, [])
  end

  def component_update_network_ids(_other), do: {:error, :malformed_frame}

  defp scan_component_ids(_rest, 0, acc), do: {:ok, Enum.reverse(acc)}

  defp scan_component_ids(
         <<network_id::unsigned-little-integer-size(32),
           component_id::unsigned-little-integer-size(16), rest::binary>>,
         count,
         acc
       ) do
    case IwsdkPhoenix.Cardinal.Registry.byte_size_for(component_id) do
      nil ->
        {:error, :unknown_component}

      size when byte_size(rest) >= size ->
        <<_payload::binary-size(size), tail::binary>> = rest
        scan_component_ids(tail, count - 1, [network_id | acc])

      _short ->
        {:error, :malformed_frame}
    end
  end

  defp scan_component_ids(_rest, _count, _acc), do: {:error, :malformed_frame}
```

The decode clause, beside the others:

```elixir
  def decode(
        <<@op_component_update, count::unsigned-little-integer-size(16),
          server_tick::unsigned-little-integer-size(32), rest::binary>>
      ) do
    case decode_component_records(rest, count, []) do
      {:ok, records} -> {:ok, :component_update, %{server_tick: server_tick, records: records}}
      {:error, reason} -> {:error, reason}
    end
  end
```

```elixir
  defp decode_component_records(<<>>, 0, acc), do: {:ok, Enum.reverse(acc)}
  defp decode_component_records(_rest, 0, _acc), do: {:error, :malformed_frame}

  defp decode_component_records(
         <<network_id::unsigned-little-integer-size(32),
           component_id::unsigned-little-integer-size(16), rest::binary>>,
         count,
         acc
       ) do
    case IwsdkPhoenix.Cardinal.Registry.byte_size_for(component_id) do
      nil ->
        {:error, :unknown_component}

      size when byte_size(rest) >= size ->
        <<payload::binary-size(size), tail::binary>> = rest

        decode_component_records(tail, count - 1, [
          %{network_id: network_id, component_id: component_id, payload: payload} | acc
        ])

      _short ->
        {:error, :malformed_frame}
    end
  end

  defp decode_component_records(_rest, _count, _acc), do: {:error, :malformed_frame}
```

- [ ] **Step 4: Run the server suite**

Run: `cd packages/server && mix test`
Expected: all green, zero warnings.

- [ ] **Step 5: Add frame-level golden vectors**

In `generate-cardinal.mjs`, after the per-component rows, emit two whole-frame vectors — one empty batch, one heterogeneous batch containing a record for every component in the schema:

```js
vectorLines.push(
  '#',
  '# component_update <serverTick> <recordsJson> <hex>',
);

const frameCases = [
  { tick: 0, records: [] },
  {
    tick: 4242,
    records: sorted.map((component, index) => ({
      networkId: (index + 1) * 7,
      componentId: component.id,
      data: sampleRows(component)[0],
    })),
  },
];

for (const { tick, records } of frameCases) {
  const frame = BinaryProtocol.encodeComponentUpdate(records, tick);
  vectorLines.push(
    `component_update\t${tick}\t${JSON.stringify(records)}\t${Buffer.from(frame).toString('hex')}`,
  );
}
```

(`BinaryProtocol` comes from the same `--experimental-strip-types` import as `CARDINAL_REGISTRY`.)

Then assert them in both parity suites, in the style of the existing frame vectors: the client re-encodes through `BinaryProtocol.encodeComponentUpdate`; the server re-encodes through `Protocol.encode_component_update/2`, converting each record's `data` into a raw payload via the generated module's `encode/1`.

- [ ] **Step 6: Regenerate and run both suites**

Run: `node --experimental-strip-types scripts/generate-cardinal.mjs && pnpm test && (cd packages/server && mix test)`
Expected: all green, including the drift tripwire.

- [ ] **Step 7: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/protocol.ex packages/server/test/protocol_test.exs scripts/generate-cardinal.mjs fixtures/cardinal_vectors.tsv packages/client/test/parity.test.ts packages/server/test/parity_test.exs
git commit -m "feat(cardinal): COMPONENT_UPDATE frame codec on the server, with frame vectors"
```

---

### Task 8: Server cache and room state

**Files:**
- Create: `packages/server/lib/iwsdk_phoenix/cardinal/cache.ex`
- Modify: `packages/server/lib/iwsdk_phoenix/room/state.ex`
- Test: `packages/server/test/cardinal_cache_test.exs`

**Interfaces:**
- Consumes: `Protocol.decode/1`, `Registry` (Tasks 4, 7).
- Produces:
  - `IwsdkPhoenix.Cardinal.Cache.put(cache, mode, records) :: cache` — `mode` is `:host_relayed` (stores raw payloads) or `:server_authoritative` (stores decoded structs)
  - `IwsdkPhoenix.Cardinal.Cache.frames(cache, server_tick) :: [binary]` — replay frames for a late joiner
  - `IwsdkPhoenix.Cardinal.Cache.drop_entity(cache, network_id) :: cache`
  - `State.components` field, `State.put_components/3`, `State.component_frames/1`, `State.drop_components/2`
  Task 9 consumes all of these.

- [ ] **Step 1: Write the failing test**

```elixir
# packages/server/test/cardinal_cache_test.exs
defmodule IwsdkPhoenix.Cardinal.CacheTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Cardinal.{Cache, Health}
  alias IwsdkPhoenix.Protocol

  defp health_payload(current, max), do: Health.encode(%Health{current: current, max: max})

  defp records do
    [
      %{network_id: 7, component_id: 1, payload: health_payload(50.0, 100.0)},
      %{network_id: 9, component_id: 1, payload: health_payload(25.0, 100.0)}
    ]
  end

  describe "host_relayed" do
    test "stores payloads verbatim, never decoding them" do
      cache = Cache.put(Cache.new(), :host_relayed, records())
      assert Cache.get(cache, 7, 1) == health_payload(50.0, 100.0)
    end

    test "the newest value for an entity-component wins" do
      cache =
        Cache.new()
        |> Cache.put(:host_relayed, records())
        |> Cache.put(:host_relayed, [
          %{network_id: 7, component_id: 1, payload: health_payload(10.0, 100.0)}
        ])

      assert Cache.get(cache, 7, 1) == health_payload(10.0, 100.0)
    end
  end

  describe "server_authoritative" do
    test "stores decoded structs, because server logic reads them" do
      cache = Cache.put(Cache.new(), :server_authoritative, records())
      assert %Health{current: 50.0, max: 100.0} = Cache.get(cache, 7, 1)
    end

    test "ignores a record whose payload will not decode" do
      cache =
        Cache.put(Cache.new(), :server_authoritative, [
          %{network_id: 7, component_id: 1, payload: <<0, 0>>}
        ])

      assert Cache.get(cache, 7, 1) == nil
    end
  end

  describe "frames/2" do
    test "replays every cached value as decodable frames" do
      cache = Cache.put(Cache.new(), :host_relayed, records())
      frames = Cache.frames(cache, 99)

      decoded =
        frames
        |> Enum.flat_map(fn frame ->
          {:ok, :component_update, %{records: rs}} = Protocol.decode(frame)
          rs
        end)
        |> Enum.sort_by(& &1.network_id)

      assert decoded == Enum.sort_by(records(), & &1.network_id)
    end

    test "replays from the authoritative cache too" do
      cache = Cache.put(Cache.new(), :server_authoritative, records())
      frames = Cache.frames(cache, 0)
      assert {:ok, :component_update, %{records: [_ | _]}} = Protocol.decode(hd(frames))
    end

    test "an empty cache replays nothing at all" do
      # Not an empty frame: a late joiner with no state to receive should get
      # no traffic, not a header.
      assert Cache.frames(Cache.new(), 0) == []
    end
  end

  describe "drop_entity/2" do
    test "forgets everything about one entity" do
      cache =
        Cache.new()
        |> Cache.put(:host_relayed, records())
        |> Cache.drop_entity(7)

      assert Cache.get(cache, 7, 1) == nil
      assert Cache.get(cache, 9, 1) != nil
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/cardinal_cache_test.exs`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the implementation**

```elixir
# packages/server/lib/iwsdk_phoenix/cardinal/cache.ex
defmodule IwsdkPhoenix.Cardinal.Cache do
  @moduledoc """
  Latest value per `{network_id, component_id}`, for late joiners.

  Without this a peer that arrives after a component was last published never
  learns its value — it would see only future changes, and an object's health
  or hold state would stay at its default until something happened to it.

  What a value *is* depends on the room's mode, and the difference is load
  bearing. In a relayed room the server has no business decoding anything:
  `docs/ARCHITECTURE.md` documents a zero-decode relay path, and the cache
  keeps raw payload binaries so that stays true. In an authoritative room the
  server's own logic reads these values, so they are stored as the generated
  structs.
  """

  alias IwsdkPhoenix.Cardinal.Registry
  alias IwsdkPhoenix.Protocol

  @typedoc "network_id => component_id => raw payload or generated struct"
  @type t :: %{pos_integer() => %{pos_integer() => binary() | struct()}}

  @spec new() :: t()
  def new, do: %{}

  @doc "Record every value in `records`, newest wins."
  @spec put(t(), :host_relayed | :server_authoritative, [map()]) :: t()
  def put(cache, mode, records) do
    Enum.reduce(records, cache, fn record, acc ->
      case value_for(mode, record) do
        :skip ->
          acc

        value ->
          acc
          |> Map.put_new(record.network_id, %{})
          |> update_in([record.network_id], &Map.put(&1, record.component_id, value))
      end
    end)
  end

  defp value_for(:host_relayed, record), do: record.payload

  defp value_for(:server_authoritative, record) do
    case Registry.module_for(record.component_id) do
      nil ->
        :skip

      module ->
        case module.decode(record.payload) do
          {:ok, struct} -> struct
          # A payload that will not decode is a client bug; caching it would
          # replay the same bug to every future joiner.
          :error -> :skip
        end
    end
  end

  @spec get(t(), pos_integer(), pos_integer()) :: binary() | struct() | nil
  def get(cache, network_id, component_id) do
    cache |> Map.get(network_id, %{}) |> Map.get(component_id)
  end

  @spec drop_entity(t(), pos_integer()) :: t()
  def drop_entity(cache, network_id), do: Map.delete(cache, network_id)

  @doc """
  Frames replaying the whole cache, or `[]` when there is nothing to replay.

  One frame for everything: batching is what keeps these binaries above the
  BEAM's 64-byte copy threshold, and a joining peer should not receive one
  small message per component.
  """
  @spec frames(t(), non_neg_integer()) :: [binary()]
  def frames(cache, server_tick) do
    records =
      for {network_id, components} <- cache,
          {component_id, value} <- components do
        %{
          network_id: network_id,
          component_id: component_id,
          payload: to_payload(component_id, value)
        }
      end

    case records do
      [] -> []
      _ -> [Protocol.encode_component_update(records, server_tick)]
    end
  end

  defp to_payload(_component_id, value) when is_binary(value), do: value

  defp to_payload(component_id, %module{} = value) do
    ^module = Registry.module_for(component_id)
    module.encode(value)
  end
end
```

`state.ex` — add the field and its accessors:

```elixir
            components: %{},
```

```elixir
  @doc "Record component values published by a peer."
  @spec put_components(t(), [map()], mode()) :: t()
  def put_components(%__MODULE__{} = state, records, mode) do
    %{state | components: Cache.put(state.components, mode, records)}
  end

  @doc "Frames replaying every cached component; `[]` when there is nothing."
  @spec component_frames(t()) :: [binary()]
  def component_frames(%__MODULE__{} = state) do
    Cache.frames(state.components, state.tick)
  end

  @doc "Forget an entity's components — call when it despawns."
  @spec drop_components(t(), pos_integer()) :: t()
  def drop_components(%__MODULE__{} = state, network_id) do
    %{state | components: Cache.drop_entity(state.components, network_id)}
  end
```

Add `alias IwsdkPhoenix.Cardinal.Cache` at the top of `state.ex`, and initialise `components: %{}` in whatever constructor the module already uses (`defstruct` default covers it).

**Then wire it in — a `drop_components/2` nobody calls is a leak with a
tidy name.** Two call sites, both already in this module:

- `despawn_entity/2`: fold the drop into the same update that removes the
  entity, so the two can never diverge.

  ```elixir
      {%{state | entities: entities, components: Cache.drop_entity(state.components, network_id)},
       Protocol.encode_despawn(network_id)}
  ```

- `leave/2`: a departing player's avatar id goes with them. Drop the
  components keyed to that id in the same pass that removes the player.

  ```elixir
      components =
        case Map.get(state.players, peer_id) do
          nil -> state.components
          player -> Cache.drop_entity(state.components, player.network_id)
        end
  ```

  and carry `components: components` into the returned struct.

Read both functions before editing: `leave/2` already returns a tuple whose
shape callers depend on, and `despawn_entity/2` documents that a duplicate
despawn is harmless — neither invariant may change.

- [ ] **Step 4: Run the server suite**

Run: `cd packages/server && mix test`
Expected: all green, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/cardinal/cache.ex packages/server/lib/iwsdk_phoenix/room/state.ex packages/server/test/cardinal_cache_test.exs
git commit -m "feat(cardinal): component cache in room state, mode-aware"
```

---

### Task 9: Server routing, authority, and the join check

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/room/handler.ex`
- Modify: `packages/server/lib/iwsdk_phoenix/room_channel.ex`
- Test: `apps/demo_server/test/demo_server_web/room_channel_test.exs`

**Interfaces:**
- Consumes: `Protocol.component_update_network_ids/1`, `Protocol.decode/1`, `State.put_components/3`, `State.component_frames/1`, `Registry.schema_hash/0`.
- Produces: op-12 handling in both dispatch branches; `Handler.validate_join/1` extended to reject a mismatched `"schema_hash"` param with `{:error, :schema_mismatch}`; cache replay in `after_join`.

- [ ] **Step 1: Write the failing test**

Append to `DemoServerWeb.RoomChannelTest`. Read the file's `join_room/3` helper first — the schema-hash tests need to pass extra join params, and the helper already accepts a `params` map.

```elixir
  describe "cardinal components" do
    alias IwsdkPhoenix.Cardinal.{Health, Registry}

    defp health(current, max), do: Health.encode(%Health{current: current, max: max})

    test "relays a component update to the other peer" do
      room = unique_room()
      {alice, alice_reply} = join_room("alice", room)
      {_bob, _bob_reply} = join_room("bob", room)

      frame =
        Protocol.encode_component_update(
          [%{network_id: alice_reply.network_id, component_id: 1, payload: health(50.0, 100.0)}],
          0
        )

      push(alice, "frame", {:binary, frame})

      assert_broadcast("frame", {:binary, ^frame})
    end

    test "a late joiner receives the cached component state" do
      # The whole point of the cache: without it, bob would see Health only if
      # alice happened to publish again after he arrived.
      room = unique_room()
      {alice, alice_reply} = join_room("alice", room)

      push(
        alice,
        "frame",
        {:binary,
         Protocol.encode_component_update(
           [%{network_id: alice_reply.network_id, component_id: 1, payload: health(50.0, 100.0)}],
           0
         )}
      )

      # Let the room process the publish before joining the second peer.
      :timer.sleep(50)
      {_bob, _bob_reply} = join_room("bob", room)

      assert_push("frame", {:binary, replayed}, 1000)

      # The replay may arrive after the spawn frames; drain until we find it.
      assert eventually_component_frame(replayed, alice_reply.network_id)
    end

    test "refuses a join whose schema hash does not match" do
      assert {:error, %{reason: "schema_mismatch"}} =
               DemoServerWeb.UserSocket
               |> socket("mallory", %{peer_id: "mallory"})
               |> subscribe_and_join(IwsdkPhoenix.RoomChannel, "room:#{unique_room()}", %{
                 "mode" => "host_relayed",
                 "schema_hash" => "deadbeef"
               })
    end

    test "accepts a join carrying the matching schema hash" do
      assert {:ok, _reply, _socket} =
               DemoServerWeb.UserSocket
               |> socket("alice", %{peer_id: "alice"})
               |> subscribe_and_join(IwsdkPhoenix.RoomChannel, "room:#{unique_room()}", %{
                 "mode" => "host_relayed",
                 "schema_hash" => Registry.schema_hash()
               })
    end

    test "accepts a join with no schema hash at all" do
      # An application that uses no Cardinal components should not have to
      # know this field exists.
      assert {:ok, _reply, _socket} =
               DemoServerWeb.UserSocket
               |> socket("alice", %{peer_id: "alice"})
               |> subscribe_and_join(IwsdkPhoenix.RoomChannel, "room:#{unique_room()}", %{
                 "mode" => "host_relayed"
               })
    end

    test "an authoritative room rejects a client-published component" do
      # The mode's whole premise: the client sends inputs, the server decides
      # what is true. Rejecting rather than ignoring makes a misconfigured
      # client obvious — the same choice the transform path already makes.
      {:ok, _reply, alice} =
        DemoServerWeb.UserSocket
        |> socket("alice", %{peer_id: "alice"})
        |> subscribe_and_join(IwsdkPhoenix.RoomChannel, "room:#{unique_room()}", %{
          "mode" => "server_authoritative"
        })

      reference =
        push(
          alice,
          "frame",
          {:binary,
           Protocol.encode_component_update(
             [%{network_id: 1, component_id: 1, payload: health(50.0, 100.0)}],
             0
           )}
        )

      assert_reply(reference, :error, %{reason: "client_authority_denied"})
    end

    test "forgets an entity's components when it despawns" do
      # Otherwise the cache grows without bound and, worse, replays the state
      # of a dead entity to every future joiner.
      state =
        IwsdkPhoenix.Room.State.new(id: "cache-lifecycle")
        |> IwsdkPhoenix.Room.State.put_components(
          [%{network_id: 7, component_id: 1, payload: health(50.0, 100.0)}],
          :host_relayed
        )

      assert IwsdkPhoenix.Room.State.component_frames(state) != []

      {state, _frame} = IwsdkPhoenix.Room.State.despawn_entity(state, 7)
      assert IwsdkPhoenix.Room.State.component_frames(state) == []
    end
  end

  # Drains pushes until one decodes as a COMPONENT_UPDATE naming `network_id`.
  defp eventually_component_frame(first, network_id) do
    check = fn frame ->
      case Protocol.decode(frame) do
        {:ok, :component_update, %{records: records}} ->
          Enum.any?(records, &(&1.network_id == network_id))

        _other ->
          false
      end
    end

    if check.(first) do
      true
    else
      receive do
        %Phoenix.Socket.Message{event: "frame", payload: {:binary, next}} ->
          eventually_component_frame(next, network_id)
      after
        1000 -> false
      end
    end
  end
```

If `assert_broadcast` / `assert_push` shapes differ in this file, copy the exact form the neighbouring ownership and signalling tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/demo_server && mix test test/demo_server_web/room_channel_test.exs`
Expected: FAIL — the frame is not relayed and the join is not refused.

- [ ] **Step 3: Extend `validate_join/1`**

```elixir
  @doc """
  Validate join params: authority mode, and the Cardinal schema hash.

  A client whose generated components disagree with the server's cannot be
  served: with no length field in a COMPONENT_UPDATE record, a component id
  one side does not know makes the whole frame undecodable. Refusing at join
  turns that into an error message; allowing it would turn it into avatars
  quietly holding wrong values.

  The param is optional — an application using no Cardinal components should
  not have to know it exists.
  """
  def validate_join(params) when is_map(params) do
    with {:ok, mode} <- validate_mode(params) do
      validate_schema_hash(params, mode)
    end
  end

  defp validate_mode(params) do
    case Map.get(params, "mode", "host_relayed") do
      "host_relayed" -> {:ok, :host_relayed}
      "server_authoritative" -> {:ok, :server_authoritative}
      _other -> {:error, :unsupported_mode}
    end
  end

  defp validate_schema_hash(params, mode) do
    case Map.get(params, "schema_hash") do
      nil -> {:ok, mode}
      hash when hash == IwsdkPhoenix.Cardinal.Registry.schema_hash() -> {:ok, mode}
      _mismatch -> {:error, :schema_mismatch}
    end
  end
```

- [ ] **Step 4: Route op 12 in both dispatch branches**

In `dispatch/4` for `:host_relayed`, before the catch-all `true ->` clause:

```elixir
      opcode == Protocol.op_component_update() ->
        relay_components(state, frame)
```

And one handler, plus a rejection:

```elixir
  # Relayed: cache the raw payloads and forward verbatim.
  #
  # No ownership check, deliberately — and this is a decision worth stating,
  # because the obvious instinct is to add one. In this mode transforms are
  # relayed regardless of ownership too: `track_positions/3` swallows an
  # ownership failure (`{:error, _reason} -> state`) and the frame is
  # broadcast anyway. A relayed room trusts its peers by definition; that is
  # what distinguishes it from the authoritative one. Enforcing components
  # more strictly than transforms would be an inconsistency, not a hardening.
  defp relay_components(state, frame) do
    case Protocol.decode(frame) do
      {:ok, :component_update, %{records: records}} ->
        {:broadcast, frame, State.put_components(state, records, :host_relayed)}

      {:error, reason} ->
        {:error, reason, state}
    end
  end
```

In `dispatch/4` for `:server_authoritative`, put the clause **beside the
existing transform rejection** and reject the same way:

```elixir
      # Same reasoning as the transform rejection just above: in this mode the
      # client sends inputs, and the server decides what is true. A client
      # asserting component state is the thing this mode exists to prevent.
      # Server-authored components arrive with layer 1; until then this cache
      # stays empty here, which is correct rather than merely unimplemented.
      opcode == Protocol.op_component_update() ->
        {:error, :client_authority_denied, state}
```

This is why `component_update_network_ids/1` from Task 7 has no caller yet.
Keep it: it is the ownership scan a future per-entity policy would need, it is
tested, and it costs nothing. Note in its `@doc` that it is currently unused
so a reader does not go hunting for the call site.

- [ ] **Step 5: Replay the cache on join**

In `room_channel.ex`'s `handle_info(:after_join, socket)`, after the existing spawn pushes:

```elixir
      # Component state last: the entities have to exist on the client before
      # values can be applied to them.
      for frame <- State.component_frames(state) do
        push(socket, @frame_event, {:binary, frame})
      end
```

- [ ] **Step 6: Run both server suites**

Run: `cd packages/server && mix test && cd ../../apps/demo_server && mix test`
Expected: all green, zero warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/room/handler.ex packages/server/lib/iwsdk_phoenix/room_channel.ex apps/demo_server/test/demo_server_web/room_channel_test.exs
git commit -m "feat(cardinal): route COMPONENT_UPDATE, enforce ownership, replay cache on join"
```

---

### Task 10: Client publish and ingest

**Files:**
- Create: `packages/client/src/cardinal/publish.ts`
- Modify: `packages/client/src/systems/PhoenixNetworkSystem.ts`
- Modify: `packages/client/src/plugin.ts`
- Modify: `packages/client/src/transport/PhoenixConnection.ts`
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/test/cardinal-publish.test.ts`

**Interfaces:**
- Consumes: `CARDINAL_REGISTRY`, `SCHEMA_HASH`, `registerCardinalComponents` (Task 3); `encodeComponentUpdate`, `decodeComponentUpdate` (Task 6); `EntityIndex` (existing).
- Produces: `class CardinalPublisher` with `collect(entity: Entity, networkId: number): ComponentRecord[]` and `forget(networkId: number): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/test/cardinal-publish.test.ts
import { describe, expect, it } from 'vitest';
import { CardinalPublisher } from '../src/cardinal/publish.js';
import { Health } from '../src/cardinal/components.generated.js';
import { World } from './mocks/iwsdk-core.js';

/**
 * A world with the Cardinal components registered and one entity in it.
 *
 * `addComponent` takes the component alone — every value is set afterwards.
 * Copy the world construction from `test/replication.test.ts`, which already
 * does `world.registerComponent(...)` then `world.createEntity()`; do not
 * invent a shape for it here.
 */
function entityWith(current: number, max: number) {
  const world = new World();
  world.registerComponent(Health);
  const entity = world.createEntity();
  entity.addComponent(Health);
  entity.setValue(Health, 'current', current);
  entity.setValue(Health, 'max', max);
  return entity;
}

describe('CardinalPublisher', () => {
  it('emits a record the first time it sees an entity', () => {
    const publisher = new CardinalPublisher();
    const records = publisher.collect(entityWith(50, 100), 7);

    expect(records).toHaveLength(1);
    expect(records[0]!.networkId).toBe(7);
    expect(records[0]!.componentId).toBe(1);
    expect(records[0]!.data).toEqual({ current: 50, max: 100 });
  });

  it('emits nothing when the bytes have not changed', () => {
    // The dirty check is the whole reason a quiet component costs no wire
    // bytes; without it every tick would republish everything.
    const publisher = new CardinalPublisher();
    const entity = entityWith(50, 100);

    expect(publisher.collect(entity, 7)).toHaveLength(1);
    expect(publisher.collect(entity, 7)).toHaveLength(0);
  });

  it('emits again once a value changes', () => {
    const publisher = new CardinalPublisher();
    const entity = entityWith(50, 100);
    publisher.collect(entity, 7);

    entity.setValue(Health, 'current', 25);
    const records = publisher.collect(entity, 7);

    expect(records).toHaveLength(1);
    expect(records[0]!.data).toEqual({ current: 25, max: 100 });
  });

  it('ignores an entity that has no Cardinal components', () => {
    const world = new World();
    const bare = world.createEntity();
    expect(new CardinalPublisher().collect(bare, 7)).toHaveLength(0);
  });

  it('tracks entities independently', () => {
    const publisher = new CardinalPublisher();
    publisher.collect(entityWith(50, 100), 7);

    // Same values, different entity — must still be published once.
    expect(publisher.collect(entityWith(50, 100), 8)).toHaveLength(1);
  });

  it('forgets an entity so a respawned id republishes', () => {
    const publisher = new CardinalPublisher();
    const entity = entityWith(50, 100);
    publisher.collect(entity, 7);
    publisher.forget(7);

    expect(publisher.collect(entity, 7)).toHaveLength(1);
  });
});
```

Check `test/mocks/iwsdk-core.ts` for the exact `World` / entity API it exposes (`createEntity`, `addComponent`, `setValue`); adapt the helper to what is really there rather than adding methods to the mock.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- cardinal-publish`
Expected: FAIL — `publish.ts` does not exist.

- [ ] **Step 3: Write the publisher**

```ts
// packages/client/src/cardinal/publish.ts
/**
 * Outbound change detection for Cardinal components.
 *
 * Every component has a constant byte size, so "has this changed" is a byte
 * comparison against the last thing published — no per-field tracking, no
 * hooks into elics, and a component nobody touches costs nothing on the wire.
 *
 * The comparison is against what was *published*, not against the previous
 * tick's value: a component that changes and changes back within one tick
 * correctly produces no traffic.
 */
import type { Entity } from '@iwsdk/core';
import { CARDINAL_REGISTRY } from './components.generated.js';
import type { ComponentRecord } from '../protocol/BinaryProtocol.js';

export class CardinalPublisher {
  /** networkId → componentId → the bytes last published. */
  private readonly published = new Map<number, Map<number, Uint8Array>>();

  /** Records for everything on `entity` that changed since its last publish. */
  collect(entity: Entity, networkId: number): ComponentRecord[] {
    const records: ComponentRecord[] = [];

    for (const spec of CARDINAL_REGISTRY.values()) {
      if (!entity.hasComponent(spec.component)) continue;

      const data = spec.read(entity);
      const bytes = new Uint8Array(spec.bytes);
      spec.encode(new DataView(bytes.buffer), 0, data);

      let forEntity = this.published.get(networkId);
      if (!forEntity) {
        forEntity = new Map();
        this.published.set(networkId, forEntity);
      }

      const previous = forEntity.get(spec.id);
      if (previous && equalBytes(previous, bytes)) continue;

      forEntity.set(spec.id, bytes);
      records.push({ networkId, componentId: spec.id, data });
    }

    return records;
  }

  /** Drop an entity's history — call on despawn, so a reused id republishes. */
  forget(networkId: number): void {
    this.published.delete(networkId);
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

If `entity.hasComponent` is not the mock's / elics' actual predicate, use whatever the repo's other systems use to test component presence (grep `hasComponent` across `packages/client/src`).

- [ ] **Step 4: Run the publisher test**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- cardinal-publish`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire into the network system**

In `PhoenixNetworkSystem`, add a field `private readonly cardinal = new CardinalPublisher();`, then:

*Ingest* — in the `handleMessage` switch, beside the other cases:

```ts
        case OpCode.COMPONENT_UPDATE: {
          const { records } = BinaryProtocol.decodeComponentUpdate(message.payload);
          for (const record of records) {
            const entity = this.entityIndex.get(record.networkId);
            // A record for an entity we have not spawned yet is dropped, not
            // queued: the server replays its cache after the spawns, so the
            // only way to be early is a frame that raced its own spawn.
            if (!entity) continue;
            CARDINAL_REGISTRY.get(record.componentId)?.write(entity, record.data);
          }
          break;
        }
```

*Publish* — in the outbound loop, alongside the transform publish and under the same per-entity rate limit (`sendRateHz` / `lastSentAt`), accumulate records across owned entities and send **one** frame per tick:

```ts
    // One frame for every entity's changes, never one per component: a lone
    // record falls under the BEAM's 64-byte threshold and would be copied to
    // every recipient instead of shared.
    const componentRecords: ComponentRecord[] = [];
    for (const entity of ownedEntities) {
      const networkId = entity.getValue(Networked, 'networkId') ?? 0;
      if (networkId === 0) continue;
      componentRecords.push(...this.cardinal.collect(entity, networkId));
    }
    if (componentRecords.length > 0) {
      const frame = BinaryProtocol.encodeComponentUpdate(componentRecords);
      adapter.send(frame);
      this.framesSent++;
      this.bytesSent += frame.byteLength;
    }
```

Place this next to the existing publish block and reuse its `ownedEntities` query and its adapter reference — read lines 230-285 of the file and follow that shape exactly. Call `this.cardinal.forget(networkId)` wherever the system already handles `DESPAWN_ENTITY`.

- [ ] **Step 6: Register components and send the hash**

`plugin.ts`, beside the existing `.registerComponent(NetworkStats)` chain:

```ts
  registerCardinalComponents(world);
```

`PhoenixConnection.connect`, in the channel params (around line 113):

```ts
    const channel = socket.channel(`room:${roomId}`, {
      mode: options.mode ?? 'host_relayed',
      schema_hash: SCHEMA_HASH,
      ...options.params,
    });
```

`index.ts`, with the other public exports:

```ts
// Cardinal
export {
  CARDINAL_REGISTRY,
  SCHEMA_HASH,
  registerCardinalComponents,
} from './cardinal/components.generated.js';
export type { CardinalComponentSpec } from './cardinal/components.generated.js';
export { CardinalPublisher } from './cardinal/publish.js';
export type {
  ComponentRecord,
  ComponentUpdateFrame,
} from './protocol/BinaryProtocol.js';
```

- [ ] **Step 7: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm demo:typecheck`
Expected: all green — the packaging test catches a missing export.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/cardinal/publish.ts packages/client/src/systems/PhoenixNetworkSystem.ts packages/client/src/plugin.ts packages/client/src/transport/PhoenixConnection.ts packages/client/src/index.ts packages/client/test/cardinal-publish.test.ts
git commit -m "feat(cardinal): publish changed components and ingest COMPONENT_UPDATE"
```

---

### Task 11: Documentation

**Files:**
- Modify: `docs/PROTOCOL.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`

- [ ] **Step 1: Add the opcode table row**

```markdown
| 12 | `COMPONENT_UPDATE` | both | 7 + Σ(6 + componentBytes) |
```

- [ ] **Step 2: Add the frame section**

After the `SIGNAL` section, in the file's established style:

```markdown
## `COMPONENT_UPDATE` (12) — 7 + Σ(6 + componentBytes)

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 12 |
| 1–2 | `u16` | record count |
| 3–6 | `u32` | `serverTick` |

Then, `count` times:

| Type | Field |
|---|---|
| `u32` | `networkId` |
| `u16` | `componentId` |
| `u8[]` | payload — exactly `byteSize(componentId)` bytes |

Component layouts are **generated**, not hand-written: `cardinal/components.mjs`
is the source of truth and `scripts/generate-cardinal.mjs` emits the codecs on
both sides plus the golden vectors in `fixtures/cardinal_vectors.tsv`. Editing
a generated file, or editing the schema without regenerating, fails
`scripts/check-cardinal-drift.mjs` in `pnpm test`.

A record carries **no length field**: the payload size is a property of the
component id. That keeps per-record overhead at 6 bytes, and it means an
unknown component id makes the rest of the frame unreadable — the reader
cannot know how far to skip. Schema agreement is therefore checked once, at
join: the client sends `schema_hash` in its join params and the server refuses
a mismatch with `schema_mismatch`. The param is optional, so an application
using no Cardinal components never sees it.

Frames are always batched. A single record would be ~15 bytes, below the
BEAM's 64-byte heap-binary threshold, and would be copied to every recipient
rather than shared by reference.
```

- [ ] **Step 3: Note the layer in ARCHITECTURE.md**

Add a short section near the existing "Parity through a shared formula, not a shared binary" — Cardinal generalizes exactly that idea from one system to all component data, and a reader who found the Kinematic section should be pointed at it.

- [ ] **Step 4: Document the workflow in README.md**

Add to the development section: how to add a component (edit `cardinal/components.mjs`, run `node --experimental-strip-types scripts/generate-cardinal.mjs`, commit the generated diff), and that the drift tripwire runs in `pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add docs/PROTOCOL.md docs/ARCHITECTURE.md README.md
git commit -m "docs: COMPONENT_UPDATE frame and the Cardinal schema workflow"
```

---

### Task 12: Full verification sweep

- [ ] **Step 1: Regenerate from scratch and confirm no drift**

```bash
node --experimental-strip-types scripts/generate-cardinal.mjs
git diff --exit-code   # must be empty: the committed artifacts already match
node scripts/check-cardinal-drift.mjs
```

- [ ] **Step 2: Every suite**

Run: `pnpm test && pnpm typecheck && (cd packages/server && mix test) && (cd apps/demo_server && mix test)`
Expected: all green.

- [ ] **Step 3: Demo builds**

Run: `pnpm demo:build && pnpm demo:typecheck`
Expected: clean.

- [ ] **Step 4: Live two-client check**

Start the Phoenix server (`cd apps/demo_server && mix phx.server`), build and serve `apps/demo/dist` with the COOP/COEP static server, and run the existing two-client Playwright harness. Add a temporary probe that gives one client a `Health` component and asserts the other receives it, plus a late-joining third client that receives it from the cache replay. Remove the probe afterwards.

- [ ] **Step 5: Confirm the schema-mismatch path in the real browser**

Temporarily edit `SCHEMA_HASH` in the generated client file to a wrong value, rebuild, and confirm the join is refused with `schema_mismatch` in the console rather than the session half-working. Then `git checkout` the file and rebuild. This is the one failure mode that must be loud, so see it be loud.

- [ ] **Step 6: Final state**

```bash
git status --short   # clean
```

---

## Self-review notes (already applied)

- **Spec coverage:** Section 1 → Tasks 1–2; Section 2 → Tasks 3–5; Section 3 → Tasks 6–7; Section 4 → Tasks 8–10; Section 5 → Tasks 5, 7, 9, 10, 12. Every design decision with a "why" in the spec has a test that would fail if it were reversed — closed type set (Task 1), permanent ids (Task 2), committed-and-diffable artifacts (Task 5), batching over per-component frames (Tasks 6, 10), zero-decode relay (Tasks 7, 8), join-time hash check (Task 9), memcmp dirty tracking (Task 10).
- **Type consistency:** `CardinalComponentSpec` fields (`id`, `name`, `bytes`, `component`, `encode`, `decode`, `read`, `write`) are used identically in Tasks 3, 6, 10. `ComponentRecord` is `{ networkId, componentId, data }` on the client and `%{network_id, component_id, payload}` on the server — deliberately different, because the server never holds decoded data on the relay path; both spellings appear consistently in Tasks 6–10.
- **Second review pass, 2026-08-14** — the plan was checked against the code rather than re-read, and ten defects were fixed. Six were wrong API facts (vector accessor, quaternion function names and value shape, `jason` optionality, the non-existent ownership predicate, `addComponent` arity); two were structural bugs in the generator (importing an artifact before writing it, and importing inside a loop); one was a destructive drift check that could clobber uncommitted work; one was a pair of fixture helpers named but never written. The Global Constraints list above now carries each verified fact with a ⚠ where it contradicted the earlier draft.
- **Design questions the review surfaced, resolved in the spec:** per-entity ownership checks on components were dropped in favour of matching the transform path exactly (relay in `host_relayed`, reject in `server_authoritative`), and the cache gained an explicit lifecycle tied to despawn and player departure. Both are recorded in the design document, not only here.
- **Deliberately kept without a caller:** `Protocol.component_update_network_ids/1` (Task 7). The authority resolution removed its call site, but it is tested, costs nothing, and is exactly the scan a future per-entity policy would need. Its `@doc` says so.
- **Deliberately deferred to a later plan:** persisting the component cache through `IwsdkPhoenix.Persistence`, per-field deltas, string/map types, and AoI filtering of component traffic (the frame rides the existing broadcast path; `SpatialGrid` filtering of component records is a natural follow-up once layer 1 needs it).
