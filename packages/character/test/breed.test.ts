import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { breed } from '../src/genome/breed';
import { createGenome } from '../src/genome/create';
import type { FamilyDescriptor } from '../src/family/types';
import type { Genome, RngLike } from '../src/genome/types';
// Rng local : le paquet n'en fournit aucun, par conception — c'est le moteur
// de simulation qui injecte le sien.

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

/** Famille jouet : un seul gène, entièrement héritable, sans mutation. */
const PUR: FamilyDescriptor = {
  ...HUMANOID,
  id: 'pur',
  chains: {},
  genes: { taille: { group: 'structure', heritability: 1, dominance: 0.5, mutationRate: 0 } },
};

const g = (family: string, genes: Record<string, number>): Genome => ({ family, genes });

describe('breed', () => {
  it('est déterministe : mêmes parents, même graine, même enfant', () => {
    const mère = createGenome(HUMANOID, makeCountingRng(1));
    const père = createGenome(HUMANOID, makeCountingRng(2));
    const a = breed(HUMANOID, mère, père, makeCountingRng(99), 'f');
    const b = breed(HUMANOID, mère, père, makeCountingRng(99), 'f');
    expect(a).toEqual(b);
  });

  it('sans mutation ni dérive, l enfant reste ENTRE ses parents', () => {
    for (let seed = 0; seed < 200; seed++) {
      const enfant = breed(PUR, g('pur', { taille: 0.2 }), g('pur', { taille: 0.8 }),
        makeCountingRng(seed), 'f');
      expect(enfant.genes['taille']!).toBeGreaterThanOrEqual(0.2);
      expect(enfant.genes['taille']!).toBeLessThanOrEqual(0.8);
    }
  });

  it('deux parents identiques donnent un enfant identique', () => {
    const enfant = breed(PUR, g('pur', { taille: 0.37 }), g('pur', { taille: 0.37 }),
      makeCountingRng(5), 'm');
    expect(enfant.genes['taille']!).toBeCloseTo(0.37, 10);
  });

  it('une héritabilité nulle décorrèle l enfant de ses parents', () => {
    const libre: FamilyDescriptor = {
      ...PUR,
      genes: { taille: { group: 'structure', heritability: 0, dominance: 0.5, mutationRate: 0 } },
    };
    const rng = makeCountingRng(11);
    let différents = 0;
    for (let i = 0; i < 500; i++) {
      const enfant = breed(libre, g('pur', { taille: 1 }), g('pur', { taille: 1 }), rng, 'f');
      if (Math.abs(enfant.genes['taille']! - 1) > 0.1) différents++;
    }
    expect(différents).toBeGreaterThan(400);
  });

  it('reste toujours dans [0,1], même avec des parents extrêmes et de la mutation', () => {
    const volatil: FamilyDescriptor = {
      ...PUR,
      genes: { taille: { group: 'structure', heritability: 1, dominance: 0.5, mutationRate: 1 } },
    };
    const rng = makeCountingRng(3);
    for (let i = 0; i < 2000; i++) {
      const v = breed(volatil, g('pur', { taille: 1 }), g('pur', { taille: 0 }), rng, 'm')
        .genes['taille']!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('sur mille enfants, la moyenne converge vers la moyenne parentale', () => {
    const rng = makeCountingRng(2026);
    let somme = 0;
    for (let i = 0; i < 1000; i++) {
      somme += breed(PUR, g('pur', { taille: 0.3 }), g('pur', { taille: 0.7 }), rng, 'f')
        .genes['taille']!;
    }
    expect(somme / 1000).toBeCloseTo(0.5, 1);
  });

  it('atténue un gène lié au sexe chez l autre sexe', () => {
    const lié: FamilyDescriptor = {
      ...PUR,
      genes: {
        taille: { group: 'structure', heritability: 1, dominance: 0.5, mutationRate: 0, sexLinked: 'm' },
      },
    };
    const parents = [g('pur', { taille: 1 }), g('pur', { taille: 1 })] as const;
    const garçon = breed(lié, parents[0], parents[1], makeCountingRng(8), 'm').genes['taille']!;
    const fille = breed(lié, parents[0], parents[1], makeCountingRng(8), 'f').genes['taille']!;
    expect(garçon).toBeCloseTo(1, 10);
    expect(fille).toBeLessThan(garçon);
    expect(fille).toBeGreaterThan(0.5);
  });

  it('refuse de croiser deux familles différentes', () => {
    expect(() => breed(HUMANOID, g('humanoid', {}), g('canid', {}), makeCountingRng(1), 'f'))
      .toThrow('familles différentes');
  });
});
