import { describe, it, expect, vi } from 'vitest';
import {
  World, AnimationMixer, AnimationClip, Quaternion, Vector3,
  VectorKeyframeTrack, QuaternionKeyframeTrack,
} from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import { installCharacterThree, createCharacter } from '../src/create';
import { CharacterAnimationSystem } from '../src/systems/CharacterAnimationSystem';
import { humanoidPuppet } from './fixtures/humanoidPuppet';

/**
 * Le quart de tour que la tête décrit dans les clips ci-dessous. Une piste de
 * quaternion CONSTANTE — ce que ce fichier employait avant — laisse l'os
 * immobile même quand le mixer est parfaitement lié : elle ne peut donc rien
 * prouver.
 */
const HEAD_TURN = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

/**
 * Un clip minimal qui fait voyager la hanche de deux mètres en Z et tourner la
 * tête d'un quart de tour.
 *
 * Les pistes visent `Hips` et `Head` — les noms que porte RÉELLEMENT la
 * fixture `'rpm'`, et ceux des deux avatars T-pose livrés. Elles visaient
 * auparavant `root` et `head`, qui n'existent nulle part : `PropertyBinding`
 * ne trouvait aucun nœud, three.js émettait un `console.error` que personne
 * n'assérait, et le mixer n'écrivait jamais nulle part. Remplacer
 * `new AnimationMixer(node)` par `new AnimationMixer(new Group())` laissait
 * alors les 89 tests du paquet verts.
 */
function travellingClip(name: string): AnimationClip {
  return new AnimationClip(name, 1, [
    new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0.95, 0, 0, 0.95, 2]),
    new QuaternionKeyframeTrack(
      'Head.quaternion',
      [0, 1],
      [0, 0, 0, 1, HEAD_TURN.x, HEAD_TURN.y, HEAD_TURN.z, HEAD_TURN.w],
    ),
  ]);
}

/** `roleOfNode` d'un rig RPM : seule la hanche porte un rôle utile ici. */
const roleOfNode = (name: string): string | null => (name === 'Hips' ? 'root' : null);

function build() {
  const world = new World();
  installCharacterThree(world);
  // `'rpm'` et non le défaut `'mixamo'` : `PropertyBinding` lit `:` comme un
  // séparateur de répertoire, donc AUCUNE piste ne peut viser un os nommé
  // `mixamorig:Head`. Voir `BoneNaming` dans la fixture.
  const { root, bones } = humanoidPuppet('rpm');
  const { entity } = createCharacter(world, {
    familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30, rigRoot: root,
  });
  const system = world.getSystem(CharacterAnimationSystem)!;
  return { world, entity, system, bones };
}

