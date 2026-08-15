import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component marking an entity as an intelligent NPC powered by the Cardinal AI subsystem.
 *
 * @remarks
 * Uses flat typed arrays column-wise via `elics` to avoid per-entity JS heap allocations.
 */
export const SmartNPC = createComponent(
  'SmartNPC',
  {
    /** Numeric archetype/personality identifier */
    personalityId: { type: Types.Int32, default: 0 },
    /** True when an inference task is active for this NPC */
    isThinking: { type: Types.Boolean, default: false },
    /** Maximum distance in meters to trigger proximity-based interaction */
    interactionRadius: { type: Types.Float32, default: 3.0 },
    /** `performance.now()` timestamp of the last query */
    lastDecisionTime: { type: Types.Float64, default: 0 },
    /** Minimum duration in ms between consecutive queries */
    cooldownMs: { type: Types.Float32, default: 1000 },
  },
  'Edge AI cognitive component for local NPC decision and dialogue',
);
