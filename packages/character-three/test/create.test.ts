import { describe, it, expect, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, World } from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import { assertBonesAreDescendants, createCharacter, installCharacterThree } from '../src/create';
import { CharacterCompileSystem } from '../src/systems/CharacterCompileSystem';
import { CharacterExpressionSystem } from '../src/systems/CharacterExpressionSystem';
import { CharacterIdentity, CharacterStructure, CharacterFace, CharacterSurface } from '../src/components/index';
import { PuppetApplicator } from '../src/apply/PuppetApplicator';
import { humanoidPuppet, humanoidSkinned } from './fixtures/humanoidPuppet';

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

  it('lève et nomme le remède quand le conteneur porte lui-même un rôle d os', () => {
    // `HUMANOID.bones.root` liste 'Armature' parmi ses alias — le nom que
    // Blender donne justement à l'ancêtre commun qu'on recommande de passer
    // comme conteneur. Ce rig est donc correctement FORMÉ, pas une erreur
    // d'appelant : le refuser a besoin d'un message qui dise quoi faire.
    const armature = new Object3D();
    armature.name = 'Armature';
    const bones = new Map([['root', armature]]);
    expect(() => assertBonesAreDescendants(armature, bones)).toThrow(/Group/);
    expect(() => assertBonesAreDescendants(armature, bones)).toThrow(/root/);
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
    const { root, body } = humanoidPuppet();
    const { entity, report } = createCharacter(world, {
      familyId: HUMANOID.id,
      genome: defaultGenome(HUMANOID),
      age: 34,
      rigRoot: root,
    });
    return { world, root, body, entity, report };
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

  it('compile à la première frame et applique un décalage au sol à l ancre', () => {
    const { world, root } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    const before = compiler.compiledCount;
    compiler.update();
    expect(compiler.compiledCount).toBe(before + 1);
    // Le sol de HUMANOID est `footL` : la compilation pose un décalage vertical
    // non nul sur l'ANCRE — c'est l'ancrage, distinct de la morphologie et
    // distinct du placement que l'application donne au nœud d'entité.
    const anchor = root.parent!;
    expect(anchor.name).toBe('CharacterGroundAnchor');
    expect(anchor.position.y).not.toBe(0);
  });

  it('laisse intact le placement de l entité, même après une recompilation', () => {
    // La régression que l'ancre supprime : l'applicateur écrit le décalage au
    // sol par AFFECTATION. Sans nœud intermédiaire, il tombait sur
    // `entity.object3D` — donc sur la hauteur de terrain ou le point
    // d'apparition que l'application venait de poser — à la première
    // compilation, puis à chacune des suivantes.
    const { world, root, entity } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    const node = entity.object3D!;
    // Les trois niveaux : nœud d'entité → ancre → rig de l'appelant.
    expect(root.parent!.parent).toBe(node);
    node.position.set(3, 12.5, -7);

    compiler.update();
    expect(node.position.y).toBe(12.5);

    // Un gène de STRUCTURE force une vraie recompilation, pas un simple
    // passage à vide de la porte.
    entity.setValue(CharacterStructure, 'stature', 0.9);
    compiler.update();
    expect([node.position.x, node.position.y, node.position.z]).toEqual([3, 12.5, -7]);
    // …et l'ancre, elle, porte bien le décalage.
    expect(root.parent!.position.y).not.toBe(0);
  });

  it('ne recompile pas une deuxième frame sans changement de génome', () => {
    const { world } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    compiler.update();
    const afterFirst = compiler.compiledCount;
    compiler.update();
    expect(compiler.compiledCount).toBe(afterFirst);
  });

  it('ne fait AUCUN travail sur une entité inchangée, cent images durant', () => {
    // Le §10 de la conception budgète « coût par frame nul pour la structure »
    // et `apps/demo/CLAUDE.md` dit « Treat per-frame allocation as a bug » /
    // « Never allocate in update() ». D'où la forme du code : la porte compare
    // les valeurs de gènes déjà appliquées, dans un génome-brouillon possédé
    // par le système, et ne construit une clé `genomeKey` — une chaîne
    // fraîche — que lorsque quelque chose a réellement bougé. Ce test compte
    // le travail ; l'absence d'allocation, elle, se lit dans le fait qu'aucun
    // objet neuf n'est nécessaire pour répondre « rien n'a changé ».
    const { world, entity } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    const applicator = compiler.applicators.get(entity.index)!;
    const rest = vi.spyOn(applicator, 'applyRestPose');
    const surface = vi.spyOn(applicator, 'applySurface');

    for (let i = 0; i < 100; i++) compiler.update();

    expect(compiler.compiledCount).toBe(1);
    expect(rest).toHaveBeenCalledTimes(1);
    expect(surface).toHaveBeenCalledTimes(1);
  });

  it('ne recompile pas pour un vieillissement d un jour', () => {
    // `genomeKey` quantifie l'âge à l'année ; la porte le quantifie de la même
    // façon, pour ne même pas calculer la clé dans ce cas.
    const { world, entity } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    compiler.update();
    entity.setValue(CharacterIdentity, 'age', 34 + 1 / 365);
    compiler.update();
    expect(compiler.compiledCount).toBe(1);

    entity.setValue(CharacterIdentity, 'age', 40);
    compiler.update();
    expect(compiler.compiledCount).toBe(2);
  });

  it('passe le MÊME enregistrement de morphs d une image à l autre', () => {
    // La seule façon d'observer l'absence d'allocation sans profileur :
    // l'objet passé à l'applicateur est possédé par le système et réécrit sur
    // place. S'il était reconstruit par image, ces deux références
    // diffèreraient — et quarante villageois alloueraient quarante objets par
    // image pour ne rien changer.
    const { world, entity } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    const expression = world.getSystem(CharacterExpressionSystem)!;
    const applicator = compiler.applicators.get(entity.index)!;
    const morphs = vi.spyOn(applicator, 'applyMorphs');

    expression.update();
    expression.update();

    expect(morphs).toHaveBeenCalledTimes(2);
    expect(morphs.mock.calls[1]![0]).toBe(morphs.mock.calls[0]![0]);
  });

  it('recompile sur un changement de STRUCTURE, jamais sur un changement de VISAGE seul', () => {
    // Le contrat central des deux étages : la priorité 60 (structure) et la
    // priorité 70 (visage) existent précisément pour séparer ce qui recompile
    // de ce qui ne recompile jamais. `genomeFromComponents` ne lit plus
    // `CharacterFace` du tout.
    const { world, entity } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    compiler.update();
    const afterFirst = compiler.compiledCount;

    entity.setValue(CharacterFace, 'jawWidth', 0.9);
    compiler.update();
    expect(compiler.compiledCount).toBe(afterFirst);

    entity.setValue(CharacterStructure, 'stature', 0.9);
    compiler.update();
    expect(compiler.compiledCount).toBe(afterFirst + 1);
  });

  it('applique la teinte de peau compilée sur le maillage nommé par la cible de surface', () => {
    const { world, body } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    const before = body.material.color.clone();
    compiler.update();
    // `Body` est un alias de `HUMANOID.surfaces.skinTone` : `applySurface`
    // doit l'avoir repeint depuis la rampe, plus le blanc de MeshBasicMaterial.
    expect(body.material.color.equals(before)).toBe(false);
  });

  it('écrit la teinte compilée dans CharacterSurface, lisible par getVectorView', () => {
    // `Types.Color` est un champ VECTEUR : `setValue` lève dessus en elics
    // 3.4.x, et la vue est le seul accès (conception §9). Le composant doit
    // porter exactement la couleur que le matériau porte — c'est la même
    // interpolation de rampe, appelée une seule fois dans le paquet.
    const { world, entity, body } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    compiler.update();

    const skin = entity.getVectorView(CharacterSurface, 'skin');
    expect(skin[0]).toBeCloseTo(body.material.color.r, 6);
    expect(skin[1]).toBeCloseTo(body.material.color.g, 6);
    expect(skin[2]).toBeCloseTo(body.material.color.b, 6);

    // Les cheveux aussi : la marionnette ne porte aucun maillage de cheveux,
    // donc rien ne les teinte — le composant les porte quand même, parce que
    // la couleur est une propriété du personnage, pas de son asset.
    const hair = entity.getVectorView(CharacterSurface, 'hair');
    expect([hair[0], hair[1], hair[2]]).not.toEqual([0.2, 0.13, 0.09]);
  });

  it('applique les morphs du visage via CharacterExpressionSystem sans lever', () => {
    const { world, entity } = build();
    const expression = world.getSystem(CharacterExpressionSystem)!;
    entity.setValue(CharacterFace, 'jawWidth', 0.9);
    expect(() => expression.update()).not.toThrow();
  });

  it('libère les entrées de l entité à sa destruction, sans laisser de résultat périmé pour un index recyclé', () => {
    const { world, entity: entityA } = build();
    const compiler = world.getSystem(CharacterCompileSystem)!;
    const indexA = entityA.index;
    compiler.update();
    expect(compiler.applicators.has(indexA)).toBe(true);

    const disposeSpy = vi.spyOn(compiler.applicators.get(indexA)!, 'dispose');
    entityA.destroy();
    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(compiler.applicators.has(indexA)).toBe(false);
    expect(compiler.bindings.has(indexA)).toBe(false);
    expect(compiler.genomes.has(indexA)).toBe(false);

    // elics recycle les index d'entité en pile (LIFO, voir EntityManager) :
    // le prochain créé récupère exactement le même index que A vient de
    // libérer. Même génome et même âge, donc même clé de compilation — sans
    // le nettoyage ci-dessus, `needsRecompile` verrait la clé laissée par A
    // et sauterait B en silence : B resterait non posé pour toujours.
    const { root: rootB } = humanoidPuppet();
    const { entity: entityB } = createCharacter(world, {
      familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 34, rigRoot: rootB,
    });
    expect(entityB.index).toBe(indexA);

    compiler.update();
    expect(rootB.parent!.position.y).not.toBe(0);
  });
});

