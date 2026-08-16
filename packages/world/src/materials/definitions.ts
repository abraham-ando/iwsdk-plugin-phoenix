/**
 * The material catalogue (spec §5). Each entry is a recipe, not an asset:
 * two palette colours, a noise pattern, and a roughness range. Adding a
 * material is adding a row here — no texture files, no downloads.
 */
export type MaterialId =
  | 'rock'
  | 'sand'
  | 'grass'
  | 'bark'
  | 'foliage'
  | 'hide'
  | 'flint'
  | 'clay';

export interface MaterialDefinition {
  id: MaterialId;
  /** Palette endpoints in [0,1] RGB; height blends between them. */
  low: [number, number, number];
  high: [number, number, number];
  pattern: 'fbm' | 'ridged';
  /** Noise cycles across one texture tile. */
  frequency: number;
  octaves: number;
  roughnessLow: number;
  roughnessHigh: number;
  normalStrength: number;
  seed: number;
}

export const MATERIAL_DEFINITIONS: Record<MaterialId, MaterialDefinition> = {
  rock: {
    id: 'rock',
    low: [0.28, 0.27, 0.26],
    high: [0.55, 0.53, 0.5],
    pattern: 'ridged',
    frequency: 6,
    octaves: 5,
    roughnessLow: 0.75,
    roughnessHigh: 0.95,
    normalStrength: 2.4,
    seed: 101,
  },
  sand: {
    id: 'sand',
    low: [0.62, 0.5, 0.33],
    high: [0.85, 0.74, 0.55],
    pattern: 'fbm',
    frequency: 14,
    octaves: 3,
    roughnessLow: 0.82,
    roughnessHigh: 0.95,
    normalStrength: 0.7,
    seed: 202,
  },
  grass: {
    id: 'grass',
    low: [0.13, 0.26, 0.08],
    high: [0.38, 0.55, 0.18],
    pattern: 'fbm',
    frequency: 10,
    octaves: 4,
    roughnessLow: 0.7,
    roughnessHigh: 0.92,
    normalStrength: 1.1,
    seed: 303,
  },
  bark: {
    id: 'bark',
    low: [0.16, 0.11, 0.07],
    high: [0.38, 0.28, 0.19],
    pattern: 'ridged',
    frequency: 3,
    octaves: 4,
    roughnessLow: 0.78,
    roughnessHigh: 0.96,
    normalStrength: 2.8,
    seed: 404,
  },
  foliage: {
    id: 'foliage',
    low: [0.09, 0.22, 0.07],
    high: [0.3, 0.48, 0.16],
    pattern: 'fbm',
    frequency: 8,
    octaves: 3,
    roughnessLow: 0.6,
    roughnessHigh: 0.85,
    normalStrength: 1.4,
    seed: 505,
  },
  hide: {
    id: 'hide',
    low: [0.32, 0.22, 0.14],
    high: [0.58, 0.44, 0.3],
    pattern: 'fbm',
    frequency: 5,
    octaves: 3,
    roughnessLow: 0.65,
    roughnessHigh: 0.88,
    normalStrength: 1.0,
    seed: 606,
  },
  flint: {
    id: 'flint',
    low: [0.14, 0.15, 0.17],
    high: [0.42, 0.44, 0.48],
    pattern: 'ridged',
    frequency: 9,
    octaves: 4,
    roughnessLow: 0.28,
    roughnessHigh: 0.55,
    normalStrength: 2.0,
    seed: 707,
  },
  clay: {
    id: 'clay',
    low: [0.4, 0.24, 0.16],
    high: [0.66, 0.44, 0.31],
    pattern: 'fbm',
    frequency: 7,
    octaves: 3,
    roughnessLow: 0.7,
    roughnessHigh: 0.9,
    normalStrength: 0.9,
    seed: 808,
  },
};

export const MATERIAL_IDS = Object.keys(MATERIAL_DEFINITIONS) as MaterialId[];
