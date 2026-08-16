import { describe, it, expect } from 'vitest';
import { evalCurve } from '../src/family/proportions';

const HEAD_TO_BODY = [
  [0, 0.25],
  [3, 0.2],
  [12, 0.15],
  [18, 0.133],
] as const;

describe('evalCurve', () => {
  it('rend la valeur exacte à chaque nœud', () => {
    expect(evalCurve(HEAD_TO_BODY, 0)).toBeCloseTo(0.25, 10);
    expect(evalCurve(HEAD_TO_BODY, 3)).toBeCloseTo(0.2, 10);
    expect(evalCurve(HEAD_TO_BODY, 12)).toBeCloseTo(0.15, 10);
    expect(evalCurve(HEAD_TO_BODY, 18)).toBeCloseTo(0.133, 10);
  });

  it('interpole linéairement entre deux nœuds', () => {
    // Milieu de [0, 3] : (0.25 + 0.2) / 2
    expect(evalCurve(HEAD_TO_BODY, 1.5)).toBeCloseTo(0.225, 10);
  });

  it('borne aux deux extrémités au lieu d extrapoler', () => {
    // Un vieillard n a pas une tête qui rétrécit indéfiniment.
    expect(evalCurve(HEAD_TO_BODY, -5)).toBeCloseTo(0.25, 10);
    expect(evalCurve(HEAD_TO_BODY, 90)).toBeCloseTo(0.133, 10);
  });

  it('décroît de la naissance à l âge adulte', () => {
    let previous = Infinity;
    for (let age = 0; age <= 18; age += 0.5) {
      const value = evalCurve(HEAD_TO_BODY, age);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('rejette une courbe vide plutôt que de rendre NaN', () => {
    expect(() => evalCurve([], 5)).toThrow('courbe vide');
  });

  it('supporte une courbe à un seul nœud', () => {
    expect(evalCurve([[10, 0.7]], 0)).toBeCloseTo(0.7, 10);
    expect(evalCurve([[10, 0.7]], 99)).toBeCloseTo(0.7, 10);
  });
});
