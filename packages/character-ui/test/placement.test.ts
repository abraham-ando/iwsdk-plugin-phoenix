import { describe, it, expect } from 'vitest';
import { Object3D, Vector3 } from '@iwsdk/core';
import { placePanel } from '../src/systems/CharacterPanelPlacementSystem';

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
