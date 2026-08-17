import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { createGenome, defaultGenome } from '../src/genome/create';
import { CompileCache, genomeKey } from '../src/compile/memo';
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

describe('genomeKey', () => {
  it('donne la même clé à deux génomes égaux', () => {
    expect(genomeKey(HUMANOID, defaultGenome(HUMANOID), 20))
      .toBe(genomeKey(HUMANOID, defaultGenome(HUMANOID), 20));
  });

  it('quantifie l âge : vingt ans et vingt ans et demi partagent une clé', () => {
    expect(genomeKey(HUMANOID, defaultGenome(HUMANOID), 20))
      .toBe(genomeKey(HUMANOID, defaultGenome(HUMANOID), 20.4));
  });

  it('sépare deux âges qui changent réellement les proportions', () => {
    expect(genomeKey(HUMANOID, defaultGenome(HUMANOID), 2))
      .not.toBe(genomeKey(HUMANOID, defaultGenome(HUMANOID), 9));
  });
});

describe('CompileCache', () => {
  it('ne compile qu une fois deux jumeaux', () => {
    const cache = new CompileCache();
    const rig = binding();
    const g = defaultGenome(HUMANOID);
    const a = cache.get(HUMANOID, g, 30, rig);
    const b = cache.get(HUMANOID, g, 30, rig);
    expect(b).toBe(a);
    expect(cache.size).toBe(1);
    expect(cache.hits).toBe(1);
  });

  it('évince les plus anciennes au-delà de sa capacité', () => {
    const cache = new CompileCache(4);
    const rig = binding();
    const rng = makeCountingRng(1);
    for (let i = 0; i < 20; i++) cache.get(HUMANOID, createGenome(HUMANOID, rng), 30, rig);
    expect(cache.size).toBeLessThanOrEqual(4);
  });
});

describe('budget', () => {
  it('compile un personnage en moins de deux millisecondes', () => {
    const rig = binding();
    const rng = makeCountingRng(77);
    const génomes = Array.from({ length: 100 }, () => createGenome(HUMANOID, rng));
    // Rodage : la première compilation paie la mise en route du JIT. On mesure
    // `compile` directement et non le cache, dont le rôle est justement
    // d'éviter cette dépense.
    for (const g of génomes) compile(HUMANOID, g, 30, rig);

    const durées: number[] = [];
    for (const g of génomes) {
      const t0 = performance.now();
      compile(HUMANOID, g, 30, rig);
      durées.push(performance.now() - t0);
    }
    durées.sort((a, b) => a - b);
    // Médiane et non maximum : une machine de CI partagée produit des pics que
    // l on ne veut pas transformer en test instable.
    expect(durées[Math.floor(durées.length / 2)]!).toBeLessThan(2);
  });
});
