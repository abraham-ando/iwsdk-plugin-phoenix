import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { createGenome, defaultGenome, centeredDraw } from '../src/genome/create';
import type { RngLike } from '../src/genome/types';

/** Rng de test : suite fournie, rebouclée. Aucune dépendance au moteur. */
function fakeRng(values: number[]): RngLike {
  let i = 0;
  return { next: () => values[i++ % values.length]! };
}

describe('defaultGenome', () => {
  it('met chaque gène de la famille à 0.5', () => {
    const g = defaultGenome(HUMANOID);
    expect(Object.keys(g.genes).sort()).toEqual(Object.keys(HUMANOID.genes).sort());
    for (const value of Object.values(g.genes)) expect(value).toBe(0.5);
  });

  it('porte l identifiant de sa famille', () => {
    expect(defaultGenome(HUMANOID).family).toBe('humanoid');
  });
});

describe('centeredDraw', () => {
  it('rend 0.5 au centre et reste borné aux extrêmes', () => {
    expect(centeredDraw(fakeRng([0.5, 0.5]))).toBeCloseTo(0.5, 10);
    expect(centeredDraw(fakeRng([0, 0]))).toBe(0);
    expect(centeredDraw(fakeRng([0.999999, 0.999999]))).toBeLessThan(1);
  });

  it('concentre la population autour du centre', () => {
    // Un tirage uniforme peuplerait le village de géants et de nains.
    const rng = makeCountingRng(20250817);
    let extremes = 0;
    for (let i = 0; i < 10000; i++) {
      const v = centeredDraw(rng);
      if (v < 0.15 || v > 0.85) extremes++;
    }
    // Bates n=2 est triangulaire : P(X < 0.15) = P(X > 0.85) = 2 × 0.15² = 4,5 %
    // par queue, soit 9 % au total. Le seuil laisse la marge d'échantillonnage
    // (σ ≈ 0,3 % sur 10 000 tirages) et reste très en dessous des 30 % qu'un
    // tirage uniforme produirait — ce que le test doit justement détecter.
    expect(extremes / 10000).toBeLessThan(0.11);
  });
});

describe('createGenome', () => {
  it('produit un gène par gène déclaré, tous dans [0,1]', () => {
    const g = createGenome(HUMANOID, makeCountingRng(7));
    expect(Object.keys(g.genes).sort()).toEqual(Object.keys(HUMANOID.genes).sort());
    for (const value of Object.values(g.genes)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('est déterministe : même graine, même génome', () => {
    const a = createGenome(HUMANOID, makeCountingRng(42));
    const b = createGenome(HUMANOID, makeCountingRng(42));
    expect(a).toEqual(b);
  });

  it('diffère d une graine à l autre', () => {
    const a = createGenome(HUMANOID, makeCountingRng(1));
    const b = createGenome(HUMANOID, makeCountingRng(2));
    expect(a).not.toEqual(b);
  });
});

/** Générateur déterministe local — le paquet n en fournit pas, par conception. */
function makeCountingRng(seed: number): RngLike {
  let h = seed >>> 0;
  return {
    next() {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
    },
  };
}
