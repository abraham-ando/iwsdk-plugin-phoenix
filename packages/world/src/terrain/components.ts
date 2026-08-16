import { Types, createComponent } from '@iwsdk/core';

/**
 * Une tuile de terrain streamée (spec §6). `_needsBuild` suit la convention
 * des composants d'environnement d'IWSDK (`DomeGradient._needsUpdate`) : le
 * système qui consomme le drapeau est aussi celui qui le baisse.
 */
export const TerrainTile = createComponent(
  'TerrainTile',
  {
    tx: { type: Types.Int16, default: 0 },
    tz: { type: Types.Int16, default: 0 },
    lod: { type: Types.Int16, default: 0 },
    _needsBuild: { type: Types.Boolean, default: true },
  },
  'Streamed terrain tile',
);
