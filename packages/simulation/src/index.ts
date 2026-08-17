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
export {
  WORLD_SIZE,
  SEA_LEVEL,
  PLATEAU_RADIUS,
  BASIN_RADIUS,
  heightAt,
  getTerrainHeight,
  slopeAt,
  isWaterAt,
  depthAt,
  isRiverAt,
  isShoreAt,
  riverSurfaceAt,
  landMaskAt,
  dryReliefAt,
  VILLAGE_ELEVATION,
  VALLEY_RATIO,
} from './world/terrain';
export {
  getRiverCourse,
  riverProximityAt,
  historicalRiverX,
  PINNED_HALF_LENGTH,
  type CoursePoint,
  type RiverCourse,
  type RiverProximity,
} from './world/flow';
export { BIOME_IDS, biomeAt, classifyBiome, humidityAt, type BiomeId, type BiomeSample } from './world/biomes';
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
  DEFAULT_VILLAGE,
  SETTLEMENTS,
  buildVillageSim,
  type Settlement,
  type ScenarioObject,
  type ScenarioAgent,
  type ScenarioPlace,
  type VillageSim,
} from './content/scenario';
export {
  MetricsCollector,
  METRICS_SAMPLE_PERIOD,
  type RunMetrics,
  type AgentMetrics,
} from './telemetry/MetricsCollector';
export {
  TrajectoryRecorder,
  EPISODE_SNAPSHOT_PERIOD,
  type TrajectoryBatch,
} from './telemetry/TrajectoryRecorder';
export { mockPlanResponse } from './telemetry/MockPlanner';
export { contentVerbs } from './content/verbs';
export {
  buildSystemPrompt,
  extractPlanJson,
  planEnvelope,
  planWithTiers,
  maxTokensFor,
  type Planner,
  type PlanTier,
} from './agents/deliberation';
export {
  toChatSft,
  toWorldModelSft,
  splitTrainValid,
  datasetSummary,
  WORLD_MODEL_SYSTEM_PROMPT,
  type SftRecord,
  type SftMessage,
  type ExportOptions,
  type DatasetSummary,
} from './telemetry/datasetExport';
export {
  GroundTruthWorld,
  type NamedPlace,
  type WorldSnapshot,
} from './world/GroundTruthWorld';
export { snapshotSim, restoreSim, type SimSnapshot, type SerializedAgent } from './kernel/snapshot';
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
  type PlannedStep,
  type Mode2State,
} from './agents/AgentState';
export { executeActionTick, type ActionEvent } from './agents/actions';
export { selectAction } from './agents/Mode1';
export {
  buildPlanRequest,
  parsePlanSteps,
  type PlanRequest,
  type PlanRequestReason,
  type PlanToolCandidate,
} from './agents/Mode2';
export { AgentRuntime, type AgentView } from './agents/AgentRuntime';
export { WeatherMachine, WEATHER_CHECK_PERIOD, type WeatherState } from './world/WeatherMachine';
export { WolfSystem, type WolfState, type WolfMode } from './world/WolfSystem';
export {
  MemoryStream,
  MEMORY_CAPACITY,
  type MemoryEntry,
  type MemoryKind,
} from './agents/MemoryStream';
export {
  scatterAt,
  SCATTER_TILE,
  FLORA_SPECIES,
  type FloraSpecies,
  type ScatterItem,
} from './world/scatter';