describe('CharacterAnimationSystem', () => {
  it('est enregistré par installCharacterThree, après la compilation et l expression', () => {
    const world = new World();
    installCharacterThree(world);
    expect(world.getSystem(CharacterAnimationSystem)).toBeDefined();
  });

  // LE test que ce fichier n'avait pas : la preuve que le mixer est branché sur
  // le rig du personnage. Sans lui, tout le reste — assainissement, fondu,
  // absence d'allocation, libération — décrit un mixer qui n'écrit nulle part.
  it('lie réellement le mixer au rig : après setVerb et update, un os a BOUGÉ', () => {
    const { entity, system, bones } = build();
    const head = bones.head!;
    const hips = bones.root!;
    const headBefore = head.quaternion.clone();

    system.attach(entity, { walk: travellingClip('walk') }, roleOfNode, { rootMotion: 'flatten' });
    system.setVerb(entity, 'walk');
    system.update(0.5, 500);

    // À mi-clip, la tête a parcouru la moitié du quart de tour. Un mixer
    // construit sur un nœud étranger (ou des pistes qui ne visent aucun nœud)
    // laisse cet angle à zéro.
    expect(headBefore.angleTo(head.quaternion)).toBeGreaterThan(0.1);
    expect(headBefore.angleTo(head.quaternion)).toBeCloseTo(Math.PI / 4, 3);

    // Et la hanche, elle, n'a PAS voyagé : `flatten` a retiré le déplacement
    // net des deux mètres. La preuve que le mixer écrit bien la piste de
    // position aussi, c'est que Y vaut désormais la valeur du clip (0,95),
    // écrite en float32.
    expect(hips.position.z).toBeCloseTo(0, 6);
    expect(hips.position.y).toBeCloseTo(0.95, 5);
  });

  it('assainit les clips à l attachement, avec la politique demandée', () => {
    const { entity, system } = build();
    system.attach(entity, { walk: travellingClip('walk') }, roleOfNode, { rootMotion: 'flatten' });
    const track = system.clipFor(entity, 'walk')!.tracks.find((t) => t.name === 'Hips.position')!;
    // Le voyage de deux mètres en Z doit avoir disparu ; sans aplatissement,
    // le déplacement net vaudrait 2.
    const z = [track.values[2]!, track.values[5]!];
    expect(Math.abs(z[1]! - z[0]!)).toBeLessThan(1e-6);
  });

  it('un verbe sans clip retombe sur idle plutôt que de lever', () => {
    const { entity, system } = build();
    system.attach(entity, { idle: travellingClip('idle') }, roleOfNode, { rootMotion: 'flatten' });
    expect(() => system.setVerb(entity, 'sleep')).not.toThrow();
    expect(system.currentVerb(entity)).toBe('idle');
  });

  it('n alloue rien dans update sur un état stable', () => {
    const { world, entity, system } = build();
    system.attach(entity, { idle: travellingClip('idle') }, roleOfNode, { rootMotion: 'flatten' });
    system.setVerb(entity, 'idle');

    // `actionCount` seul ne discrimine pas une implémentation qui rappellerait
    // `clipAction` à chaque image : pour un couple (clip, racine) déjà vu,
    // `AnimationMixer.clipAction` de three.js rend l'action mise en cache SANS
    // en créer une seconde, donc la taille de la map resterait à 1 même avec un
    // appel par frame. On espionne directement `clipAction` pour vérifier que
    // `update()` ne le touche PAS : c'est la preuve que demande le commentaire
    // du système lui-même (« un `clipAction` par frame serait une allocation »).
    const clipActionSpy = vi.spyOn(AnimationMixer.prototype, 'clipAction');
    const callsBeforeLoop = clipActionSpy.mock.calls.length;

    // Deux cents frames ne doivent pas faire croître le nombre d actions du
    // mixer : un `clipAction` par frame serait une allocation par frame.
    for (let i = 0; i < 200; i++) system.update(0.016, i * 16);
    expect(system.actionCount(entity)).toBe(1);
    // La preuve forte : aucun appel supplémentaire à `clipAction` pendant les
    // deux cents images, alors qu'un `actionCount` inchangé seul ne l'aurait
    // pas exclu.
    expect(clipActionSpy.mock.calls.length).toBe(callsBeforeLoop);

    clipActionSpy.mockRestore();
    void world;
  });

  it('libère le mixer quand l entité disparaît', () => {
    const { entity, system } = build();
    system.attach(entity, { idle: travellingClip('idle') }, roleOfNode, { rootMotion: 'flatten' });
    expect(system.mixerCount()).toBe(1);
    entity.dispose();
    // `disqualify` tombe pendant `dispose()`, donc la carte est déjà vide ici :
    // il n'y a plus de fenêtre d'une image pendant laquelle le mixer d'une
    // entité morte tourne encore.
    expect(system.mixerCount()).toBe(0);
    system.update(0.016, 16);
    expect(system.mixerCount()).toBe(0);
  });

  // I2 (revue finale) : elics ne recycle pas seulement les index d'entité, il
  // recycle les INSTANCES. Une carte clavée par l'objet `Entity` — ce qu'était
  // `rigs` — rendait donc à l'entité suivante le rig de la précédente.
  it('une entité recyclée n hérite pas du rig de sa devancière', () => {
    const world = new World();
    installCharacterThree(world);
    const system = world.getSystem(CharacterAnimationSystem)!;

    const first = createCharacter(world, {
      familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30,
      rigRoot: humanoidPuppet('rpm').root,
    }).entity;
    system.attach(first, { walk: travellingClip('walk') }, roleOfNode, { rootMotion: 'flatten' });
    system.setVerb(first, 'walk');
    expect(system.currentVerb(first)).toBe('walk');

    first.dispose();
    const second = createCharacter(world, {
      familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30,
      rigRoot: humanoidPuppet('rpm').root,
    }).entity;

    // La garde du test : sans recyclage effectif, il ne prouverait rien.
    // Mesuré sur elics 3.4.2 — l'exemplaire lui-même revient du pool.
    expect(second.index).toBe(first.index);
    expect(second as unknown).toBe(first as unknown);

    // Le nouveau venu n'a aucun clip attaché : il ne joue rien, et surtout pas
    // le `walk` de son prédécesseur.
    expect(system.currentVerb(second)).toBe('');
    expect(system.mixerCount()).toBe(0);
  });
});
