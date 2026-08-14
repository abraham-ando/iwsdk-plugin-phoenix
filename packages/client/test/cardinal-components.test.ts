/**
 * The generated client artifact.
 *
 * These assertions are about the *shape* of what the generator emits — sizes,
 * registry coverage, offset handling, endianness. The cross-language proof
 * lives in the golden vectors; this file catches a generator that produces
 * something self-consistent but wrong.
 */
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

  it('describes its fields, so a flat value list can be rebuilt', () => {
    expect(CARDINAL_REGISTRY.get(2)!.fields).toEqual([
      { name: 'holderId', slots: 1 },
      { name: 'grabPoint', slots: 3 },
    ]);
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
