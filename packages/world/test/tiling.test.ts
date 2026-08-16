import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE,
  LOD_SEGMENTS,
  MAX_RING,
  tileIndexFor,
  tileOriginX,
  tileOriginZ,
  tileKey,
  lodForRing,
  desiredTiles,
  diffTiles,
  type TileSpec,
} from '../src/terrain/tiling';

describe('coordonnées de tuile', () => {
  it('range chaque point dans la tuile qui le contient', () => {
    expect(tileIndexFor(0)).toBe(0);
    expect(tileIndexFor(TILE_SIZE - 0.001)).toBe(0);
    expect(tileIndexFor(TILE_SIZE)).toBe(1);
    expect(tileIndexFor(-0.001)).toBe(-1);
    expect(tileIndexFor(-TILE_SIZE)).toBe(-1);
    expect(tileIndexFor(-TILE_SIZE - 0.001)).toBe(-2);
  });

  it("rend une origine cohérente avec l'index", () => {
    for (const t of [-3, -1, 0, 2, 7]) {
      expect(tileIndexFor(tileOriginX(t))).toBe(t);
      expect(tileIndexFor(tileOriginZ(t) + TILE_SIZE / 2)).toBe(t);
    }
  });

  it('donne une clé unique par tuile', () => {
    const keys = new Set<string>();
    for (let tx = -4; tx <= 4; tx++) for (let tz = -4; tz <= 4; tz++) keys.add(tileKey(tx, tz));
    expect(keys.size).toBe(81);
  });
});

describe('niveaux de détail', () => {
  it('dégrade la résolution avec la distance, sans saut', () => {
    expect(lodForRing(0)).toBe(0);
    expect(lodForRing(1)).toBe(0);
    expect(lodForRing(MAX_RING)).toBe(LOD_SEGMENTS.length - 1);
    expect(lodForRing(MAX_RING + 1)).toBe(-1);
    let previous = 0;
    for (let ring = 0; ring <= MAX_RING; ring++) {
      const lod = lodForRing(ring);
      expect(lod).toBeGreaterThanOrEqual(previous);
      expect(lod - previous).toBeLessThanOrEqual(1); // jamais deux crans d'un coup
      previous = lod;
    }
  });

  it('déclare une résolution décroissante et divisible', () => {
    for (let i = 1; i < LOD_SEGMENTS.length; i++) {
      expect(LOD_SEGMENTS[i]!).toBeLessThan(LOD_SEGMENTS[i - 1]!);
      // Chaque niveau divise le précédent : les bords s'alignent sur un sommet
      // sur deux, ce qui rend les fissures régulières et donc masquables.
      expect(LOD_SEGMENTS[i - 1]! % LOD_SEGMENTS[i]!).toBe(0);
    }
  });
});

describe('desiredTiles', () => {
  it('couvre un carré complet autour du joueur', () => {
    const tiles = desiredTiles(0, 0);
    const side = 2 * MAX_RING + 1;
    expect(tiles.length).toBe(side * side);
  });

  it('centre la pleine résolution sur le joueur', () => {
    const tiles = desiredTiles(0, 0);
    const centre = tiles.find((t) => t.tx === 0 && t.tz === 0);
    expect(centre?.lod).toBe(0);
  });

  it('suit le joueur', () => {
    const cx = tileIndexFor(1000);
    const cz = tileIndexFor(-1000);
    const far = desiredTiles(1000, -1000);
    // La tuile du centre EXACT, pas la première venue au bon niveau : trois
    // tuiles partagent ce tx au niveau 0.
    const centre = far.find((t) => t.tx === cx && t.tz === cz);
    expect(centre).toBeDefined();
    expect(centre!.lod).toBe(0);
    // Et rien ne traîne autour de l'origine.
    expect(far.some((t) => t.tx === 0 && t.tz === 0)).toBe(false);
  });

  it('EST STABLE tant que le joueur reste dans sa tuile', () => {
    // Sinon chaque pas du joueur reconstruirait le monde entier.
    const a = desiredTiles(1, 1);
    const b = desiredTiles(TILE_SIZE - 1, TILE_SIZE - 1);
    expect(a.map((t) => tileKey(t.tx, t.tz)).sort()).toEqual(
      b.map((t) => tileKey(t.tx, t.tz)).sort(),
    );
  });

  it('ne demande jamais deux fois la même tuile', () => {
    const tiles = desiredTiles(53, -87);
    const keys = tiles.map((t) => tileKey(t.tx, t.tz));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('diffTiles', () => {
  const spec = (tx: number, tz: number, lod: number): TileSpec => ({ tx, tz, lod });

  it("demande tout quand rien n'existe", () => {
    const desired = [spec(0, 0, 0), spec(1, 0, 1)];
    const diff = diffTiles(new Map(), desired);
    expect(diff.toBuild).toHaveLength(2);
    expect(diff.toRemove).toHaveLength(0);
  });

  it('ne redemande pas une tuile déjà au bon niveau', () => {
    const current = new Map([[tileKey(0, 0), spec(0, 0, 0)]]);
    const diff = diffTiles(current, [spec(0, 0, 0)]);
    expect(diff.toBuild).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
  });

  it('RECONSTRUIT une tuile dont le niveau de détail a changé', () => {
    // Le joueur s'approche : une tuile lointaine doit gagner en résolution.
    const current = new Map([[tileKey(2, 0), spec(2, 0, 2)]]);
    const diff = diffTiles(current, [spec(2, 0, 0)]);
    expect(diff.toBuild).toEqual([spec(2, 0, 0)]);
    expect(diff.toRemove).toEqual([tileKey(2, 0)]);
  });

  it("retire ce qui n'est plus voulu", () => {
    const current = new Map([
      [tileKey(0, 0), spec(0, 0, 0)],
      [tileKey(9, 9), spec(9, 9, 2)],
    ]);
    const diff = diffTiles(current, [spec(0, 0, 0)]);
    expect(diff.toRemove).toEqual([tileKey(9, 9)]);
    expect(diff.toBuild).toHaveLength(0);
  });
});
