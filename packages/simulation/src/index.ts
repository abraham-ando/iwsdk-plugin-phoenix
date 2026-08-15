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
export {
  createDefaultNeeds,
  decayNeeds,
  urgency,
  wellbeingCost,
  isNightHour,
  clampNeed,
  type NeedId,
  type AgentNeeds,
  type NeedContext,
} from './agents/needs';
export {
  defaultIntrinsics,
  checkIntrinsic,
  applyIntrinsic,
  invTotal,
  INVENTORY_CAPACITY,
  type IntrinsicActionDef,
} from './agents/intrinsics';
export {
  perceive,
  DAY_VISION,
  NIGHT_VISION,
  HEARING_RADIUS,
  type Observation,
  type ObservedObject,
  type PerceivedAgent,
} from './agents/Perception';
export { BeliefState, type Belief } from './agents/BeliefState';
export { stepToward, WALK_SPEED, ARRIVE_RADIUS } from './agents/navigation';
export {
  createAgent,
  type AgentProfile,
  type AgentState,
  type CurrentAction,
} from './agents/AgentState';
export { executeActionTick, type ActionEvent } from './agents/actions';
export { selectAction } from './agents/Mode1';
export { AgentRuntime, type AgentView } from './agents/AgentRuntime';
