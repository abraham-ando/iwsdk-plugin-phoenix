import { describe, it, expect } from 'vitest';
import { HUMANOID, defaultGenome, genomeKey } from '@iwsdk/cardinal-character';
import { genomeFromComponents, needsRecompile } from '../src/systems/CharacterCompileSystem';

describe('genomeFromComponents', () => {
  const base = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, skinTone: 0.8 } };

  it('laisse les composants recouvrir le génome de départ', () => {
    const g = genomeFromComponents(HUMANOID, base, {
      structure: { stature: 0.7, shoulderWidth: 0.9 },
      face: { jawWidth: 0.2 },
    });
    expect(g.genes['stature']).toBe(0.7);
    expect(g.genes['jawWidth']).toBe(0.2);
  });

  it('garde du génome de départ les gènes qu aucun composant n expose', () => {
    // Les gènes de surface n ont pas de champ réglable : CharacterSurface porte
    // des COULEURS, qui sont la sortie de la rampe et non son entrée. Ils ne
    // peuvent donc venir que du génome posé à la création.
    const g = genomeFromComponents(HUMANOID, base, { structure: {}, face: {} });
    expect(g.genes['skinTone']).toBe(0.8);
  });

  it('rend un génome complet, un gène par gène de la famille', () => {
    const g = genomeFromComponents(HUMANOID, base, { structure: {}, face: {} });
    expect(Object.keys(g.genes).sort()).toEqual(Object.keys(HUMANOID.genes).sort());
  });
});

describe('needsRecompile', () => {
  const g = defaultGenome(HUMANOID);
  it('est vrai quand aucune clé n a encore été vue', () => {
    expect(needsRecompile(undefined, genomeKey(HUMANOID, g, 20))).toBe(true);
  });
  it('est faux pour un vieillissement d un jour', () => {
    const a = genomeKey(HUMANOID, g, 20);
    const b = genomeKey(HUMANOID, g, 20 + 1 / 365);
    expect(needsRecompile(a, b)).toBe(false);
  });
  it('est vrai pour un changement de gène', () => {
    const autre = { ...g, genes: { ...g.genes, stature: 0.9 } };
    expect(needsRecompile(genomeKey(HUMANOID, g, 20), genomeKey(HUMANOID, autre, 20))).toBe(true);
  });
});
