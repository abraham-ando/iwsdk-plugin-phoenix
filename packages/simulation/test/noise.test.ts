import { describe, it, expect } from 'vitest';
import { clamp01, lerp, smoothstep, valueNoise, erodedFbm, ridgedFbm } from '../src/world/noise';

describe('helpers', () => {
  it('clamp01 borne des deux côtés', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(9)).toBe(1);
  });

  it('lerp interpole aux extrémités et au milieu', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('smoothstep est plat aux bords et vaut 0.5 au centre', () => {
    expect(smoothstep(2, 6, 1)).toBe(0);
    expect(smoothstep(2, 6, 7)).toBe(1);
    expect(smoothstep(2, 6, 4)).toBeCloseTo(0.5, 10);
  });

  it('smoothstep ne divise pas par zéro quand les bords coïncident', () => {
    expect(Number.isFinite(smoothstep(3, 3, 3))).toBe(true);
  });
});

describe('valueNoise', () => {
  it('reste dans [0, 1] sur un large domaine', () => {
    for (let i = 0; i < 800; i++) {
      const v = valueNoise(i * 3.7 - 1000, i * -1.3 + 500, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('est SANS ÉTAT : le même point rend toujours la même valeur', () => {
    const a = valueNoise(123.456, -78.9, 5);
    valueNoise(0, 0, 5);
    valueNoise(999, 999, 5);
    expect(valueNoise(123.456, -78.9, 5)).toBe(a);
  });

  it('sépare les graines', () => {
    expect(valueNoise(3.3, 7.1, 1)).not.toBe(valueNoise(3.3, 7.1, 2));
  });

  it('est continu : deux points voisins restent proches', () => {
    let previous = valueNoise(-40, 2, 5);
    for (let x = -40; x < 40; x += 0.02) {
      const current = valueNoise(x, 2, 5);
      expect(Math.abs(current - previous)).toBeLessThan(0.05);
      previous = current;
    }
  });

  it('porte du signal : deux nœuds voisins du réseau diffèrent', () => {
    expect(valueNoise(7, -3, 4)).not.toBe(valueNoise(8, -3, 4));
  });
});

describe('erodedFbm', () => {
  it('reste dans [0, 1]', () => {
    for (let i = 0; i < 400; i++) {
      const v = erodedFbm(i * 0.31, i * -0.17, 21);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('est déterministe', () => {
    expect(erodedFbm(4.2, -8.8, 3)).toBe(erodedFbm(4.2, -8.8, 3));
  });

  it('ADOUCIT les pentes par rapport à une fbm non érodée', () => {
    // L'érosion amortit les octaves hautes là où la pente accumulée est forte :
    // la variation moyenne doit être plus faible que celle du bruit brut sommé.
    const meanStep = (f: (x: number) => number): number => {
      let total = 0;
      let n = 0;
      for (let x = 0; x < 30; x += 0.05) {
        total += Math.abs(f(x + 0.05) - f(x));
        n++;
      }
      return total / n;
    };
    const eroded = meanStep((x) => erodedFbm(x, 1.5, 9, 5));
    const raw = meanStep((x) => {
      let sum = 0;
      let amp = 1;
      let freq = 1;
      let norm = 0;
      for (let o = 0; o < 5; o++) {
        sum += amp * valueNoise(x * freq, 1.5 * freq, 9 + o * 1013);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      return sum / norm;
    });
    expect(eroded).toBeLessThan(raw);
  });
});

describe('ridgedFbm', () => {
  it('reste dans [0, 1] et est déterministe', () => {
    for (let i = 0; i < 300; i++) {
      const v = ridgedFbm(i * 0.23, i * 0.41, 33);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(ridgedFbm(1.1, 2.2, 33)).toBe(ridgedFbm(1.1, 2.2, 33));
  });

  it('produit des crêtes : la valeur maximale approche 1', () => {
    let max = 0;
    for (let x = 0; x < 60; x += 0.05) max = Math.max(max, ridgedFbm(x, 3.7, 33));
    expect(max).toBeGreaterThan(0.75);
  });
});
