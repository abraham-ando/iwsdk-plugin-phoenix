import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component configuring spontaneous autonomous banter between nearby NPCs.
 */
export const NPCBanter = createComponent(
  'NPCBanter',
  {
    /** Likelihood of initiating banter when meeting another NPC [0.0 - 1.0] */
    talkativeness: { type: Types.Float32, default: 0.7 },
    /** Maximum distance in meters to detect another NPC for banter */
    banterRadius: { type: Types.Float32, default: 3.5 },
    /** Minimum cooldown duration in ms between consecutive banter sessions */
    cooldownMs: { type: Types.Float32, default: 15000 },
    /** Timestamp of the last banter interaction */
    lastBanterTime: { type: Types.Float64, default: 0.0 },
    /** True while currently engaged in an active banter dialogue */
    isBantering: { type: Types.Boolean, default: false },
  },
  'Autonomous social banter between nearby NPCs',
);
