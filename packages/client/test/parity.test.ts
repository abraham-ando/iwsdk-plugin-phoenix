/**
 * Cross-language parity, asserted from the TypeScript side.
 *
 * `fixtures/protocol_vectors.tsv` is generated from this implementation and
 * verified against the Elixir one in `packages/server/test/parity_test.exs`.
 * Reading it back here matters as much as the Elixir half: without it, a change
 * to the TypeScript codec would silently regenerate the fixture and only fail
 * in the *other* language's suite, which makes the real cause hard to see.
 * Checking it in both places means whichever side breaks parity is the side
 * that reports it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BinaryProtocol } from '../src/protocol/BinaryProtocol.js';
import { compressQuaternion } from '../src/protocol/quaternion-compression.js';
import { integrateMovement } from '../src/math/movement.js';
import {
  CARDINAL_REGISTRY,
  SCHEMA_HASH,
} from '../src/cardinal/components.generated.js';
import { cardinalOf, valuesFor } from './cardinal-fixtures.js';

const fixturePath = fileURLToPath(
  new URL('../../../fixtures/protocol_vectors.tsv', import.meta.url),
);

/** Parse the fixture into `[kind, ...fields]` rows, comments stripped. */
function loadRows(): string[][] {
  return readFileSync(fixturePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => line.split('\t'));
}

const rows = loadRows();
const of = (kind: string) => rows.filter((row) => row[0] === kind).map((row) => row.slice(1));
const hex = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('hex');
const num = (value: string | undefined) => Number(value);

describe('golden vectors', () => {
  it('the fixture file is present and populated', () => {
    expect(rows.length).toBeGreaterThan(20);
  });

  it('quaternion packing matches', () => {
    const cases = of('quat');
    expect(cases.length).toBeGreaterThan(0);

    for (const [x, y, z, w, packed] of cases) {
      const actual = compressQuaternion({
        x: num(x),
        y: num(y),
        z: num(z),
        w: num(w),
      });
      expect(actual, `quat ${x},${y},${z},${w}`).toBe(num(packed));
    }
  });

  it('TRANSFORM_UPDATE matches', () => {
    for (const [id, px, py, pz, rx, ry, rz, rw, expected] of of('transform')) {
      const frame = BinaryProtocol.encodeTransform(
        num(id),
        { x: num(px), y: num(py), z: num(pz) },
        { x: num(rx), y: num(ry), z: num(rz), w: num(rw) },
      );
      expect(hex(frame)).toBe(expected);
      expect(frame.byteLength).toBe(33);
    }
  });

  it('SNAPSHOT matches, quantized and not', () => {
    // Snapshot rows are followed by their record rows, so walk the file in
    // order rather than filtering by kind.
    let index = 0;
    let checked = 0;

    while (index < rows.length) {
      const row = rows[index] as string[];
      if (row[0] !== 'snapshot') {
        index++;
        continue;
      }

      const [, quantized, tick, count, expected] = row;
      const records = [];

      for (let i = 0; i < num(count); i++) {
        const record = rows[index + 1 + i] as string[];
        expect(record[0]).toBe('record');
        const [, id, px, py, pz, rx, ry, rz, rw] = record;
        records.push({
          networkId: num(id),
          position: { x: num(px), y: num(py), z: num(pz) },
          rotation: { x: num(rx), y: num(ry), z: num(rz), w: num(rw) },
        });
      }

      expect(hex(BinaryProtocol.encodeSnapshot(records, num(tick), quantized === '1'))).toBe(
        expected,
      );

      checked++;
      index += 1 + num(count);
    }

    expect(checked).toBeGreaterThan(0);
  });

  it('INPUT_UPDATE matches', () => {
    for (const [sequence, deltaMs, mx, my, yaw, buttons, expected] of of('input')) {
      const frame = BinaryProtocol.encodeInput({
        sequence: num(sequence),
        deltaMs: num(deltaMs),
        movement: { x: num(mx), y: num(my) },
        yaw: num(yaw),
        buttons: num(buttons),
      });
      expect(hex(frame)).toBe(expected);
    }
  });

  it('RECONCILE matches', () => {
    for (const [id, sequence, x, y, z, expected] of of('reconcile')) {
      const frame = BinaryProtocol.encodeReconcile({
        networkId: num(id),
        lastProcessedSequence: num(sequence),
        position: { x: num(x), y: num(y), z: num(z) },
      });
      expect(hex(frame)).toBe(expected);
    }
  });

  it('SPAWN and DESPAWN match', () => {
    for (const [id, prefab, owner, px, py, pz, rx, ry, rz, rw, expected] of of('spawn')) {
      const frame = BinaryProtocol.encodeSpawn({
        networkId: num(id),
        prefabId: num(prefab),
        ownerId: num(owner),
        position: { x: num(px), y: num(py), z: num(pz) },
        rotation: { x: num(rx), y: num(ry), z: num(rz), w: num(rw) },
      });
      expect(hex(frame)).toBe(expected);
    }

    for (const [id, expected] of of('despawn')) {
      expect(hex(BinaryProtocol.encodeDespawn(num(id)))).toBe(expected);
    }
  });

  it('PING and PONG match', () => {
    for (const [timestamp, pong, expected] of of('ping')) {
      expect(hex(BinaryProtocol.encodePing(num(timestamp), pong === '1'))).toBe(expected);
    }
  });

  it('extended PONG matches', () => {
    const cases = of('pong');
    expect(cases.length).toBeGreaterThan(0);

    for (const [t0, t1, t2, epoch, expected] of cases) {
      expect(hex(BinaryProtocol.encodePong(num(t0), num(t1), num(t2), num(epoch)))).toBe(
        expected,
      );
    }
  });

  it('SIGNAL matches', () => {
    const cases = of('signal');
    expect(cases.length).toBeGreaterThan(0);

    for (const [target, sender, text, expected] of cases) {
      const frame = BinaryProtocol.encodeSignalText(num(target), text ?? '', num(sender));
      expect(hex(frame)).toBe(expected);

      // And it decodes back to the same text on this side.
      const decoded = BinaryProtocol.decodeSignal(frame);
      expect(BinaryProtocol.decodeSignalText(decoded)).toBe(text ?? '');
      expect(decoded.targetNetworkId).toBe(num(target));
      expect(decoded.senderNetworkId).toBe(num(sender));
    }
  });

  it('movement integration matches', () => {
    const cases = of('movement');
    expect(cases.length).toBeGreaterThan(0);

    for (const [x, z, mx, my, yaw, dt, speed, maxDeltaMs, outX, outZ] of cases) {
      const result = integrateMovement(
        num(x),
        num(z),
        num(mx),
        num(my),
        num(yaw),
        num(dt),
        num(speed),
        num(maxDeltaMs),
      );
      expect(result.x).toBeCloseTo(num(outX), 12);
      expect(result.z).toBeCloseTo(num(outZ), 12);
    }
  });

  it('Cardinal component vectors match', () => {
    // Generated per component, so adding one to the schema creates its parity
    // proof without anyone writing a test.
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

  it('Cardinal schema hash matches the fixture', () => {
    // If the two languages ever computed the hash differently, this row is
    // what arbitrates between them.
    expect(SCHEMA_HASH).toBe(cardinalOf('cardinal_schema_hash')[0]![0]);
  });
});
