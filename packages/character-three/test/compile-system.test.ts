import { describe, it, expect } from 'vitest';
import { HUMANOID, defaultGenome, genomeKey } from '@iwsdk/cardinal-character';
import { genomeFromComponents, needsRecompile } from '../src/systems/CharacterCompileSystem';

describe('genomeFromComponents', () => {
  const base = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, skinTone: 0.8 } };

  it('laisse la structure recouvrir le génome de départ', () => {
    const g = genomeFromComponents(HUMANOID, base, {
      structure: { stature: 0.7, shoulderWidth: 0.9 },
    });
    expect(g.genes['stature']).toBe(0.7);
    expect(g.genes['shoulderWidth']).toBe(0.9);
  });

  it('garde du génome de départ tout ce que la structure n expose pas — visage COMPRIS', () => {
    // Le visage n'entre JAMAIS dans `genomeFromComponents` : c'est le cœur de
    // l'architecture à deux étages. `CharacterExpressionSystem` applique les
    // morphs directement depuis `CharacterFace`, à chaque image, sans jamais
    // recompiler. Les faire entrer ici ferait recompiler le squelette entier
    // à chaque cran de curseur de mâchoire.
    const g = genomeFromComponents(HUMANOID, base, { structure: {} });
    expect(g.genes['skinTone']).toBe(0.8);
    // jawWidth n'a jamais été recouvert : il vaut toujours le défaut de
    // `defaultGenome`, 0.5 — jamais lu depuis un composant `CharacterFace`.
    expect(g.genes['jawWidth']).toBe(0.5);
  });

  it('rend un génome complet, un gène par gène de la famille', () => {
    const g = genomeFromComponents(HUMANOID, base, { structure: {} });
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
