import { describe, it, expect } from 'vitest';
import {
  RIVER_WAVES_LOW,
  totalSteepness,
  gerstnerDisplacement,
  type GerstnerWave,
} from '../src/water/waves';

describe('jeu de vagues', () => {
  it('déclare trois vagues, comme le prévoit le niveau bas de la spec', () => {
    expect(RIVER_WAVES_LOW.length).toBe(3);
  });

  it("NE S'AUTO-INTERSECTE PAS : la somme des raideurs reste sous 1", () => {
    // Au-delà de 1, les crêtes de Gerstner se replient sur elles-mêmes et la
    // surface se retourne. Le défaut est invisible sur une capture de face et
    // saute aux yeux dans un casque.
    expect(totalSteepness(RIVER_WAVES_LOW)).toBeLessThan(1);
  });

  it('décrit des vagues plausibles : direction unitaire, longueur et vitesse positives', () => {
    for (const w of RIVER_WAVES_LOW) {
      expect(Math.hypot(w.dirX, w.dirZ)).toBeCloseTo(1, 6);
      expect(w.wavelength).toBeGreaterThan(0);
      expect(w.speed).toBeGreaterThan(0);
      expect(w.steepness).toBeGreaterThan(0);
    }
  });

  it("mêle des longueurs différentes : des vagues identiques ne feraient qu'une", () => {
    const lengths = new Set(RIVER_WAVES_LOW.map((w) => w.wavelength));
    expect(lengths.size).toBe(RIVER_WAVES_LOW.length);
  });
});

describe('gerstnerDisplacement', () => {
  it("est nul quand il n'y a pas de vague", () => {
    const d = gerstnerDisplacement([], 3, 4, 1.5);
    expect(d.x).toBe(0);
    expect(d.y).toBe(0);
    expect(d.z).toBe(0);
  });

  it('reste borné par la somme des amplitudes', () => {
    // Amplitude d'une vague de Gerstner : steepness x wavelength / (2 pi).
    const bound = RIVER_WAVES_LOW.reduce(
      (acc, w) => acc + (w.steepness * w.wavelength) / (2 * Math.PI),
      0,
    );
    for (let i = 0; i < 400; i++) {
      const d = gerstnerDisplacement(RIVER_WAVES_LOW, i * 0.7, i * -0.3, i * 0.05);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(bound + 1e-9);
      expect(Math.hypot(d.x, d.z)).toBeLessThanOrEqual(bound + 1e-9);
    }
  });

  it('est déterministe', () => {
    const a = gerstnerDisplacement(RIVER_WAVES_LOW, 2.5, -1.25, 3);
    const b = gerstnerDisplacement(RIVER_WAVES_LOW, 2.5, -1.25, 3);
    expect(a).toEqual(b);
  });

  it("BOUGE avec le temps : une eau figée n'est pas de l'eau", () => {
    const t0 = gerstnerDisplacement(RIVER_WAVES_LOW, 5, 5, 0);
    const t1 = gerstnerDisplacement(RIVER_WAVES_LOW, 5, 5, 1.7);
    expect(Math.abs(t1.y - t0.y)).toBeGreaterThan(1e-4);
  });

  it('se répète dans le temps, vague par vague', () => {
    // Une vague de Gerstner est périodique de période wavelength / speed.
    const single: GerstnerWave[] = [{ dirX: 1, dirZ: 0, steepness: 0.3, wavelength: 4, speed: 2 }];
    const period = 4 / 2;
    const a = gerstnerDisplacement(single, 1.3, 0, 0.4);
    const b = gerstnerDisplacement(single, 1.3, 0, 0.4 + period);
    expect(b.y).toBeCloseTo(a.y, 9);
  });
});
