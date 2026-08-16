import { describe, it, expect } from 'vitest';
import {
  getRiverCourse,
  riverProximityAt,
  historicalRiverX,
  PINNED_HALF_LENGTH,
} from '../src/world/flow';
import { SEA_LEVEL, VILLAGE_ELEVATION, WORLD_SIZE } from '../src/world/relief';

describe('le cours', () => {
  const course = getRiverCourse();

  it('a une longueur crédible et des points ordonnés', () => {
    expect(course.points.length).toBeGreaterThan(50);
    expect(course.length).toBeGreaterThan(400);
  });

  it("DESCEND : son altitude ne remonte jamais vers l'aval", () => {
    // C'est la propriété qui distingue une rivière d'une rainure.
    for (let i = 1; i < course.points.length; i++) {
      expect(
        course.points[i]!.elevation,
        `point ${i} en (${course.points[i]!.x.toFixed(0)}, ${course.points[i]!.z.toFixed(0)})`,
      ).toBeLessThanOrEqual(course.points[i - 1]!.elevation + 1e-9);
    }
  });

  it('part au-dessus du village et finit à la mer', () => {
    const source = course.points[0]!;
    const mouth = course.points[course.points.length - 1]!;
    expect(source.elevation).toBeGreaterThan(VILLAGE_ELEVATION);
    expect(mouth.elevation).toBeLessThanOrEqual(SEA_LEVEL);
  });

  it("s'élargit vers l'aval", () => {
    expect(course.points[course.points.length - 1]!.width).toBeGreaterThan(
      course.points[0]!.width,
    );
  });

  it('avance sans sauts : deux points consécutifs restent proches', () => {
    for (let i = 1; i < course.points.length; i++) {
      const a = course.points[i - 1]!;
      const b = course.points[i]!;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(12);
    }
  });

  it('est mémorisé : deux appels rendent le même objet', () => {
    expect(getRiverCourse()).toBe(course);
  });
});

describe('épinglage sur la formule historique', () => {
  it("passe EXACTEMENT par l'axe d'origine dans la zone simulée", () => {
    // Les deux points d'eau de DEFAULT_VILLAGE y sont calés à la main, l'un
    // avec 0,43 m de marge. Un cours qui dérive ici assoiffe le village.
    const course = getRiverCourse();
    for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 4) {
      const expected = historicalRiverX(z);
      // On cherche s'il EXISTE un point du cours sur l'axe historique. Filtrer
      // par proximité en z seul ramènerait aussi des points d'amont ou d'aval
      // qui traversent la même latitude ailleurs.
      const onAxis = course.points.some(
        (p) => Math.abs(p.z - z) < 3.5 && Math.abs(p.x - expected) < 1.2,
      );
      expect(onAxis, `aucun point de cours sur l'axe historique à z=${z}`).toBe(true);
    }
  });

  it('conserve la formule historique elle-même', () => {
    expect(historicalRiverX(0)).toBeCloseTo(4.0, 10);
    expect(historicalRiverX(-8)).toBeCloseTo(4.0 + Math.sin(-8 * 0.12) * 3.5, 10);
    expect(PINNED_HALF_LENGTH).toBeGreaterThanOrEqual(WORLD_SIZE / 2);
  });
});

describe('riverProximityAt', () => {
  it("rend une distance nulle sur l'axe et croissante en s'écartant", () => {
    const onAxis = riverProximityAt(historicalRiverX(0), 0);
    expect(onAxis.distance).toBeLessThan(3.5);
    const off = riverProximityAt(historicalRiverX(0) + 20, 0);
    expect(off.distance).toBeGreaterThan(15);
  });

  it("s'accorde avec une recherche exhaustive sur la polyligne", () => {
    // L'index spatial est une optimisation : il doit rendre EXACTEMENT ce que
    // rendrait le parcours complet, sinon la rivière se déplacerait selon la
    // manière dont on l'interroge.
    const course = getRiverCourse();
    for (const [x, z] of [
      [0, 0],
      [40, -40],
      [-120, 30],
      [12, 90],
    ]) {
      let brute = Infinity;
      for (const p of course.points) brute = Math.min(brute, Math.hypot(p.x - x!, p.z - z!));
      expect(riverProximityAt(x!, z!).distance, `(${x}, ${z})`).toBeCloseTo(brute, 6);
    }
  });

  it('rend une distance finie loin de tout', () => {
    const far = riverProximityAt(5000, 5000);
    expect(Number.isFinite(far.distance)).toBe(true);
    expect(far.distance).toBeGreaterThan(1000);
  });

  it('porte une altitude qui suit celle du cours', () => {
    const atVillage = riverProximityAt(historicalRiverX(0), 0);
    const mouth = getRiverCourse().points[getRiverCourse().points.length - 1]!;
    expect(atVillage.elevation).toBeGreaterThan(mouth.elevation);
  });
});
