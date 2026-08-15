export const ENGINE_NAME = '@iwsdk/cardinal-simulation';

export { Rng, type RngState } from './kernel/Rng';
export { EventLog, type ExternalEvent } from './kernel/EventLog';
export {
  SimKernel,
  TICK_MS,
  TICKS_PER_DAY,
  hourOfDay,
  type TickContext,
  type TickHandler,
} from './kernel/SimKernel';
export { SpatialGrid } from './world/SpatialGrid';
export { WORLD_SIZE, getTerrainHeight, isRiverAt, isShoreAt } from './world/terrain';
