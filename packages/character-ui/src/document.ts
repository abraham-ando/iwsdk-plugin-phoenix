/**
 * Ce que les panneaux savent faire d'un élément, sans dépendre de Three.
 *
 * Même motif que `LocalAiPanel` de la démo, et pour la même raison : un
 * contrôleur qui ne connaît que cette interface se teste en Node avec un
 * document factice — pas d'analyseur UIKitML, pas de polices, pas de réseau.
 * `LocalAiPanel` avait posé le motif sans jamais l'employer ; ici il sert.
 */
export interface PanelElement {
  setProperties(props: Record<string, unknown>): void;
  setText?(text: string): void;
  addEventListener?(type: string, handler: () => void): void;
}

export interface PanelDocument {
  getElementById(id: string): PanelElement | null | undefined;
}

/** Montre ou cache un élément. `flex` et non `block` : UIKit est en flexbox. */
export function show(el: PanelElement | null | undefined, visible: boolean): void {
  el?.setProperties({ display: visible ? 'flex' : 'none' });
}

/** Écrit un texte, si l'élément sait en porter un. */
export function setText(el: PanelElement | null | undefined, texte: string): void {
  el?.setText?.(texte);
}
