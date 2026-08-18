import { describe, it, expect, vi } from 'vitest';
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
    // Le villageois RELÂCHE avant l appui sur le caillou. Sans cette ligne il
    // restait `Pressed` pendant tout le test : l assertion était alors
    // satisfaite par une implémentation qui re-sélectionne la même entité à
    // chaque frame, et ne prouvait rien de la stabilité de la cible.
    a.removeComponent(Pressed);
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

describe("CharacterPickSystem.update() n'alloue rien en régime stable", () => {
  // Trouvaille de revue : `entities.values().next().value` alloue un
  // itérateur ET un objet résultat À CHAQUE APPEL (mesuré en Node :
  // `it1 !== it2`, `r1 !== r2`). Ce test espionne `Set.prototype.values` et
  // vérifie qu'aucun `update()` en régime stable ne l'appelle — ni pour la
  // cible de sélection (mémorisée par abonnement), ni pour la query des
  // personnages pressés (`Set.prototype.forEach` avec un callback hissé
  // n'appelle jamais `.values()`, vérifié séparément en Node).
  it("update() répété n'appelle jamais Set.prototype.values", () => {
    const { system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    // Première frame : qualifie la cible via l'abonnement `qualify` et
    // écrit la sélection. On espionne SEULEMENT à partir d'ici, en régime
    // stable — la question posée est « rescanner coûte-t-il », pas
    // « qualifier coûte-t-il ».
    system.update(0.016, 16);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(a);

    const valuesSpy = vi.spyOn(Set.prototype, 'values');
    system.update(0.016, 32);
    system.update(0.016, 48);
    system.update(0.016, 64);
    expect(valuesSpy).not.toHaveBeenCalled();
    valuesSpy.mockRestore();
  });
});
