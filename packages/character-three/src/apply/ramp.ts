import { Color } from '@iwsdk/core';

/** Borne haute réutilisée : un `new Color()` par appel allouerait pour rien. */
const HIGH = new Color();

/**
 * Le ton normalisé d'un gène de surface devient une couleur, par interpolation
 * entre les deux bornes de la rampe que ce gène déclare.
 *
 * UNE seule implémentation, partagée par les applicateurs — qui teintent le
 * matériau — et par `CharacterCompileSystem`, qui écrit la même couleur dans
 * `CharacterSurface`. Deux interpolations séparées finiraient par diverger, et
 * le composant dirait alors autre chose que ce que l'écran montre : un
 * inspecteur qui ment est pire que pas d'inspecteur.
 */
export function rampColour(out: Color, ramp: readonly [string, string], tone: number): Color {
  return out.set(ramp[0]).lerp(HIGH.set(ramp[1]), tone);
}
