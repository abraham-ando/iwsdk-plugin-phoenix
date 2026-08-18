import { createSystem, Pressed, type Entity } from '@iwsdk/core';
import { CharacterIdentity, CharacterSelection } from '@iwsdk/cardinal-character-three';

/**
 * Écrit `CharacterSelection.target` quand un personnage est pressé.
 *
 * `RayInteractable` plus `Pressed` couvre le rayon du casque ET le pointeur
 * souris — l'`AGENTS.md` du projet l'énonce, et `canvasPointerEvents` est déjà
 * actif dans la démo. Une seule voie de code sert donc les deux modes ; c'est
 * la raison pour laquelle il n'existe aucun chemin bureau séparé.
 *
 * Priorité 90 : après le système d'animation (80), dont la cible ne dépend pas.
 */
export class CharacterPickSystem extends createSystem({
  pressedCharacters: { required: [CharacterIdentity, Pressed] },
  selections: { required: [CharacterSelection] },
}) {
  /**
   * `CharacterSelection` est un SINGLETON (voir son commentaire dans
   * `character-three/src/components/index.ts`) : pas besoin de le rescanner
   * chaque frame. `entities.values().next().value` allouait un itérateur ET
   * un objet résultat À CHAQUE APPEL — mesuré en Node, `it1 !== it2` et
   * `r1 !== r2` — ce qu'`update()` interdit sans ambiguïté. Motif copié de
   * `CharacterAnimationSystem.init()` : s'abonner une fois, tenir la
   * référence à jour par événement plutôt que par sondage.
   */
  private selection: Entity | null = null;

  /**
   * Le premier personnage pressé trouvé pendant le `forEach` de cette frame.
   * Remis à `null` en tête d'`update()`, rempli par `captureFirstPressed`.
   */
  private firstPressed: Entity | null = null;

  /**
   * Propriété de classe, créée UNE fois par instance — jamais un littéral
   * d'appel (`(e) => {...}` réécrit dans `update()` allouerait une fermeture
   * par frame). `Set.prototype.forEach` ne s'arrête pas au premier élément,
   * mais il n'alloue ni itérateur ni objet résultat : on laisse tourner la
   * boucle et on ignore tout ce qui vient après le premier trouvé.
   */
  private readonly captureFirstPressed = (entity: Entity): void => {
    if (this.firstPressed === null) this.firstPressed = entity;
  };

  public override init(): void {
    // `replayExisting: true` sur `qualify` : si `installCharacterUI` a créé
    // l'entité de sélection avant que ce système ne soit enregistré, on la
    // capte quand même — pas seulement les créations FUTURES.
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

  // `(_delta, _time)` et non `()` : `pick.test.ts` appelle `system.update(0.016,
  // 16)`, comme `CharacterAnimationSystem`. Un override à zéro paramètre est
  // un sous-type valide à l'exécution, mais TypeScript vérifie l'appel contre
  // la signature DÉCLARÉE de la sous-classe, pas celle de la classe de base —
  // `update(): void` aurait fait échouer `pnpm typecheck` sur ces appels.
  public override update(_delta: number, _time: number): void {
    if (this.selection === null) return;
    // Le premier pressé de la frame gagne. Une frame où deux personnages sont
    // pressés simultanément n'existe pas en pratique — un seul rayon, un seul
    // pointeur — et arbitrer coûterait plus que le cas ne vaut.
    this.firstPressed = null;
    this.queries.pressedCharacters.entities.forEach(this.captureFirstPressed);
    const vise = this.firstPressed;
    if (vise === null) return;
    this.selection.setValue(CharacterSelection, 'target', vise);
  }
}
