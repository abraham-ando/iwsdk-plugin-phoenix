export {
  detectQuality,
  readQualityEnv,
  WORLD_PACKAGE_NAME,
  type QualityTier,
  type QualityEnv,
} from './core/quality';
export {
  solarPosition,
  declinationForDayOfYear,
  type SolarPosition,
} from './atmosphere/solar';
export { skyAppearance, type SkyAppearance, type WeatherKind } from './atmosphere/skyColors';
export { CelestialTime, SkyModel, StarField, WEATHER_KINDS } from './atmosphere/components';
export { CelestialTimeSystem } from './atmosphere/CelestialTimeSystem';
export { SkyRenderSystem, IBL_REFRESH_ELEVATION_DEG } from './atmosphere/SkyRenderSystem';
export { StarFieldSystem } from './atmosphere/StarFieldSystem';
export {
  installCardinalWorld,
  withLevelRoot,
  type CardinalWorldOptions,
} from './install';
export { valueNoise2D, fbm2D, ridged2D } from './materials/noise';
export {
  MATERIAL_DEFINITIONS,
  MATERIAL_IDS,
  type MaterialId,
  type MaterialDefinition,
} from './materials/definitions';
export {
  generateHeightField,
  generateAlbedo,
  generateORM,
  generateNormal,
} from './materials/textureData';
export { MaterialLibrary, TEXTURE_SIZE } from './materials/MaterialLibrary';
export { ProceduralMaterial } from './materials/components';
export { MaterialSystem } from './materials/MaterialSystem';
export { ExposureSystem } from './atmosphere/ExposureSystem';
export { applyColorManagement } from './core/colorManagement';

export { TerrainTile } from './terrain/components';
export { TerrainStreamingSystem } from './terrain/TerrainStreamingSystem';
export { TerrainMeshSystem } from './terrain/TerrainMeshSystem';
export {
  TILE_SIZE,
  MAX_RING,
  LOD_SEGMENTS,
  desiredTiles,
  diffTiles,
  lodForRing,
  tileIndexFor,
  tileKey,
  tileOriginX,
  tileOriginZ,
  type TileSpec,
  type TileDiff,
} from './terrain/tiling';
export { sampleTile, BIOME_RGB, type TileSample } from './terrain/sampling';
export { buildTileGeometry, tileVertexCount, tileTriangleCount, SKIRT_DEPTH } from './terrain/geometry';

export { WaterSurface } from './water/components';
export { WaterSystem } from './water/WaterSystem';
export {
  createWaterMaterial,
  buildWaterUniforms,
  waterVertexShader,
  waterFragmentShader,
  WATER_UNIFORM_NAMES,
} from './water/WaterMaterial';
export {
  buildRiverGeometry,
  riverVertexCount,
  RIVER_COLUMNS,
  WATER_EDGE_LIFT,
} from './water/riverGeometry';
export {
  RIVER_WAVES_LOW,
  totalSteepness,
  gerstnerDisplacement,
  type GerstnerWave,
} from './water/waves';

export { FloraTile } from './flora/components';
export { FloraSystem } from './flora/FloraSystem';
export {
  parseFloraManifest,
  loadFloraAssets,
  type FloraAsset,
  type FloraLod,
} from './flora/floraAssets';

export { SmartObjectVisual, AnimalVisual } from './objects/components';
export { SmartObjectVisualSystem } from './objects/SmartObjectVisualSystem';
export { FaunaSystem } from './objects/FaunaSystem';
export { visualStateFor, VISUAL_TYPES, type ObjectVisualState } from './objects/visualState';
