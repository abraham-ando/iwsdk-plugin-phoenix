import { biomeAt, type BiomeId } from './biomes';
import { slopeAt } from './terrain';
import { distanceToVillage } from './relief';

/**
 * Le semis appartient à la vérité terrain (spec §8).
 *
 * Le moteur y instancie les smart objects exploitables, le rendu y instancie
 * les maillages — la MÊME fonction. Sans cette discipline, les agents
 * bûcheronneraient des arbres invisibles pendant que la forêt visible
 * resterait inerte.
 */

/** Même grille que les tuiles de terrain de la phase 3B. */
export const SCATTER_TILE = 32;

export type FloraSpecies = 'oak' | 'aspen' | 'bush';

export const FLORA_SPECIES: readonly FloraSpecies[] = ['oak', 'aspen', 'bush'];

export interface ScatterItem {
  readonly species: FloraSpecies;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly rotationY: number;
}

/** Rayon autour du village où rien n'est semé : le contenu y est calé à la main. */
const VILLAGE_KEEP_OUT = 14;

/** Au-delà, la pente ne retient plus la terre. */
const MAX_SLOPE = 0.65;

/** Côté de la grille de candidats. Six par six, soit trente-six par tuile. */
const GRID_SIDE = 6;

/**
 * Densité par biome, dans [0, 1] : la fraction de candidats qui prend racine.
 *
 * La forêt est plafonnée à 0,48 et non davantage : à trente-six candidats par
 * tuile, une densité plus forte dépassait vingt-quatre plants, et le budget de
 * rendu ne suit pas — 500 000 triangles au total, dont 42 000 déjà pris par le
 * terrain.
 */
const DENSITY: Readonly<Record<BiomeId, number>> = {
  ocean: 0,
  beach: 0.02,
  wetland: 0.18,
  grassland: 0.12,
  forest: 0.48,
  rock: 0.03,
  alpine: 0,
};

/** Espèce dominante par biome ; le hachage tranche entre elle et le buisson. */
const DOMINANT: Readonly<Record<BiomeId, FloraSpecies>> = {
  ocean: 'bush',
  beach: 'bush',
  wetland: 'aspen',
  grassland: 'bush',
  forest: 'oak',
  rock: 'bush',
  alpine: 'bush',
};

/** Hachage sans état, même mélange splitmix32 que le bruit du terrain. */
function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 0x1_0000_0000;
}

export function scatterAt(tileX: number, tileZ: number): readonly ScatterItem[] {
  const items: ScatterItem[] = [];
  const originX = tileX * SCATTER_TILE;
  const originZ = tileZ * SCATTER_TILE;
  const cell = SCATTER_TILE / GRID_SIDE;

  for (let i = 0; i < GRID_SIDE * GRID_SIDE; i++) {
    // Grille perturbée : assez régulière pour ne pas s'agglutiner, assez
    // désordonnée pour ne pas se voir. Le décalage reste dans la cellule, donc
    // le plant reste dans sa tuile — par construction, pas par chance.
    const gx = i % GRID_SIDE;
    const gz = Math.floor(i / GRID_SIDE);
    const jitterX = hash3(tileX, tileZ, i * 3 + 1);
    const jitterZ = hash3(tileX, tileZ, i * 3 + 2);
    const x = originX + (gx + jitterX * 0.98 + 0.01) * cell;
    const z = originZ + (gz + jitterZ * 0.98 + 0.01) * cell;

    if (distanceToVillage(x, z) <= VILLAGE_KEEP_OUT) continue;
    if (slopeAt(x, z) >= MAX_SLOPE) continue;

    const biome = biomeAt(x, z).primary;
    if (hash3(tileX, tileZ, i * 3 + 3) >= DENSITY[biome]) continue;

    // Le sous-bois pousse partout ; l'espèce dominante domine sans monopoliser.
    const speciesRoll = hash3(tileX + 7717, tileZ - 3313, i);
    const species = speciesRoll < 0.72 ? DOMINANT[biome] : 'bush';

    items.push({
      species,
      x,
      z,
      scale: 0.7 + hash3(tileX - 101, tileZ + 211, i) * 1.1,
      rotationY: hash3(tileX + 5501, tileZ + 4409, i) * Math.PI * 2,
    });
  }

  return items;
}
