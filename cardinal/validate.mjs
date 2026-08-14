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
