import { describe, it, expect } from 'vitest';
import {
  WORLD_SIZE,
  SEA_LEVEL,
  PLATEAU_RADIUS,
  BASIN_RADIUS,
  heightAt,
  getTerrainHeight,
  isRiverAt,
  isShoreAt,
  riverCenterX,
  landMaskAt,
  slopeAt,
  isWaterAt,
  depthAt,
} from '../src/world/terrain';

describe('constantes', () => {
  it('garde la zone simulée à 64 m et la mer à zéro', () => {
    // WORLD_SIZE borne la SIMULATION (clamp de navigation, SpatialGrid),
    // pas l'étendue du terrain, qui est désormais infinie.
    expect(WORLD_SIZE).toBe(64);
    expect(SEA_LEVEL).toBe(0);
    expect(PLATEAU_RADIUS).toBe(5);
  });
});

describe('plateau du village', () => {
  it('est exactement plat au cœur', () => {
    expect(heightAt(0, -2.5)).toBe(0);
    expect(heightAt(2, 0)).toBe(0);
    expect(heightAt(-3, -4)).toBe(0);
  });

  it('getTerrainHeight reste un alias exact de heightAt', () => {
    for (const [x, z] of [
      [0, 0],
      [17, -23],
      [-140, 310],
    ]) {
      expect(getTerrainHeight(x!, z!)).toBe(heightAt(x!, z!));
    }
  });
});

describe('bassin habitable', () => {
  it('garde un relief doux sur toute la zone simulée', () => {
    // Le village et ses ressources vivent ici : sans cette garantie, les agents
    // se retrouveraient dans une falaise (spec §6, risque de migration assumé).
    // La borne basse laisse passer le lit de la rivière et rien d'autre.
    expect(BASIN_RADIUS).toBeGreaterThan(WORLD_SIZE / 2 - 10);
    for (let x = -WORLD_SIZE / 2; x <= WORLD_SIZE / 2; x += 2) {
      for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 2) {
        const y = heightAt(x, z);
        expect(y).toBeGreaterThan(-1.5);
        expect(y).toBeLessThan(5);
      }
    }
  });

  it('ne creuse sous zéro que dans le lit de la rivière', () => {
    for (let x = -WORLD_SIZE / 2; x <= WORLD_SIZE / 2; x += 1.5) {
      for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 1.5) {
        if (heightAt(x, z) < -0.05) {
          expect(Math.abs(x - riverCenterX(z))).toBeLessThan(4.0);
        }
      }
    }
  });

  it('ne noie jamais la zone simulée', () => {
    for (let x = -WORLD_SIZE / 2; x <= WORLD_SIZE / 2; x += 3) {
      for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 3) {
        expect(landMaskAt(x, z)).toBeGreaterThan(0.9);
      }
    }
  });
});

describe('relief lointain', () => {
  it('produit du dénivelé réel au-delà du bassin', () => {
    let max = -Infinity;
    for (let x = -1500; x <= 1500; x += 37) {
      for (let z = -1500; z <= 1500; z += 37) {
        max = Math.max(max, heightAt(x, z));
      }
    }
    expect(max).toBeGreaterThan(40);
  });

  it('creuse une mer sous le niveau zéro', () => {
    let min = Infinity;
    for (let x = -3000; x <= 3000; x += 53) {
      for (let z = -3000; z <= 3000; z += 53) {
        min = Math.min(min, heightAt(x, z));
      }
    }
    expect(min).toBeLessThan(-5);
  });

  it('reste continu : pas de falaise verticale entre deux échantillons voisins', () => {
    for (let x = -600; x < 600; x += 7) {
      const dy = Math.abs(heightAt(x + 0.5, 120) - heightAt(x, 120));
      expect(dy).toBeLessThan(6);
    }
  });

  it('est déterministe', () => {
    expect(heightAt(412.5, -733.25)).toBe(heightAt(412.5, -733.25));
  });
});

describe('rivière', () => {
  it('passe toujours au même endroit près du village', () => {
    expect(riverCenterX(0)).toBeCloseTo(4.0, 10);
    expect(isRiverAt(4.0, 0)).toBe(true);
    expect(isRiverAt(4.0 + 3.0, 0)).toBe(false);
    expect(isRiverAt(20, 0)).toBe(false);
  });

  it('sépare le lit de la berge', () => {
    expect(isShoreAt(4.0, 0)).toBe(false);
    expect(isShoreAt(4.0 + 3.0, 0)).toBe(true);
    expect(isShoreAt(4.0 + 9.0, 0)).toBe(false);
  });

  it('méandre à grande échelle', () => {
    expect(Math.abs(riverCenterX(400) - riverCenterX(0))).toBeGreaterThan(5);
  });

  it("ne bouge d'aucun millimètre dans la zone simulée", () => {
    // Verrou de non-régression : la formule historique, à laquelle les points
    // d'eau de DEFAULT_VILLAGE sont calés à la main.
    for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 0.5) {
      expect(riverCenterX(z)).toBeCloseTo(4.0 + Math.sin(z * 0.12) * 3.5, 12);
    }
  });

  it("garde le point d'eau river_bank(2.9, -8) dans le lit", () => {
    // Cet objet ne dispose que de 0,43 m de marge. Il est l'accès à l'eau du
    // camp Aube : s'il sort du lit, les agents ne peuvent plus boire.
    expect(isRiverAt(2.9, -8)).toBe(true);
    expect(isRiverAt(4.0, 0)).toBe(true);
  });
});

describe('slopeAt', () => {
  it('est nulle sur le plateau du village', () => {
    expect(slopeAt(0, -2.5)).toBeCloseTo(0, 6);
  });

  it('reste dans [0, π/2)', () => {
    for (let x = -800; x <= 800; x += 41) {
      const s = slopeAt(x, 250);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(Math.PI / 2);
    }
  });

  it("s'accorde avec la dérivée de heightAt", () => {
    // Auto-cohérence : si pente et hauteur divergeaient, la végétation se
    // planterait sur des falaises et la navigation croirait le sol plat.
    const x = 320;
    const z = -180;
    const e = 0.5;
    const hx = heightAt(x + e, z) - heightAt(x - e, z);
    const hz = heightAt(x, z + e) - heightAt(x, z - e);
    const expected = Math.atan(Math.hypot(hx, hz) / (2 * e));
    expect(slopeAt(x, z)).toBeCloseTo(expected, 10);
  });

  it('est plus forte en montagne que dans le bassin', () => {
    const basin = slopeAt(10, 10);
    let mountain = 0;
    for (let x = 400; x < 900; x += 13) mountain = Math.max(mountain, slopeAt(x, 400));
    expect(mountain).toBeGreaterThan(basin);
  });
});

describe('isWaterAt / depthAt', () => {
  it("n'a pas d'eau sous le village", () => {
    expect(isWaterAt(0, -2.5)).toBe(false);
    expect(depthAt(0, -2.5)).toBe(0);
  });

  it('trouve de la mer au large et lui donne une profondeur positive', () => {
    let found = false;
    for (let x = -3000; x <= 3000 && !found; x += 53) {
      for (let z = -3000; z <= 3000; z += 53) {
        if (isWaterAt(x, z)) {
          expect(depthAt(x, z)).toBeGreaterThan(0);
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('accorde exactement profondeur et hauteur', () => {
    for (let x = -2000; x <= 2000; x += 211) {
      const h = heightAt(x, 900);
      expect(depthAt(x, 900)).toBeCloseTo(Math.max(0, SEA_LEVEL - h), 10);
      expect(isWaterAt(x, 900)).toBe(h < SEA_LEVEL);
    }
  });
});
