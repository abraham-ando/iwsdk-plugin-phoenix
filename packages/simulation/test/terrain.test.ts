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
  landMaskAt,
  VILLAGE_ELEVATION,
  dryReliefAt,
  riverSurfaceAt,
  slopeAt,
  isWaterAt,
  depthAt,
} from '../src/world/terrain';
import { getRiverCourse, riverProximityAt, historicalRiverX } from '../src/world/flow';

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
  it('est exactement plat, et AU-DESSUS du niveau de la mer', () => {
    // Un plateau au niveau de la mer ne donne aucune charge hydraulique :
    // la rivière n'aurait nulle part où descendre (spec §6 bis).
    expect(VILLAGE_ELEVATION).toBeGreaterThan(SEA_LEVEL + 3);
    // Plat À L'ÉCART DE LA RIVIÈRE : celle-ci traverse le village et y creuse
    // son chenal, ce qui est le comportement voulu — un village au bord de
    // l'eau a une berge, pas une dalle.
    // Plat au centimètre À L'ÉCART DE LA RIVIÈRE : celle-ci traverse le
    // village et y creuse son chenal, ce qui est voulu — un village au bord de
    // l'eau a une berge, pas une dalle. Le cours redescend ensuite vers
    // l'ouest, effleurant le flanc du plateau.
    for (const [x, z] of [
      [-4, -2.5],
      [-5, -4],
    ]) {
      expect(heightAt(x!, z!), `(${x}, ${z})`).toBeCloseTo(VILLAGE_ELEVATION, 1);
    }
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
        expect(y).toBeGreaterThan(VILLAGE_ELEVATION - 8);
        expect(y).toBeLessThan(VILLAGE_ELEVATION + 6);
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
  it("garde les deux points d'eau du village dans le lit", () => {
    // river_bank(2.9, -8) ne dispose que de 0,43 m de marge : c'est la
    // contrainte la plus serrée de tout le projet.
    expect(isRiverAt(4.0, 0)).toBe(true);
    expect(isRiverAt(2.9, -8)).toBe(true);
  });

  it('sépare le lit, la berge et la terre ferme', () => {
    expect(isRiverAt(4.0 + 25, 0)).toBe(false);
    expect(isShoreAt(4.0, 0)).toBe(false);
    expect(isShoreAt(4.0 + 25, 0)).toBe(false);
  });

  it('creuse : le lit est plus bas que ses abords', () => {
    for (const z of [-40, -20, 0, 20, 40]) {
      const x = historicalRiverX(z);
      const river = riverProximityAt(x, z);
      if (river.distance > 2) continue;
      // On compare au BORD de la vallée, non à un point lointain : le village
      // est une butte, tout point éloigné est plus bas que lui.
      expect(heightAt(x, z), `à z=${z}`).toBeLessThan(heightAt(x - river.width * 3, z));
    }
  });
});

describe("l'entaille ne remonte jamais le sol", () => {
  it('reste partout sous le relief sec ou à son niveau', () => {
    // Invariant central : formulé avec Math.min, il rend impossible qu'une
    // rivière se retrouve perchée sur une crête.
    for (let x = -600; x <= 600; x += 23) {
      for (let z = -600; z <= 600; z += 23) {
        if (Math.hypot(x, z + 2.5) < 40) continue; // le plateau surélève, c'est voulu
        expect(heightAt(x, z), `(${x}, ${z})`).toBeLessThanOrEqual(dryReliefAt(x, z) + 1e-9);
      }
    }
  });

  it('ne touche pas au terrain loin du cours', () => {
    let untouched = 0;
    for (let x = -600; x <= 600; x += 37) {
      for (let z = -600; z <= 600; z += 37) {
        if (riverProximityAt(x, z).distance < 40) continue;
        if (Math.hypot(x, z + 2.5) < 40) continue;
        untouched++;
        expect(heightAt(x, z)).toBeCloseTo(dryReliefAt(x, z), 6);
      }
    }
    expect(untouched).toBeGreaterThan(100);
  });
});

describe('riverSurfaceAt', () => {
  it("rend une nappe qui descend vers l'aval", () => {
    const atVillage = riverSurfaceAt(historicalRiverX(0), 0);
    const mouth = getRiverCourse().points[getRiverCourse().points.length - 1]!;
    expect(atVillage).toBeGreaterThan(mouth.elevation);
  });

  it('pose la nappe au-dessus du lit', () => {
    const x = historicalRiverX(0);
    expect(riverSurfaceAt(x, 0)).toBeGreaterThan(heightAt(x, 0));
  });
});

describe('slopeAt', () => {
  it('est quasi nulle sur le plateau, à l\'écart de la rivière', () => {
    expect(slopeAt(-5, -4)).toBeLessThan(0.02);
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


describe('géographie', () => {
  it('laisse de vraies plaines entre les chaînes de montagnes', () => {
    // Sans masque de chaînes, ridgedFbm leve des cretes sur TOUTE la surface :
    // un monde integralement montagneux, sans plaine donc sans riviere.
    let lowland = 0;
    let highland = 0;
    let n = 0;
    for (let x = -2500; x <= 2500; x += 61) {
      for (let z = -2500; z <= 2500; z += 61) {
        if (landMaskAt(x, z) < 0.9) continue;
        const h = heightAt(x, z);
        n++;
        if (h < 15) lowland++;
        if (h > 45) highland++;
      }
    }
    expect(n).toBeGreaterThan(100);
    // Les deux doivent exister : ni plaine partout, ni montagne partout.
    expect(lowland / n, 'proportion de plaine').toBeGreaterThan(0.25);
    expect(highland / n, 'proportion de haute montagne').toBeGreaterThan(0.02);
  });
});

