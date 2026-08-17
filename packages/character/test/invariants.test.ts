import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { createGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import type { RngLike } from '../src/genome/types';
import { humanoidBinding as binding } from './fixtures/humanoid-binding';

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

describe('dix mille génomes tirés au hasard', () => {
  it('ne produisent jamais de valeur non finie, ni de personnage absurde', () => {
    const rng = makeCountingRng(20260817);
    const rig = binding();
    const âges = [0, 1, 4, 9, 14, 18, 35, 70];

    for (let i = 0; i < 10000; i++) {
      const genome = createGenome(HUMANOID, rng);
      const age = âges[i % âges.length]!;
      const c = compile(HUMANOID, genome, age, rig);

      for (const bone of c.restPose) {
        for (const axis of bone.position) {
          expect(Number.isFinite(axis)).toBe(true);
        }
        // L'invariant central : aucune échelle non uniforme n'est représentable,
        // et l'échelle uniforme reste strictement positive et bornée.
        expect(Number.isFinite(bone.scale)).toBe(true);
        expect(bone.scale).toBeGreaterThan(0.05);
        expect(bone.scale).toBeLessThan(5);
      }

      for (const influence of Object.values(c.morphs)) {
        expect(Number.isFinite(influence)).toBe(true);
        expect(Math.abs(influence)).toBeLessThanOrEqual(1);
      }

      expect(c.stats.nominalHeightMeters).toBeGreaterThan(0.3);
      expect(c.stats.nominalHeightMeters).toBeLessThan(2.6);
    }
  });

  it('classe toujours un adulte plus grand que le nourrisson de même génome', () => {
    const rng = makeCountingRng(5);
    const rig = binding();
    for (let i = 0; i < 500; i++) {
      const genome = createGenome(HUMANOID, rng);
      expect(compile(HUMANOID, genome, 0, rig).stats.nominalHeightMeters)
        .toBeLessThan(compile(HUMANOID, genome, 18, rig).stats.nominalHeightMeters);
    }
  });
});
