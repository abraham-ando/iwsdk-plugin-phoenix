import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { HUMANOID, defaultGenome, genomeKey } from '@iwsdk/cardinal-character';
import { CharacterCompileSystem, genomeFromComponents, needsRecompile } from '../src/systems/CharacterCompileSystem';
import { CharacterExpressionSystem } from '../src/systems/CharacterExpressionSystem';
import { createCharacter, installCharacterThree } from '../src/create';
import { CharacterFace, CharacterStructure } from '../src/components/index';
import { humanoidPuppet, humanoidSkinned } from './fixtures/humanoidPuppet';

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

describe('createCharacter — le génome de structure atteint le compilateur', () => {
  it('deux génomes opposés donnent deux squelettes DIFFÉRENTS', () => {
    // Le test qui manquait : sans lui, `createCharacter` pouvait jeter le
    // génome de structure sans qu'aucune suite ne s'en aperçoive — et onze
    // villageois se retrouvaient avec le même corps à l'écran.
    const world = new World();
    installCharacterThree(world);
    const system = world.getSystem(CharacterCompileSystem)!;

    const measure = (value: number): { stature: number; knee: number } => {
      const genes: Record<string, number> = {};
      for (const key of Object.keys(HUMANOID.genes)) genes[key] = value;
      const { root, bones } = humanoidPuppet();
      const entity = createCharacter(world, {
        familyId: HUMANOID.id,
        genome: { family: HUMANOID.id, genes },
        age: 30,
        rigRoot: root,
      }).entity;
      system.update();
      return {
        stature: entity.getValue(CharacterStructure, 'stature') ?? Number.NaN,
        knee: bones['legL']?.position.y ?? Number.NaN,
      };
    };

    const petit = measure(0.05);
    const grand = measure(0.95);

    // Le composant porte le gène reçu, pas le défaut du schéma.
    expect(petit.stature).toBeCloseTo(0.05, 5);
    expect(grand.stature).toBeCloseTo(0.95, 5);
    // Et le squelette compilé s'en ressent : le genou n'est pas à la même
    // hauteur. C'est l'assertion qui compte — la première pourrait passer sur
    // un composant amorcé mais ignoré par le compilateur.
    expect(petit.knee).not.toBeCloseTo(grand.knee, 4);
  });
});

/**
 * Test jumeau du précédent, côté VISAGE — trouvaille de revue : amorcer
 * `CharacterStructure` sans amorcer `CharacterFace` laissait le test ci-dessus
 * vert alors que `CharacterExpressionSystem` (qui lit `entity.getValue(
 * CharacterFace, …)` directement, jamais le génome — voir son `update()`)
 * aurait appliqué le même morph 0.5 par défaut à deux personnages aux gènes de
 * visage opposés. Aucun test existant ne le couvrait : ceux qui touchent
 * `CharacterExpressionSystem` (`create.test.ts`) passent tous par
 * `entity.setValue(CharacterFace, …)` ou `defaultGenome`, ce qui contourne
 * entièrement le chemin `genesFor` pour ce composant.
 *
 * `humanoidSkinned()` (déjà réutilisée par `create.test.ts` pour ce même
 * système) est la seule fixture du paquet à porter un `morphTargetDictionary`
 * — `humanoidPuppet()` n'a qu'un `Mesh` simple, muet sur les morphs.
 */
describe('createCharacter — le génome de visage atteint CharacterExpressionSystem', () => {
  it('deux génomes de visage opposés donnent deux morphs RÉELLEMENT APPLIQUÉS DIFFÉRENTS', () => {
    const world = new World();
    installCharacterThree(world);
    const expression = world.getSystem(CharacterExpressionSystem)!;

    const measure = (value: number): { jawWidth: number; morph: number } => {
      const genes: Record<string, number> = {};
      for (const key of Object.keys(HUMANOID.genes)) genes[key] = value;
      const { root, mesh } = humanoidSkinned();
      const entity = createCharacter(world, {
        familyId: HUMANOID.id,
        genome: { family: HUMANOID.id, genes },
        age: 30,
        rigRoot: root,
      }).entity;
      expression.update();
      const jawIndex = mesh.morphTargetDictionary!['jawWidth']!;
      return {
        jawWidth: entity.getValue(CharacterFace, 'jawWidth') ?? Number.NaN,
        morph: mesh.morphTargetInfluences![jawIndex] ?? Number.NaN,
      };
    };

    const petit = measure(0.05);
    const grand = measure(0.95);

    // Le composant porte le gène reçu, pas le défaut du schéma.
    expect(petit.jawWidth).toBeCloseTo(0.05, 5);
    expect(grand.jawWidth).toBeCloseTo(0.95, 5);
    // Et le morph écrit sur le maillage par CharacterExpressionSystem s'en
    // ressent. C'est l'assertion qui compte — la première pourrait passer sur
    // un composant amorcé mais jamais lu par le système d'expression.
    expect(petit.morph).not.toBeCloseTo(grand.morph, 4);
  });
});
