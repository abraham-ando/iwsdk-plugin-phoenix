import { describe, expect, it } from 'vitest';
import { percentiles } from '../src/simulation/FramePercentiles.js';

describe('percentiles', () => {
  it('returns all zeros for an empty sample set', () => {
    expect(percentiles([])).toEqual({ p50: 0, p95: 0, p99: 0 });
  });

  it('matches the FrameSampler.report() scheme, extended to p99', () => {
    // 100 échantillons 1..100 ms. Formule : tri croissant, puis
    // at(q) = tri[min(length-1, floor(length*q))].
    // length = 100 → p50 = tri[50] = 51, p95 = tri[95] = 96, p99 = tri[99] = 100.
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentiles(samples)).toEqual({ p50: 51, p95: 96, p99: 100 });
  });

  it('is invariant to input order', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    const shuffled = [...sorted].reverse();
    // Un mélange non trivial, pas seulement l'inverse.
    const scrambled = [
      37, 2, 91, 15, 64, 8, 100, 1, 50, 73, ...sorted.filter(
        (n) => ![37, 2, 91, 15, 64, 8, 100, 1, 50, 73].includes(n),
      ),
    ];

    const fromSorted = percentiles(sorted);
    const fromReversed = percentiles(shuffled);
    const fromScrambled = percentiles(scrambled);

    expect(fromReversed).toEqual(fromSorted);
    expect(fromScrambled).toEqual(fromSorted);
  });
});
