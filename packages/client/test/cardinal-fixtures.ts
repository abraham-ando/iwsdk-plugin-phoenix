/**
 * Reader for `fixtures/cardinal_vectors.tsv`.
 *
 * Values arrive as a flat run of numbers because the fixture format is
 * tab-separated scalars; the component's own field list is what recovers the
 * structure. The registry carries that list precisely so this reader — and its
 * Elixir twin in `packages/server/test/support/cardinal_fixtures.ex` — need no
 * schema of their own.
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
export function valuesFor(
  componentId: number,
  flat: string[],
): Record<string, unknown> {
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
