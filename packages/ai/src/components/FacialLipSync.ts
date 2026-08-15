import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component storing real-time lip-sync morph target weights.
 */
export const FacialLipSync = createComponent(
  'FacialLipSync',
  {
    /** Vertical jaw opening weight [0.0 - 1.0] */
    jawOpen: { type: Types.Float32, default: 0.0 },
    /** Mouth pucker / rounded lips weight [0.0 - 1.0] */
    mouthPucker: { type: Types.Float32, default: 0.0 },
    /** Viseme 'AA' / wide open vowel weight [0.0 - 1.0] */
    visemeAA: { type: Types.Float32, default: 0.0 },
    /** Viseme 'O' / rounded open vowel weight [0.0 - 1.0] */
    visemeO: { type: Types.Float32, default: 0.0 },
    /** Viseme 'E' / spread vowel weight [0.0 - 1.0] */
    visemeE: { type: Types.Float32, default: 0.0 },
    /** Lerp smoothing factor per frame [0.01 - 1.0] */
    smoothing: { type: Types.Float32, default: 0.35 },
    /** Overall lip-sync amplitude multiplier */
    intensityMultiplier: { type: Types.Float32, default: 1.0 },
  },
  'Real-time facial viseme and jaw animation weights driven by speech synthesis',
);
