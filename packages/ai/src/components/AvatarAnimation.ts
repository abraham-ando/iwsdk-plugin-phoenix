import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component tracking Ready Player Me avatar animation playback state.
 */
export const AvatarAnimation = createComponent(
  'AvatarAnimation',
  {
    /** Gender archetype for animation retargeting (0 = masculine, 1 = feminine) */
    gender: { type: Types.Int32, default: 0 },
    /** True when the avatar is currently speaking and playing a talking loop */
    isTalking: { type: Types.Boolean, default: false },
    /** True when a one-shot emote gesture is actively playing */
    isEmoting: { type: Types.Boolean, default: false },
    /** Standard cross-fade transition duration in seconds */
    fadeDuration: { type: Types.Float32, default: 0.3 },
  },
  'Ready Player Me avatar animation playback state',
);
