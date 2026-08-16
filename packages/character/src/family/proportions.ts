import type { Curve } from './types';

/**
 * Interpolation affine par morceaux, bornée aux deux bouts.
 *
 * Bornée et non extrapolée : une courbe de proportion décrit une plage d'âges
 * observée, et prolonger sa pente au-delà produirait des monstres — un
 * nourrisson à tête négative, un vieillard à tête de fourmi.
 */
export function evalCurve(curve: Curve, x: number): number {
  if (curve.length === 0) throw new Error('evalCurve: courbe vide');

  const first = curve[0]!;
  if (x <= first[0]) return first[1];

  const last = curve[curve.length - 1]!;
  if (x >= last[0]) return last[1];

  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (x <= b[0]) {
      const span = b[0] - a[0];
      if (span === 0) return b[1];
      return a[1] + (b[1] - a[1]) * ((x - a[0]) / span);
    }
  }

  return last[1];
}
