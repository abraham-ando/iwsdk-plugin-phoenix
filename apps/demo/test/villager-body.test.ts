import { describe, it, expect, vi } from 'vitest';
import {
  AnimationClip, Group, Mesh, Quaternion, Vector3,
  VectorKeyframeTrack, QuaternionKeyframeTrack, World,
} from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import {
  CharacterAnimationSystem, createCharacter, installCharacterThree,
} from '@iwsdk/cardinal-character-three';
import {
  PuppetBody,
  makeRiggedBody,
  upgradeVillagers,
  assertSameWorldFrame,
  type VillagerBody,
} from '../src/simulation/VillagerBody';
import { createAgentAvatar } from '../src/simulation/AgentAvatarFactory';
// Le rig de test vit dans le paquet des personnages : c'est là qu'est
// l'invariant qu'il encode (les 19 rôles d'os de HUMANOID), et le dupliquer
// ici le laisserait diverger en silence. `'rpm'` reproduit le nommage des deux
// avatars T-pose réellement livrés — le seul qu'un `AnimationMixer` sache
// viser, voir `BoneNaming`.
//
// L'alias est déclaré dans `vitest.config.ts` : un `../../../packages/…`
// traversait une frontière de paquet et cassait au premier déplacement.
import { humanoidPuppet } from '@character-three/fixtures/humanoidPuppet';

function puppetMap(ids: string[]): Map<string, VillagerBody> {
  return new Map(ids.map((id) => [id, new PuppetBody(new Group(), id)]));
}

describe('le basculement des villageois', () => {
  it('un échec de remplacement LAISSE la marionnette montée', async () => {
    const bodies = puppetMap(['mira', 'haran']);
    const before = bodies.get('mira')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }, { id: 'haran', gender: 'masculine' }],
      // La fabrique échoue pour tout le monde : c'est le cas hors ligne.
      buildRig: async () => { throw new Error('Unknown renderable asset "avatar-mira"'); },
    });

    expect(bodies.get('mira')).toBe(before);
    expect(bodies.size).toBe(2);
    warn.mockRestore();
  });

  it('journalise UNE fois par villageois, avec son identifiant et la cause', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await upgradeVillagers({
      bodies: puppetMap(['mira']),
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async () => { throw new Error('os manquants : spine, neck'); },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]!.join(' '));
    expect(message).toContain('mira');
    expect(message).toContain('os manquants');
    warn.mockRestore();
  });

  it('ne lève jamais, même si TOUT échoue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      upgradeVillagers({
        bodies: puppetMap(['a', 'b', 'c']),
        agents: [{ id: 'a', gender: 'masculine' }, { id: 'b', gender: 'feminine' }, { id: 'c', gender: 'masculine' }],
        buildRig: async () => { throw new Error('boum'); },
      }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('remplace ET libère la marionnette quand la fabrique réussit', async () => {
    const bodies = puppetMap(['mira']);
    const puppet = bodies.get('mira')!;
    const disposed = vi.spyOn(puppet, 'dispose');
    const rig: VillagerBody = { node: new Group(), setPose: () => {}, dispose: () => {} };

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async () => rig,
    });

    expect(bodies.get('mira')).toBe(rig);
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('la marionnette applique encore sa pose procédurale', () => {
    const node = new Group();
    const body = new PuppetBody(node, 'mira');
    body.setPose('rest', 0);
    // `applyAvatarPose` écrase l échelle Y à 0,7 pour le repos.
    expect(node.scale.y).toBeCloseTo(0.7, 5);
  });

  // I3 (revue) : un `dispose()` glissé dans la branche d'échec passerait les
  // cinq tests ci-dessus — la carte garde la même RÉFÉRENCE d'objet (dispose
  // ne remplace rien dans `bodies`), donc « LAISSE la marionnette montée » ne
  // le voit pas. Ce test regarde la SCÈNE, pas la carte.
  it("un échec de remplacement garde le nœud de la marionnette DANS la scène", async () => {
    const parent = new Group();
    const node = new Group();
    parent.add(node);
    expect(node.parent).toBe(parent); // sanity : montage réel avant l'appel

    const bodies = new Map<string, VillagerBody>([['mira', new PuppetBody(node, 'mira')]]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async () => { throw new Error('Unknown renderable asset "avatar-mira"'); },
    });

    // `PuppetBody.dispose()` appelle `removeFromParent()` : si `upgradeVillagers`
    // l'invoquait par erreur dans le `catch`, `node.parent` serait `null` ici.
    expect(node.parent).toBe(parent);
    warn.mockRestore();
  });
});

