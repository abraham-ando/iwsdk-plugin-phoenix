import { Types, createComponent } from '@iwsdk/core';

export const AILODLevel = {
  FULL: 0,
  MEDIUM: 1,
  LOW: 2,
  CULLED: 3,
} as const;

export type AILODLevelValue = typeof AILODLevel[keyof typeof AILODLevel];

/**
 * ECS component configuring dynamic Level of Detail (LOD) for 90 FPS performance on Meta Quest.
 */
export const AILOD = createComponent(
  'AILOD',
  {
    /** Current LOD tier: 0 = FULL (<3m), 1 = MEDIUM (3-8m), 2 = LOW (8-15m), 3 = CULLED (>15m) */
    lodLevel: { type: Types.Int32, default: 0 },
    /** Current Euclidean distance to active VR player headset in meters */
    distanceToPlayer: { type: Types.Float32, default: 0.0 },
    /** Recommended throttling update interval in milliseconds */
    updateIntervalMs: { type: Types.Float32, default: 0.0 },
    /** Timestamp of the last processed frame for this entity */
    lastUpdateTime: { type: Types.Float64, default: 0.0 },
  },
  'Dynamic Level-of-Detail and mobile VR throttling manager for NPCs',
);
