import { describe, it, expect } from 'vitest';
import { quatMul, quatRotate } from '../src/compile/quat';

const IDENT = [0, 0, 0, 1] as const;
// Rotation de 90° autour de X : (0,1,0) doit partir sur (0,0,1).
const RX90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

describe('quatRotate', () => {
  it('laisse un vecteur intact sous l identité', () => {
    expect(quatRotate(IDENT, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('tourne (0,1,0) vers (0,0,1) autour de X', () => {
    const r = quatRotate(RX90, [0, 1, 0]);
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[1]).toBeCloseTo(0, 9);
    expect(r[2]).toBeCloseTo(1, 9);
  });

  it('conserve la longueur', () => {
    const r = quatRotate(RX90, [3, 4, 0]);
    expect(Math.hypot(r[0], r[1], r[2])).toBeCloseTo(5, 9);
  });
});

describe('quatMul', () => {
  it('a l identité pour élément neutre', () => {
    expect(quatMul(IDENT, RX90)).toEqual([...RX90]);
    expect(quatMul(RX90, IDENT)).toEqual([...RX90]);
  });

  it('compose deux quarts de tour en un demi-tour', () => {
    const half = quatMul(RX90, RX90);
    const r = quatRotate(half, [0, 1, 0]);
    expect(r[1]).toBeCloseTo(-1, 9);
  });
});
