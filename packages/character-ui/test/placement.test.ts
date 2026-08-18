import { describe, it, expect, vi } from 'vitest';
import { Object3D, Vector3, World } from '@iwsdk/core';
import { CharacterSelection, installCharacterThree } from '@iwsdk/cardinal-character-three';
import { CharacterPanelPlacementSystem, placePanel } from '../src/systems/CharacterPanelPlacementSystem';

/** Les valeurs par défaut du système, pour que les tests parlent de la même chose. */
const OFFSET = 0.8;
const ELEVATION = 1.2;

function scene() {
  const panel = new Object3D();
  const cible = new Object3D();
  const camera = new Object3D();
  return { panel, cible, camera };
}

/** L'écart HORIZONTAL — le seul que `offset` promette. */
function distanceHorizontale(a: Object3D, b: Object3D): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

describe('le placement du panneau', () => {
  it('se pose à côté de la cible à l horizontale, et à hauteur de regard', () => {
    // Deux mesures SÉPARÉES, et c'est le fond de la trouvaille I3 : mesurer la
    // distance TOTALE rend les deux exigences de la spec §6 (« 0,8 m sur le
    // côté, à hauteur de regard ») contradictoires, et le ruling précédent
    // avait sacrifié l'exigence plutôt que la mesure. La position d'un
    // villageois étant au sol, le panneau se retrouvait centré sur ses pieds.
    const { panel, cible, camera } = scene();
    cible.position.set(3, 0, -2);
    camera.position.set(0, 1.6, 0);
    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);
    expect(distanceHorizontale(panel, cible)).toBeCloseTo(OFFSET, 5);
    expect(panel.position.y - cible.position.y).toBeCloseTo(ELEVATION, 5);
  });

  it('se tourne vers la CAMÉRA, pas vers la cible', () => {
    // Le piège : `Follower` en FaceTarget oriente vers sa cible de suivi. Ici
    // la cible de position et la cible d orientation diffèrent.
    const { panel, cible, camera } = scene();
    cible.position.set(5, 0, 0);
    camera.position.set(0, 0, 10);
    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);
    const versCamera = new Vector3().subVectors(camera.position, panel.position).normalize();
    const avant = new Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    expect(avant.dot(versCamera)).toBeGreaterThan(0.99);
  });

  it('grandit avec la distance, pour garder la même taille apparente', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(0, 0, 0);
    camera.position.set(0, 0, 2);
    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);
    const proche = panel.scale.x;
    camera.position.set(0, 0, 12);
    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);
    expect(panel.scale.x).toBeGreaterThan(proche);
  });

  it('borne l échelle aux deux extrémités', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(0, 0, 0);
    camera.position.set(0, 0, 0.1);
    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);
    expect(panel.scale.x).toBeCloseTo(0.5, 5);
    camera.position.set(0, 0, 500);
    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);
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
    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);
    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);
    expect(panel.position.equals(avant)).toBe(false);
  });
});

describe('les trois repères sont des repères MONDE', () => {
  // Le garde qui manquait. Les cinq tests ci-dessus construisent caméra, cible
  // et panneau SANS PARENT : local et monde y coïncident par construction,
  // donc ils restaient verts sur une implémentation qui prenait
  // `camera.position` — une position LOCALE au rig du joueur — pour une
  // position monde. Le cœur parente pourtant `world.camera` sous
  // `world.player` (`world-initializer.js`), et `apps/demo/src/AGENTS.md` le
  // dit noir sur blanc.

  it('la caméra parentée sous le rig du joueur : la distance vient de sa position MONDE', () => {
    // La scène de la démo, exactement : joueur à (0, 7, 0)
    // (`main.iwsdk.scene.json`), caméra à (0, 1,6, 0) DANS le rig
    // (`iwsdk.config.json`), villageois posé sur le terrain à (3, 7, −8).
    const { panel, cible } = scene();
    const rigJoueur = new Object3D();
    const camera = new Object3D();
    rigJoueur.add(camera);
    rigJoueur.position.set(0, 7, 0);
    camera.position.set(0, 1.6, 0);
    cible.position.set(3, 7, -8);

    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);

    const camMonde = new Vector3(0, 8.6, 0);
    const vraieDistance = camMonde.distanceTo(cible.position); // ≈ 8,69 m
    // Version fautive : elle mesurait 10,1 m, et l'échelle collait à sa borne
    // haute — 3 — quelle que soit la distance réelle du joueur.
    expect(panel.scale.x).toBeCloseTo(vraieDistance / 3, 4);

    // Et il regarde le VRAI viseur. Une surface UIKitML est à face unique :
    // orientée vers un point sept mètres sous le sol, elle ne rend RIEN et ne
    // signale rien.
    const versCamera = new Vector3().subVectors(camMonde, panel.position).normalize();
    const avant = new Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    expect(avant.dot(versCamera)).toBeGreaterThan(0.99);
  });

  it('la cible parentée sous un nœud déplacé : le panneau la suit dans le MONDE', () => {
    const { panel, camera } = scene();
    const niveau = new Object3D();
    const cible = new Object3D();
    niveau.add(cible);
    niveau.position.set(10, 0, 0);
    cible.position.set(0, 0, 0); // monde : (10, 0, 0)
    camera.position.set(10, 1.6, 6);

    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);

    expect(Math.hypot(panel.position.x - 10, panel.position.z)).toBeCloseTo(OFFSET, 5);
    expect(panel.position.y).toBeCloseTo(ELEVATION, 5);
  });

  it('le panneau parenté sous un nœud déplacé : sa position LOCALE porte la bonne position monde', () => {
    // `world.createTransformEntity(node)` parente le panneau sous le niveau
    // actif. Écrire une position monde dans `panel.position` sans conversion
    // le décalerait de la transformation du parent.
    const { cible, camera } = scene();
    const parent = new Object3D();
    const panel = new Object3D();
    parent.add(panel);
    parent.position.set(0, 5, 0);
    cible.position.set(0, 0, -4);
    camera.position.set(0, 1.6, 0);

    placePanel(panel, cible, camera, OFFSET, ELEVATION, 0.5, 3);

    const monde = new Vector3();
    panel.getWorldPosition(monde);
    expect(monde.y).toBeCloseTo(cible.position.y + ELEVATION, 5);
    expect(Math.hypot(monde.x - cible.position.x, monde.z - cible.position.z)).toBeCloseTo(OFFSET, 5);
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
