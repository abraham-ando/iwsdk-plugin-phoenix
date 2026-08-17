import { describe, it, expect } from 'vitest';
import { Object3D, World } from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import { assertBonesAreDescendants, createCharacter, installCharacterThree } from '../src/create';
import { CharacterCompileSystem } from '../src/systems/CharacterCompileSystem';
import { CharacterExpressionSystem } from '../src/systems/CharacterExpressionSystem';
import { CharacterIdentity, CharacterStructure, CharacterFace, CharacterSurface } from '../src/components/index';
import { PuppetApplicator } from '../src/apply/PuppetApplicator';
import { humanoidPuppet } from './fixtures/humanoidPuppet';

/**
 * `assertBonesAreDescendants` est le garde-fou décrit par la revue de tâche :
 * `rigRoot` doit être un ANCÊTRE des os, sans quoi le décalage au sol que
 * l'applicateur écrit sur le conteneur ne bouge jamais la peau — en silence.
 * Ni `RigBinding` ni `ImportReport` ne portent de référence de scène, donc
 * c'est ici, contre le graphe `Object3D` réel, que l'invariant se vérifie.
 */
describe('assertBonesAreDescendants', () => {
  it('ne lève rien quand chaque os pend sous rigRoot', () => {
    const rigRoot = new Object3D();
    rigRoot.name = 'Character';
    const hip = new Object3D();
    hip.name = 'Hips';
    rigRoot.add(hip);
    const knee = new Object3D();
    knee.name = 'LeftLeg';
    hip.add(knee);

    const bones = new Map([['root', hip], ['legL', knee]]);
    expect(() => assertBonesAreDescendants(rigRoot, bones)).not.toThrow();
  });

  it('lève et nomme l os fautif quand l armature est FRÈRE du conteneur, pas son enfant', () => {
    // Motif glTF courant : la scène parente porte le SkinnedMesh et
    // l'Armature comme deux enfants côte à côte. Passer le maillage comme
    // rigRoot ne déplacerait alors jamais les os.
    const scene = new Object3D();
    const mesh = new Object3D();
    mesh.name = 'SkinnedMesh';
    const armature = new Object3D();
    armature.name = 'Armature';
    const hip = new Object3D();
    hip.name = 'Hips';
    armature.add(hip);
    scene.add(mesh);
    scene.add(armature);

    const bones = new Map([['root', hip]]);
    expect(() => assertBonesAreDescendants(mesh, bones)).toThrow(/Hips/);
    expect(() => assertBonesAreDescendants(mesh, bones)).toThrow(/root/);
  });
});

/**
 * `new World()` s'instancie sans DOM ni renderer (constructeur `elics` pur) :
 * `createTransformEntity` retombe sur un parent `undefined` en l'absence de
 * niveau actif, ce qui suffit pour ce pont. Le reste de la suite s'appuie
 * donc sur un vrai `World`, pas sur des doublures.
 */
describe('createCharacter — pont complet, marionnette', () => {
  const build = () => {
    const world = new World();
    installCharacterThree(world);
    const { root } = humanoidPuppet();
    const { entity, report } = createCharacter(world, {
      familyId: HUMANOID.id,
      genome: defaultGenome(HUMANOID),
      age: 34,
      rigRoot: root,
    });
    return { world, root, entity, report };
  };

  it('accepte le rig et pose les quatre composants sur l entité', () => {
    const { entity, report } = build();
    expect(report.accepted).toBe(true);
    expect(entity.hasComponent(CharacterIdentity)).toBe(true);
    expect(entity.hasComponent(CharacterStructure)).toBe(true);
    expect(entity.hasComponent(CharacterFace)).toBe(true);
    expect(entity.hasComponent(CharacterSurface)).toBe(true);
    expect(entity.getValue(CharacterIdentity, 'age')).toBe(34);
  });

  it('choisit l applicateur marionnette : aucun SkinnedMesh dans le rig', () => {
    const { world, entity } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    expect(compiler.applicators.get(entity.index)).toBeInstanceOf(PuppetApplicator);
    expect(compiler.bindings.get(entity.index)).toBeDefined();
    expect(compiler.genomes.get(entity.index)).toBeDefined();
  });

  it('compile à la première frame et applique un décalage au sol au conteneur', () => {
    const { world, root } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    const before = compiler.compiledCount;
    compiler.update();
    expect(compiler.compiledCount).toBe(before + 1);
    // Le sol de HUMANOID est `footL` : la compilation pose un décalage vertical
    // non nul sur le conteneur — c'est l'ancrage, distinct de la morphologie.
    expect(root.position.y).not.toBe(0);
  });

  it('ne recompile pas une deuxième frame sans changement de génome', () => {
    const { world } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    compiler.update();
    const afterFirst = compiler.compiledCount;
    compiler.update();
    expect(compiler.compiledCount).toBe(afterFirst);
  });

  it('applique les morphs du visage via CharacterExpressionSystem sans lever', () => {
    const { world, entity } = build();
    const expression = world.getSystem(CharacterExpressionSystem)!;
    entity.setValue(CharacterFace, 'jawWidth', 0.9);
    expect(() => expression.update()).not.toThrow();
  });
});
