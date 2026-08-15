import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component for 3D spatial subtitles and floating speech bubbles above NPCs.
 */
export const SpatialDialogueUI = createComponent(
  'SpatialDialogueUI',
  {
    /** Vertical offset above the NPC entity origin in meters */
    bubbleHeight: { type: Types.Float32, default: 1.85 },
    /** Whether to show animated thinking ellipses during LLM inference */
    showThinkingIndicator: { type: Types.Boolean, default: true },
    /** Maximum duration to keep speech bubble visible after speech ends */
    dismissTimeoutMs: { type: Types.Float32, default: 5000 },
    /** Timestamp when current subtitle text was displayed */
    displayStartTime: { type: Types.Float64, default: 0.0 },
    /** Index of the current active word for karaoke-style highlighting */
    activeWordIndex: { type: Types.Int32, default: 0 },
  },
  '3D spatial speech bubble and UIKitML subtitle descriptor',
);