// I1 (revue) : `PuppetBody.dispose()` ne faisait que détacher le nœud —
// `createAgentAvatar` alloue trois géométries et trois matériaux NEUFS par
// villageois (jamais partagés), abandonnés au GPU à chaque remplacement.
describe('PuppetBody.dispose() et les ressources GPU', () => {
  it('dispose() appelle réellement .dispose() sur chaque géométrie et matériau du nœud', () => {
    const avatar = createAgentAvatar('Test', 0x3b82f6, 'feminine');
    const meshes: Mesh[] = [];
    avatar.traverse((child) => {
      if (child instanceof Mesh) meshes.push(child);
    });
    // Sanity : le montage réel produit bien des Mesh à surveiller, sinon le
    // reste de ce test ne prouverait rien.
    expect(meshes.length).toBeGreaterThan(0);

    const geometrySpies = meshes.map((m) => vi.spyOn(m.geometry, 'dispose'));
    const materialSpies = meshes.flatMap((m) =>
      (Array.isArray(m.material) ? m.material : [m.material]).map((mat) =>
        vi.spyOn(mat, 'dispose'),
      ),
    );

    new PuppetBody(avatar, 'test').dispose();

    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of materialSpies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dispose() détache aussi le nœud (comportement d'avant, conservé)", () => {
    const parent = new Group();
    const avatar = createAgentAvatar('Test', 0x3b82f6, 'masculine');
    parent.add(avatar);

    new PuppetBody(avatar, 'test').dispose();

    expect(avatar.parent).toBeNull();
  });
});

// I2 (revue) : le rig n'atterrit pas forcément sous le même parent que la
// marionnette qu'il remplace — les deux coïncident aujourd'hui uniquement
// parce que la racine de niveau et la racine de scène du village sont toutes
// deux à l'identité. `assertSameWorldFrame` transforme cette coïncidence
// tacite en échec bruyant si l'une des deux bouge.
// I1 / I3 (revue finale) : `makeRiggedBody` est la SEULE soudure entre la démo
// et `@iwsdk/cardinal-character-three`, et rien ne la traversait.
describe('makeRiggedBody, de bout en bout', () => {
  const HEAD_TURN = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

  /** Un clip qui fait voyager la hanche de deux mètres et tourner la tête. */
  function walkClip(): AnimationClip {
    return new AnimationClip('walk', 1, [
      new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0.95, 0, 0, 0.95, 2]),
      new QuaternionKeyframeTrack(
        'Head.quaternion',
        [0, 1],
        [0, 0, 0, 1, HEAD_TURN.x, HEAD_TURN.y, HEAD_TURN.z, HEAD_TURN.w],
      ),
    ]);
  }

  /**
   * Un clip qui déplace RÉELLEMENT un os non racine : `sanitizeClip` rend le
   * verdict `conflict` et lève. C'est la deuxième des trois portes d'échec de
   * `makeRiggedBody`, et la plus réaliste des trois.
   */
  function conflictingClip(): AnimationClip {
    return new AnimationClip('walk', 1, [
      new VectorKeyframeTrack('Spine.position', [0, 1], [0, 0.12, 0, 0, 0.9, 0]),
    ]);
  }

  function makeCharacter() {
    const world = new World();
    installCharacterThree(world);
    const { root, bones } = humanoidPuppet('rpm');
    const { entity } = createCharacter(world, {
      familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30, rigRoot: root,
    });
    return { world, entity, bones };
  }

  it('attache les clips, et setPose fait BOUGER un os du rig', () => {
    const { world, entity, bones } = makeCharacter();
    const head = bones.head!;
    const hips = bones.root!;
    const before = head.quaternion.clone();

    const body = makeRiggedBody(world, entity, { idle: walkClip(), walk: walkClip() }, new PuppetBody(new Group(), 'mira'));
    expect(body.node).toBe(entity.object3D);

    body.setPose('walk', 0);
    world.getSystem(CharacterAnimationSystem)!.update(0.5, 500);

    // À mi-clip : la moitié du quart de tour. Un mixer branché ailleurs que
    // sur le rig laisse cet angle à zéro.
    expect(before.angleTo(head.quaternion)).toBeCloseTo(Math.PI / 4, 3);
    // `rootMotion: 'flatten'` : la simulation possède la position, le clip ne
    // doit emporter le villageois nulle part.
    expect(hips.position.z).toBeCloseTo(0, 6);
  });

  it("une levée après création ne laisse AUCUN nœud orphelin dans la scène", () => {
    const { world, entity } = makeCharacter();
    // En production, `createTransformEntity` a déjà parenté le nœud sous
    // `activeLevel` au retour de `createCharacter` ; un `new World()` de Node
    // n'a ni niveau actif ni entité de scène, donc on monte le nœud à la main
    // pour reproduire la situation que la trouvaille décrit.
    const levelRoot = new Group();
    const node = entity.object3D!;
    levelRoot.add(node);
    expect(levelRoot.children).toContain(node);

    expect(() =>
      makeRiggedBody(world, entity, { idle: conflictingClip() }, new PuppetBody(new Group(), 'mira')),
    ).toThrow(/déplace réellement/);

    // Sans le `dispose()` du chemin d'échec, ce rig resterait monté, compilé
    // et animé à chaque image, à l'origine du monde, et absent de `bodies`.
    expect(node.parent).toBeNull();
    expect(levelRoot.children).toHaveLength(0);
    expect(entity.object3D).toBeUndefined();
  });

  it("une levée APRÈS l'attachement ne laisse pas de mixer vivant", () => {
    // La porte importe. Une levée de `sanitizeClip` part de l'INTÉRIEUR
    // d'`attach`, avant que le rig ne soit enregistré : `mixerCount()` y vaut
    // zéro quoi que fasse le `catch`, et l'assertion ne prouverait rien.
    // `assertSameWorldFrame` est la seule porte qui lève APRÈS un attachement
    // réussi — donc la seule qui puisse laisser un mixer orphelin derrière
    // elle, et la seule qui rende ce test capable de tomber.
    const { world, entity } = makeCharacter();
    const system = world.getSystem(CharacterAnimationSystem)!;

    // Un parent de marionnette déplacé : les deux repères divergent.
    const decale = new Group();
    decale.position.set(1, 0, 0);
    const puppetNode = new Group();
    decale.add(puppetNode);

    expect(() =>
      makeRiggedBody(world, entity, { idle: walkClip() }, new PuppetBody(puppetNode, 'mira')),
    ).toThrow(/même repère monde/);

    // Le rig ÉTAIT enregistré au moment de la levée : si le `catch` ne
    // disposait pas l'entité, son `disqualify` ne tomberait pas et le mixer
    // tournerait pour toujours.
    expect(system.mixerCount()).toBe(0);
    expect(entity.object3D).toBeUndefined();
  });

  it("le repli reste possible : upgradeVillagers absorbe la levée et garde la marionnette", async () => {
    const { world, entity } = makeCharacter();
    const puppet = new PuppetBody(new Group(), 'mira');
    const bodies = new Map<string, VillagerBody>([['mira', puppet]]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async (_agent, current) =>
        makeRiggedBody(world, entity, { idle: conflictingClip() }, current),
    });

    expect(bodies.get('mira')).toBe(puppet);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('assertSameWorldFrame (repère du rig vs. repère de la marionnette)', () => {
  it("ne lève pas quand les deux parents remontent à l'identité jusqu'à la scène", () => {
    const scene = new Group();
    const levelRoot = new Group();
    const villageRoot = new Group();
    scene.add(levelRoot, villageRoot);

    expect(() => assertSameWorldFrame(villageRoot, levelRoot, scene)).not.toThrow();
  });

  it("lève quand une des deux racines a bougé", () => {
    const scene = new Group();
    const levelRoot = new Group();
    const villageRoot = new Group();
    // Quelqu'un a déplacé la racine du village hors de l'identité.
    villageRoot.position.set(2, 0, 0);
    scene.add(levelRoot, villageRoot);

    expect(() => assertSameWorldFrame(villageRoot, levelRoot, scene)).toThrow(/repère monde/);
  });

  it("lève quand une des deux racines a tourné (position à l'identité, orientation non)", () => {
    const scene = new Group();
    const levelRoot = new Group();
    const villageRoot = new Group();
    villageRoot.rotation.y = Math.PI / 4;
    scene.add(levelRoot, villageRoot);

    expect(() => assertSameWorldFrame(villageRoot, levelRoot, scene)).toThrow(/repère monde/);
  });
});
