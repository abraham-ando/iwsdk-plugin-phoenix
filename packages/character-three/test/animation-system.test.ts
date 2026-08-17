import { describe, it, expect, vi } from 'vitest';
import { World, AnimationMixer, AnimationClip, VectorKeyframeTrack, QuaternionKeyframeTrack } from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import { installCharacterThree, createCharacter } from '../src/create';
import { CharacterAnimationSystem } from '../src/systems/CharacterAnimationSystem';
import { humanoidPuppet } from './fixtures/humanoidPuppet';

/** Un clip minimal qui fait voyager la hanche de deux mètres en Z. */
function travellingClip(name: string): AnimationClip {
  return new AnimationClip(name, 1, [
    new VectorKeyframeTrack('root.position', [0, 1], [0, 1, 0, 0, 1, 2]),
    new QuaternionKeyframeTrack('head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

function build() {
  const world = new World();
  installCharacterThree(world);
  const { root } = humanoidPuppet();
  const { entity } = createCharacter(world, {
    familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30, rigRoot: root,
  });
  const system = world.getSystem(CharacterAnimationSystem)!;
  return { world, entity, system };
}

describe('CharacterAnimationSystem', () => {
  it('est enregistré par installCharacterThree, après la compilation et l expression', () => {
    const world = new World();
    installCharacterThree(world);
    expect(world.getSystem(CharacterAnimationSystem)).toBeDefined();
  });

  it('assainit les clips à l attachement, avec la politique demandée', () => {
    const { entity, system } = build();
    system.attach(entity, { walk: travellingClip('walk') }, () => 'root', { rootMotion: 'flatten' });
    const track = system.clipFor(entity, 'walk')!.tracks.find((t) => t.name === 'root.position')!;
    // Le voyage de deux mètres en Z doit avoir disparu ; sans aplatissement,
    // l amplitude vaudrait 2.
    const z = [track.values[2]!, track.values[5]!];
    expect(Math.abs(z[1]! - z[0]!)).toBeLessThan(1e-6);
  });

  it('un verbe sans clip retombe sur idle plutôt que de lever', () => {
    const { entity, system } = build();
    system.attach(entity, { idle: travellingClip('idle') }, () => 'root', { rootMotion: 'flatten' });
    expect(() => system.setVerb(entity, 'sleep')).not.toThrow();
    expect(system.currentVerb(entity)).toBe('idle');
  });

  it('n alloue rien dans update sur un état stable', () => {
    const { world, entity, system } = build();
    system.attach(entity, { idle: travellingClip('idle') }, () => 'root', { rootMotion: 'flatten' });
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
    system.attach(entity, { idle: travellingClip('idle') }, () => 'root', { rootMotion: 'flatten' });
    expect(system.mixerCount()).toBe(1);
    entity.dispose();
    system.update(0.016, 16);
    expect(system.mixerCount()).toBe(0);
  });
});
