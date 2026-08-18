import { describe, it, expect, vi } from 'vitest';
import { Object3D, Vector3, World } from '@iwsdk/core';
import { CharacterSelection, installCharacterThree } from '@iwsdk/cardinal-character-three';
import { CharacterPanelPlacementSystem, placePanel } from '../src/systems/CharacterPanelPlacementSystem';

function scene() {
  const panel = new Object3D();
  const cible = new Object3D();
  const camera = new Object3D();
  return { panel, cible, camera };
}

describe('le placement du panneau', () => {
  it('se pose à côté de la cible, pas dessus', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(3, 0, -2);
    camera.position.set(0, 1.6, 0);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.position.distanceTo(cible.position)).toBeCloseTo(0.8, 2);
  });

  it('se tourne vers la CAMÉRA, pas vers la cible', () => {
    // Le piège : `Follower` en FaceTarget oriente vers sa cible de suivi. Ici
    // la cible de position et la cible d orientation diffèrent.
    const { panel, cible, camera } = scene();
    cible.position.set(5, 0, 0);
    camera.position.set(0, 0, 10);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    const versCamera = new Vector3().subVectors(camera.position, panel.position).normalize();
    const avant = new Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    expect(avant.dot(versCamera)).toBeGreaterThan(0.99);
  });

  it('grandit avec la distance, pour garder la même taille apparente', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(0, 0, 0);
    camera.position.set(0, 0, 2);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    const proche = panel.scale.x;
    camera.position.set(0, 0, 12);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.scale.x).toBeGreaterThan(proche);
  });

  it('borne l échelle aux deux extrémités', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(0, 0, 0);
    camera.position.set(0, 0, 0.1);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.scale.x).toBeCloseTo(0.5, 5);
    camera.position.set(0, 0, 500);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.scale.x).toBeCloseTo(3, 5);
  });

  // Renommé : l'assertion d'origine (« deux appels ne créent aucun vecteur
  // neuf ») ne mesure aucune allocation — elle vérifie seulement que la
  // position a bougé. La vraie garantie « pas d'allocation par appel » tient
  // à la lecture du code ci-dessus (`_versCamera`, `_cote`, `_haut` sont des
  // propriétés de module, jamais de littéraux dans `placePanel`), pas à ce
  // test.
  //
  // Bug trouvé dans le brief : `scene()` place `cible` ET `camera` toutes
  // deux à l'origine par défaut. Avec cette position de départ, `distance`
  // vaut 0 et `placePanel` prend la sortie anticipée (`distance < 1e-4`) —
  // `panel.position` ne bouge alors JAMAIS, et le test tel qu'écrit dans le
  // brief échouerait, pas seulement à cause de son nom. Positionner `cible`
  // et `camera` explicitement corrige le test sans changer ce qu'il vérifie.
  it('deux appels successifs déplacent bien le panneau (la position suit la cible)', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(2, 0, 0);
    camera.position.set(0, 0, 5);
    const avant = panel.position.clone();
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.position.equals(avant)).toBe(false);
  });
});

describe("CharacterPanelPlacementSystem.update() n'alloue rien en régime stable", () => {
  // Même trouvaille de revue que `CharacterPickSystem` : `this.selection`
  // était rescanné via `entities.values().next().value` à chaque `update()`,
  // qui alloue un itérateur ET un objet résultat par appel (mesuré en Node :
  // `it1 !== it2`, `r1 !== r2`). Espionne `Set.prototype.values` et vérifie
  // qu'aucun `update()` en régime stable ne l'appelle.
  it("update() répété n'appelle jamais Set.prototype.values", () => {
    const world = new World();
    installCharacterThree(world);
    world.registerSystem(CharacterPanelPlacementSystem, { priority: 92 });
    const system = world.getSystem(CharacterPanelPlacementSystem)!;
    system.panel = new Object3D();

    const selectionEntity = world.createEntity();
    selectionEntity.addComponent(CharacterSelection, {});

    // Première frame : qualifie `this.selection` via l'abonnement `qualify`.
    // La cible reste `null` — sans intérêt ici, seul le rescan compte.
    system.update(0.016, 16);

    const valuesSpy = vi.spyOn(Set.prototype, 'values');
    system.update(0.016, 32);
    system.update(0.016, 48);
    system.update(0.016, 64);
    expect(valuesSpy).not.toHaveBeenCalled();
    valuesSpy.mockRestore();
  });
});
