import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component configuring 3D positional audio parameters for NPC voice output.
 */
export const SpatialVoice = createComponent(
  'SpatialVoice',
  {
    /** Reference distance in meters where volume is nominal (1.0) */
    refDistance: { type: Types.Float32, default: 2.0 },
    /** Maximum distance in meters beyond which voice is completely attenuated */
    maxDistance: { type: Types.Float32, default: 25.0 },
    /** Rolloff factor for distance attenuation */
    rolloffFactor: { type: Types.Float32, default: 1.5 },
    /** Pitch/playback rate multiplier (1.0 = standard pitch) */
    pitch: { type: Types.Float32, default: 1.0 },
    /** True when audio playback is actively playing */
    isPlaying: { type: Types.Boolean, default: false },
    /** Numerical voice ID / timbre selector */
    voiceId: { type: Types.Int32, default: 0 },
  },
  '3D spatialized voice component for NPC audio synthesis playback',
);
