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
        // Enveloppe atteignable, calculée et non devinée : `scale` ne vaut que
        // bodyScale sur la racine (0.28 à la naissance) ou headRatio sur la
        // tête (0.25/0.133 ≈ 1.880 à la naissance), et 1 partout ailleurs.
        // La borne serre volontairement : changer LENGTH_SPAN ou une courbe de
        // proportion doit devenir un geste délibéré, pas un glissement muet.
        expect(Number.isFinite(bone.scale)).toBe(true);
        expect(bone.scale).toBeGreaterThan(0.25);
        expect(bone.scale).toBeLessThan(2);

        // La SEULE grandeur que le génome pilote vraiment. Le facteur appliqué à
        // la translation d'un os est stature × propre × ageFactor, chacun borné :
        // lengthFactor ∈ [0.75, 1.25] et limbRatio ∈ [0.62, 1]. Le produit vit
        // donc dans [0.349, 1.5625], et un os hors chaîne garde exactement 1.
        const repos = rig.bones[bone.role]!;
        const normeRepos = Math.hypot(repos.position[0]!, repos.position[1]!, repos.position[2]!);
        if (normeRepos > 0) {
          const facteur = Math.hypot(bone.position[0]!, bone.position[1]!, bone.position[2]!) / normeRepos;
          expect(facteur).toBeGreaterThan(0.34);
          expect(facteur).toBeLessThan(1.57);
        }
      }

      for (const influence of Object.values(c.morphs)) {
        expect(Number.isFinite(influence)).toBe(true);
        // Tripwire : un morph dont la plage dépasserait [-1, 1] escaladerait
        // silencieusement la grandeur jusqu'à des valeurs d'archétype inverses.
        expect(Math.abs(influence)).toBeLessThanOrEqual(1);
      }

      // 1.75 × bodyScale × stature, avec bodyScale ∈ [0.28, 1] et
      // stature ∈ [0.75, 1.25] : l'intervalle réel est [0.3675, 2.1875].
      expect(c.stats.nominalHeightMeters).toBeGreaterThan(0.35);
      expect(c.stats.nominalHeightMeters).toBeLessThan(2.25);
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
