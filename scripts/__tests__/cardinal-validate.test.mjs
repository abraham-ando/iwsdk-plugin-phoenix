/**
 * Schema validation and hashing.
 *
 *   node --test 'scripts/__tests__/**\/*.test.mjs'
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { components } from '../../cardinal/components.mjs';
import { componentSize, schemaHash, validateSchema } from '../../cardinal/validate.mjs';

const ok = [{ id: 1, name: 'Health', fields: [{ name: 'current', type: 'f32' }] }];

describe('validateSchema', () => {
  it('accepts the committed schema', () => {
    assert.doesNotThrow(() => validateSchema(components));
  });

  it('rejects duplicate ids — an id is a permanent wire identity', () => {
    assert.throws(
      () =>
        validateSchema([
          ...ok,
          { id: 1, name: 'Other', fields: [{ name: 'a', type: 'u8' }] },
        ]),
      /duplicate id/i,
    );
  });

  it('rejects duplicate names', () => {
    assert.throws(
      () =>
        validateSchema([
          ...ok,
          { id: 2, name: 'Health', fields: [{ name: 'a', type: 'u8' }] },
        ]),
      /duplicate name/i,
    );
  });

  it('rejects an id outside the u16 wire range', () => {
    assert.throws(
      () => validateSchema([{ id: 70000, name: 'Big', fields: [{ name: 'a', type: 'u8' }] }]),
      /out of range/i,
    );
  });

  it('rejects id 0 — reserved, like network id 0', () => {
    assert.throws(
      () => validateSchema([{ id: 0, name: 'Zero', fields: [{ name: 'a', type: 'u8' }] }]),
      /out of range/i,
    );
  });

  it('rejects a component name that is not PascalCase', () => {
    // Must be a legal TS identifier AND a legal Elixir module segment.
    assert.throws(
      () =>
        validateSchema([{ id: 1, name: 'health-bar', fields: [{ name: 'a', type: 'u8' }] }]),
      /PascalCase/i,
    );
  });

  it('rejects a field name that is not camelCase', () => {
    assert.throws(
      () =>
        validateSchema([
          { id: 1, name: 'Health', fields: [{ name: 'Current-HP', type: 'u8' }] },
        ]),
      /camelCase/i,
    );
  });

  it('rejects an unknown field type', () => {
    assert.throws(
      () =>
        validateSchema([
          { id: 1, name: 'Health', fields: [{ name: 'label', type: 'string' }] },
        ]),
      /unknown type/i,
    );
  });

  it('rejects a component with no fields', () => {
    assert.throws(
      () => validateSchema([{ id: 1, name: 'Empty', fields: [] }]),
      /at least one/i,
    );
  });

  it('rejects duplicate field names inside one component', () => {
    assert.throws(
      () =>
        validateSchema([
          {
            id: 1,
            name: 'Health',
            fields: [
              { name: 'a', type: 'u8' },
              { name: 'a', type: 'u8' },
            ],
          },
        ]),
      /duplicate field/i,
    );
  });
});

describe('componentSize', () => {
  it('sums its fields', () => {
    assert.equal(
      componentSize({
        id: 2,
        name: 'Grabbable',
        fields: [
          { name: 'holderId', type: 'u32' },
          { name: 'grabPoint', type: 'vec3' },
        ],
      }),
      16,
    );
  });
});

describe('schemaHash', () => {
  it('is eight lowercase hex characters', () => {
    assert.match(schemaHash(components), /^[0-9a-f]{8}$/);
  });

  it('is stable across calls', () => {
    assert.equal(schemaHash(components), schemaHash(components));
  });

  it('ignores component order — ids are the identity, not position', () => {
    const forward = [
      { id: 1, name: 'A', fields: [{ name: 'x', type: 'u8' }] },
      { id: 2, name: 'B', fields: [{ name: 'y', type: 'u8' }] },
    ];
    assert.equal(schemaHash(forward), schemaHash([...forward].reverse()));
  });

  it('changes when a field type changes', () => {
    const before = [{ id: 1, name: 'A', fields: [{ name: 'x', type: 'u8' }] }];
    const after = [{ id: 1, name: 'A', fields: [{ name: 'x', type: 'u16' }] }];
    assert.notEqual(schemaHash(before), schemaHash(after));
  });

  it('changes when a field is renamed', () => {
    // The layout is untouched, but a rename changes what each side believes a
    // byte range means — which is exactly the disagreement the hash exists to
    // catch at join time.
    const before = [{ id: 1, name: 'A', fields: [{ name: 'x', type: 'u8' }] }];
    const after = [{ id: 1, name: 'A', fields: [{ name: 'z', type: 'u8' }] }];
    assert.notEqual(schemaHash(before), schemaHash(after));
  });
});
