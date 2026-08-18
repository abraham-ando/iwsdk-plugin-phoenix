import { createSystem, Types, Vector3, type Entity, type Object3D } from '@iwsdk/core';
import { CharacterSelection } from '@iwsdk/cardinal-character-three';

// Vecteurs de travail au niveau du module : la fonction tourne à 90 Hz, et un
// littéral par appel serait onze allocations par seconde et par personnage.
// `getWorldPosition` et `worldToLocal` écrivent DANS une cible fournie et
// n'allouent rien de leur côté (Three garde leurs matrices intermédiaires en
// propriétés de module, comme ici).
const _camMonde = new Vector3();
const _cibleMonde = new Vector3();
const _position = new Vector3();
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
 * **Tout se calcule en coordonnées MONDE.** `world.camera` est un ENFANT de
 * `world.player` — le cœur le parente lui-même (`world-initializer.js`,
 * `attachCameraToPlayer(xrOrigin, world.camera)`) — et `apps/demo/src/AGENTS.md`
 * l'énonce : « `world.camera.position` is local to `world.player`; use
 * `getWorldPosition()` when logic needs the true viewer position ». Prendre
 * `camera.position` pour une position monde soustrait un point d'un repère à
 * un point d'un autre : la distance est fausse (donc l'échelle colle à sa
 * borne), le côté est arbitraire, et `lookAt` vise un point qui n'est pas le
 * viseur — or les surfaces UIKitML sont à FACE UNIQUE
 * (`apps/demo/public/ui/AGENTS.md`), donc le panneau disparaît sans un mot.
 * `panel.position`, symétriquement, est LOCALE à son parent : la position
 * monde calculée ici y est reconvertie.
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
  elevation: number,
  scaleMin: number,
  scaleMax: number,
): void {
  camera.getWorldPosition(_camMonde);
  cible.getWorldPosition(_cibleMonde);

  _versCamera.subVectors(_camMonde, _cibleMonde);
  const distance = _versCamera.length();
  if (distance < 1e-4) return;
  _versCamera.divideScalar(distance);

  // Le côté : perpendiculaire à l'axe caméra-cible, dans le plan horizontal.
  // `_cote` est purement horizontal (composante Y nulle par construction du
  // produit vectoriel avec `_haut`), donc l'écart HORIZONTAL à la cible vaut
  // exactement `offset` et l'élévation s'ajoute sans le perturber. C'est
  // pourquoi le test mesure les deux séparément : une version antérieure avait
  // SUPPRIMÉ l'élévation pour satisfaire un test qui mesurait la distance
  // TOTALE. Or la position d'un villageois est au SOL (`rootMotion: 'flatten'`,
  // `CardinalSimulationSystem` écrit la position monde du corps) : sans
  // élévation, le panneau se centre sur ses pieds, moitié sous le terrain,
  // contre le « à hauteur de regard » de la spec §6.
  _cote.crossVectors(_haut, _versCamera).normalize();
  _position.copy(_cibleMonde).addScaledVector(_cote, offset);
  _position.y += elevation;

  // `_position` est une position MONDE ; `panel.position` est locale à son
  // parent. Sans parent (les tests unitaires, et le nœud pas encore monté) les
  // deux coïncident.
  if (panel.parent !== null) panel.parent.worldToLocal(_position);
  panel.position.copy(_position);

  // `lookAt` prend un point MONDE et se charge lui-même du repère parent.
  panel.lookAt(_camMonde);

  // 3 mètres de référence : à cette distance l'échelle vaut 1.
  const echelle = Math.min(scaleMax, Math.max(scaleMin, distance / 3));
  panel.scale.setScalar(echelle);
}

/** Priorité 92 : après la sélection (90), qui décide de la cible. */
export class CharacterPanelPlacementSystem extends createSystem(
  { selections: { required: [CharacterSelection] } },
  {
    offsetMeters: { type: Types.Float32, default: 0.8 },
    /** « À hauteur de regard », spec §6 — la position du villageois est au SOL. */
    elevationMeters: { type: Types.Float32, default: 1.2 },
    scaleMin: { type: Types.Float32, default: 0.5 },
    scaleMax: { type: Types.Float32, default: 3 },
  },
) {
  /** Le nœud du panneau, posé par `installCharacterUI`. */
  public panel: Object3D | null = null;

  /**
   * `CharacterSelection` est un SINGLETON : comme dans `CharacterPickSystem`,
   * mémorisée par abonnement plutôt que rescannée à chaque `update()` —
   * `entities.values().next().value` allouait un itérateur ET un objet
   * résultat par appel (mesuré en Node : `it1 !== it2`, `r1 !== r2`).
   */
  private selection: Entity | null = null;

  public override init(): void {
    this.cleanupFuncs.push(
      this.queries.selections.subscribe(
        'qualify',
        (entity) => {
          this.selection = entity;
        },
        true,
      ),
      this.queries.selections.subscribe('disqualify', (entity) => {
        if (this.selection === entity) this.selection = null;
      }),
    );
  }

  // Signature alignée sur `CharacterPickSystem` : voir son commentaire sur
  // `update(_delta, _time)` vs `update()`.
  public override update(_delta: number, _time: number): void {
    if (this.panel === null) return;
    if (this.selection === null) return;
    const cible = this.selection.getValue(CharacterSelection, 'target');
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
      this.config.elevationMeters.peek(),
      this.config.scaleMin.peek(),
      this.config.scaleMax.peek(),
    );
  }
}
