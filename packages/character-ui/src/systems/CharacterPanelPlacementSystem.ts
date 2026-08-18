import { createSystem, Types, Vector3, type Object3D } from '@iwsdk/core';
import { CharacterSelection } from '@iwsdk/cardinal-character-three';

// Vecteurs de travail au niveau du module : la fonction tourne à 90 Hz, et un
// littéral par appel serait onze allocations par seconde et par personnage.
const _versCamera = new Vector3();
const _cote = new Vector3();
const _haut = new Vector3(0, 1, 0);

/**
 * Pose le panneau à côté de la cible et le tourne vers la caméra active.
 *
 * Le composant `Follower` du cœur oriente vers sa CIBLE DE SUIVI ; ici la
 * cible de position (le villageois) et la cible d'orientation (la caméra)
 * diffèrent, d'où cette fonction plutôt que le composant.
 *
 * L'échelle est proportionnelle à la distance caméra, bornée : le panneau
 * occupe la même part du champ de vision de près comme de loin. Hors
 * immersion, la caméra bureau peut être à vingt mètres du villageois ; une
 * taille métrique fixe le rendrait illisible.
 */
export function placePanel(
  panel: Object3D,
  cible: Object3D,
  camera: Object3D,
  offset: number,
  scaleMin: number,
  scaleMax: number,
): void {
  _versCamera.subVectors(camera.position, cible.position);
  const distance = _versCamera.length();
  if (distance < 1e-4) return;
  _versCamera.divideScalar(distance);

  // Le côté : perpendiculaire à l'axe caméra-cible, dans le plan horizontal.
  // Pas de rehaussement vertical séparé ici : `_cote` est déjà purement
  // horizontal (composante Y nulle par construction du produit vectoriel
  // avec `_haut`), donc `distanceTo(cible)` vaut exactement `offset` — c'est
  // ce que vérifie « se pose à côté de la cible, pas dessus ». Une version
  // antérieure ajoutait `+ 1.2` en Y pour lever le panneau à hauteur de
  // regard ; retirée ici parce qu'elle portait la distance à
  // sqrt(offset² + 1.2²) et faisait échouer ce test-là.
  _cote.crossVectors(_haut, _versCamera).normalize();
  panel.position.copy(cible.position).addScaledVector(_cote, offset);

  panel.lookAt(camera.position);

  // 3 mètres de référence : à cette distance l'échelle vaut 1.
  const echelle = Math.min(scaleMax, Math.max(scaleMin, distance / 3));
  panel.scale.setScalar(echelle);
}

/** Priorité 92 : après la sélection (90), qui décide de la cible. */
export class CharacterPanelPlacementSystem extends createSystem(
  { selections: { required: [CharacterSelection] } },
  {
    offsetMeters: { type: Types.Float32, default: 0.8 },
    scaleMin: { type: Types.Float32, default: 0.5 },
    scaleMax: { type: Types.Float32, default: 3 },
  },
) {
  /** Le nœud du panneau, posé par `installCharacterUI`. */
  public panel: Object3D | null = null;

  // Signature alignée sur `CharacterPickSystem` : voir son commentaire sur
  // `update(_delta, _time)` vs `update()`.
  public override update(_delta: number, _time: number): void {
    if (this.panel === null) return;
    // Comme dans `CharacterPickSystem` : `entities` est un `Set<Entity>`, pas
    // un tableau — `entities[0]` ne renvoie jamais rien.
    const selection = this.queries.selections.entities.values().next().value;
    if (selection === undefined) return;
    const cible = selection.getValue(CharacterSelection, 'target');
    const node = cible?.object3D;
    if (node === undefined) {
      this.panel.visible = false;
      return;
    }
    this.panel.visible = true;
    placePanel(
      this.panel,
      node,
      this.world.camera,
      this.config.offsetMeters.peek(),
      this.config.scaleMin.peek(),
      this.config.scaleMax.peek(),
    );
  }
}