describe('createCharacter — le rig refusé', () => {
  it('lève en nommant l os manquant et la famille, plutôt que rendre une entité vide', () => {
    // Le chemin le plus silencieux du paquet avant ce correctif : `binding`
    // nul rendait une entité sans composants, sans applicateur, sans un mot —
    // alors que le README le décrivait comme l'échec bruyant.
    const world = new World();
    installCharacterThree(world);
    const { root, bones } = humanoidPuppet();
    bones['spine']!.name = 'Colonne'; // plus aucun alias de `spine` ne matche

    expect(() =>
      createCharacter(world, {
        familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 34, rigRoot: root,
      }),
    ).toThrow(/spine/);
    expect(() =>
      createCharacter(world, {
        familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 34, rigRoot: root,
      }),
    ).toThrow(/humanoid/);
  });

  it('lève sur le motif glTF que le README décrit : maillage passé au lieu de l ancêtre commun', () => {
    // Armature FRÈRE du maillage. Passer le maillage comme rigRoot ne trouve
    // aucun os — c'est ce cas, et non le garde-fou de descendance, qui se
    // présente réellement, et il doit crier.
    const world = new World();
    installCharacterThree(world);
    const { root } = humanoidPuppet();
    const scene = new Object3D();
    const mesh = new Mesh(new BoxGeometry(0.4, 1.75, 0.3), new MeshBasicMaterial());
    mesh.name = 'Wolf3D_Body';
    scene.add(mesh);
    scene.add(root);

    // `/root/` ne discriminerait RIEN : le conseil final du message contient
    // déjà le mot « rigRoot ». C'est la LISTE des os manquants qui prouve que
    // le rejet a bien constaté l'absence, donc c'est elle qu'on interroge.
    let message = '';
    try {
      createCharacter(world, {
        familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 34, rigRoot: mesh,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`famille "${HUMANOID.id}"`);
    for (const role of Object.keys(HUMANOID.bones)) {
      expect(message).toContain(role);
    }
  });
});

/**
 * Le squelette compilé projette un gène `[0,1]` dans la plage de morph que la
 * famille déclare (`[-1,1]` pour tous les morphs de visage de HUMANOID) — la
 * même formule que `compile()`. Il faut un vrai `SkinnedMesh` porteur d'un
 * `morphTargetDictionary` pour l'observer : `PuppetApplicator.applyMorphs`
 * est un no-op délibéré, donc muet sur cette question.
 */
describe('CharacterExpressionSystem — projection de plage de morph', () => {
  const build = () => {
    const world = new World();
    installCharacterThree(world);
    const { root, mesh } = humanoidSkinned();
    const { entity } = createCharacter(world, {
      familyId: HUMANOID.id,
      genome: defaultGenome(HUMANOID),
      age: 34,
      rigRoot: root,
    });
    return { world, entity, mesh };
  };

  it('un gène à 0 atteint le maillage à -1, un gène à 1 l atteint à +1', () => {
    const { world, entity, mesh } = build();
    const expression = world.getSystem(CharacterExpressionSystem)!;
    const jawIndex = mesh.morphTargetDictionary!['jawWidth']!;

    entity.setValue(CharacterFace, 'jawWidth', 0);
    expression.update();
    expect(mesh.morphTargetInfluences![jawIndex]).toBeCloseTo(-1, 6);

    entity.setValue(CharacterFace, 'jawWidth', 1);
    expression.update();
    expect(mesh.morphTargetInfluences![jawIndex]).toBeCloseTo(1, 6);
  });
});
