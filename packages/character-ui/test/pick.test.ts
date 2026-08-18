import { describe, it, expect } from 'vitest';
import { World, Object3D, Pressed } from '@iwsdk/core';
import {
  CharacterIdentity, CharacterSelection, installCharacterThree,
} from '@iwsdk/cardinal-character-three';
import { CharacterPickSystem } from '../src/systems/CharacterPickSystem';

function build() {
  const world = new World();
  installCharacterThree(world);
  world.registerComponent(CharacterSelection);
  world.registerSystem(CharacterPickSystem, { priority: 90 });
  const system = world.getSystem(CharacterPickSystem)!;
  const selection = world.createEntity();
  selection.addComponent(CharacterSelection, {});
  const villageois = (): ReturnType<World['createTransformEntity']> => {
    const e = world.createTransformEntity(new Object3D());
    e.addComponent(CharacterIdentity, { family: 'humanoid', age: 30 });
    return e;
  };
  return { world, system, selection, villageois };
}

describe('la sélection au rayon', () => {
  it('un appui sur un villageois écrit la cible', () => {
    const { system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    system.update(0.016, 16);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(a);
  });

  it('viser un autre villageois REMPLACE la cible', () => {
    // Sans ce garde, une implémentation qui n écrirait que si la cible est
    // nulle passerait le test précédent et figerait la sélection à jamais.
    const { system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    system.update(0.016, 16);
    a.removeComponent(Pressed);
    const b = villageois();
    b.addComponent(Pressed, {});
    system.update(0.016, 32);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(b);
  });

  it('un appui sur autre chose qu un personnage ne change rien', () => {
    const { world, system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    system.update(0.016, 16);
    const caillou = world.createTransformEntity(new Object3D());
    caillou.addComponent(Pressed, {});
    system.update(0.016, 32);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(a);
  });

  it('sans appui, la cible ne bouge pas', () => {
    const { system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    system.update(0.016, 16);
    a.removeComponent(Pressed);
    system.update(0.016, 32);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(a);
  });
});
