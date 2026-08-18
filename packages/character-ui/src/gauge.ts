import { setText, type PanelDocument } from './document';

/**
 * Une barre de progression faite d'un `div` dont on pilote la largeur.
 *
 * UIKitML n'a pas de `type="range"` : il n'existe aucun curseur natif, et la
 * documentation officielle ne liste que `div`, `p`, `h1`, `button`, `ul`/`li`,
 * `img`, `svg`, `video`, `input` et `textarea`. La largeur en POURCENTAGE et
 * non en unités absolues : le conteneur peut changer de taille avec le
 * panneau, la barre suit.
 *
 * `fraction` est normalisée dans `[0,1]`. Les gènes la fournissent
 * directement ; les besoins, dont l'échelle est 0–100, divisent avant
 * d'appeler.
 */
export function renderGauge(
  doc: PanelDocument,
  barId: string,
  valueId: string,
  fraction: number,
  texte: string,
): void {
  const borne = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  doc.getElementById(barId)?.setProperties({ width: `${Math.round(borne * 100)}%` });
  setText(doc.getElementById(valueId), texte);
}
