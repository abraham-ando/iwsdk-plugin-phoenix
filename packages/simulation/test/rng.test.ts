import { describe, it, expect } from 'vitest';
import { Rng } from '../src/kernel/Rng';

describe('Rng', () => {
  it('produces an identical sequence for an identical seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays within [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(min, max) stays within [min, max) and covers the range', () => {
    const rng = new Rng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1_000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  it('pick() throws on an empty array', () => {
    expect(() => new Rng(1).pick([])).toThrow('Rng.pick: empty array');
  });

  it('state round-trip resumes the exact sequence', () => {
    const rng = new Rng(1234);
    for (let i = 0; i < 50; i++) rng.next();
    const state = rng.getState();
    const expected = Array.from({ length: 20 }, () => rng.next());

    const resumed = new Rng(0);
    resumed.setState(state);
    const actual = Array.from({ length: 20 }, () => resumed.next());
    expect(actual).toEqual(expected);
  });
});
