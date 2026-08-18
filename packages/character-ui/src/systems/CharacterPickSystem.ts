import { createSystem, Pressed } from '@iwsdk/core';
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
  // `(_delta, _time)` et non `()` : `pick.test.ts` appelle `system.update(0.016,
  // 16)`, comme `CharacterAnimationSystem`. Un override à zéro paramètre est
  // un sous-type valide à l'exécution, mais TypeScript vérifie l'appel contre
  // la signature DÉCLARÉE de la sous-classe, pas celle de la classe de base —
  // `update(): void` aurait fait échouer `pnpm typecheck` sur ces appels.
  public override update(_delta: number, _time: number): void {
    // `queries.*.entities` est un `Set<Entity>` (elics), PAS un tableau :
    // `entities[0]` renvoie toujours `undefined` — mesuré, ça faisait échouer
    // les quatre tests de ce fichier en silence (pas d'exception, juste une
    // cible qui restait `null`). `.values().next().value` prend le premier
    // inséré, ce qui correspond au commentaire ci-dessous.
    const selection = this.queries.selections.entities.values().next().value;
    if (selection === undefined) return;
    // Le premier pressé de la frame gagne. Une frame où deux personnages sont
    // pressés simultanément n'existe pas en pratique — un seul rayon, un seul
    // pointeur — et arbitrer coûterait plus que le cas ne vaut.
    const vise = this.queries.pressedCharacters.entities.values().next().value;
    if (vise === undefined) return;
    selection.setValue(CharacterSelection, 'target', vise);
  }
}
