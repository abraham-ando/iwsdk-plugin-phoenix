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
export {
  SmartObjectRegistry,
  type Comparison,
  type AffordanceDef,
  type SmartObjectDef,
  type SmartObjectInstance,
} from './world/SmartObject';
export {
  compare,
  checkAffordance,
  applyAffordance,
  type ActorContext,
  type AffordanceCheck,
} from './world/affordances';
export { registerDefaultContent } from './content/objects';
export {
  GroundTruthWorld,
  type NamedPlace,
  type WorldSnapshot,
} from './world/GroundTruthWorld';
export { snapshotSim, restoreSim, type SimSnapshot } from './kernel/snapshot';
