import { describe, it, expect } from 'vitest';
import { valueNoise2D, fbm2D, ridged2D } from '../src/materials/noise';

describe('valueNoise2D', () => {
  it('stays inside [0, 1]', () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise2D(i * 0.37, i * 0.11, 8, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for the same seed and position', () => {
    expect(valueNoise2D(3.3, 7.1, 8, 42)).toBe(valueNoise2D(3.3, 7.1, 8, 42));
  });

  it('differs between seeds', () => {
    expect(valueNoise2D(3.3, 7.1, 8, 1)).not.toBe(valueNoise2D(3.3, 7.1, 8, 2));
  });

  it('TILES exactly: sampling one period away gives the same value', () => {
    const period = 8;
    for (const [x, y] of [
      [0, 0],
      [1.7, 3.2],
      [5.5, 0.25],
      [7.9, 7.9],
    ]) {
      expect(valueNoise2D(x!, y!, period, 7)).toBeCloseTo(valueNoise2D(x! + period, y!, period, 7), 10);
      expect(valueNoise2D(x!, y!, period, 7)).toBeCloseTo(valueNoise2D(x!, y! + period, period, 7), 10);
    }
  });

  it('is continuous: neighbouring samples stay close', () => {
    let previous = valueNoise2D(0, 2, 8, 5);
    for (let x = 0.01; x < 8; x += 0.01) {
      const current = valueNoise2D(x, 2, 8, 5);
      expect(Math.abs(current - previous)).toBeLessThan(0.1);
      previous = current;
    }
  });
});

describe('fbm2D', () => {
  it('stays inside [0, 1] and tiles exactly', () => {
    const period = 16;
    for (let i = 0; i < 200; i++) {
      const x = (i * 0.53) % period;
      const y = (i * 0.29) % period;
      const v = fbm2D(x, y, period, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeCloseTo(fbm2D(x + period, y + period, period, 3), 10);
    }
  });

  it('adds detail with more octaves (higher local variance)', () => {
    const sample = (octaves: number) => {
      const values: number[] = [];
      for (let x = 0; x < 4; x += 0.05) values.push(fbm2D(x, 1.5, 16, 9, octaves));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    };
    const smooth = sample(1);
    const detailed = sample(5);
    expect(detailed).toBeGreaterThan(0);
    expect(smooth).toBeGreaterThan(0);
  });
});

describe('ridged2D', () => {
  it('stays inside [0, 1] and tiles exactly', () => {
    const period = 8;
    for (let i = 0; i < 100; i++) {
      const x = (i * 0.71) % period;
      const v = ridged2D(x, 2.5, period, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeCloseTo(ridged2D(x + period, 2.5, period, 11), 10);
    }
  });
});
