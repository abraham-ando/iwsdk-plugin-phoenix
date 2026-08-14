/**
 * The client half of the day/night cycle.
 *
 * Cross-language agreement is proven by golden vectors in `parity.test.ts`;
 * this file pins the shape of the function itself.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CYCLE_MS,
  sunAngle,
  sunElevation,
  timeOfDay,
} from '../src/world/day-night.js';

const CYCLE = 7_200_000;

describe('day/night', () => {
  it('completes exactly one turn per cycle', () => {
    expect(sunAngle(0, CYCLE)).toBe(0);
    expect(sunAngle(CYCLE, CYCLE)).toBeCloseTo(0, 9);
    expect(sunAngle(CYCLE / 2, CYCLE)).toBeCloseTo(Math.PI, 9);
  });

  it('is periodic, so a long absence needs no catching up', () => {
    for (let day = 0; day < 4; day++) {
      expect(sunAngle(day * CYCLE + 1000, CYCLE)).toBeCloseTo(sunAngle(1000, CYCLE), 9);
    }
  });

  it('peaks a quarter through and troughs three quarters through', () => {
    expect(sunElevation(CYCLE / 4, CYCLE)).toBeCloseTo(1, 9);
    expect(sunElevation((3 * CYCLE) / 4, CYCLE)).toBeCloseTo(-1, 9);
  });

  it('reports the fraction through the cycle', () => {
    expect(timeOfDay(CYCLE / 4, CYCLE)).toBeCloseTo(0.25, 9);
  });

  it('never leaves 0..2pi', () => {
    for (const t of [0, 1, CYCLE - 1, CYCLE * 17 + 3]) {
      const angle = sunAngle(t, CYCLE);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
    }
  });

  it('falls back to the default cycle rather than dividing by zero', () => {
    expect(sunAngle(1000, 0)).toBe(sunAngle(1000, DEFAULT_CYCLE_MS));
  });
});
