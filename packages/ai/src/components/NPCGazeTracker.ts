import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component for procedural head-tracking, Gaze IK, and natural eye saccades.
 */
export const NPCGazeTracker = createComponent(
  'NPCGazeTracker',
  {
    /** Entity index of the target to track (-1 for player camera) */
    targetEntityIndex: { type: Types.Int32, default: -1 },
    /** Maximum allowable head yaw/pitch angle in degrees from rest */
    maxTurnAngleDeg: { type: Types.Float32, default: 75.0 },
    /** Angular slerp interpolation speed */
    turnSpeed: { type: Types.Float32, default: 4.0 },
    /** Interval in ms between natural eye saccade shifts */
    saccadeIntervalMs: { type: Types.Float32, default: 2500 },
    /** Micro-saccade jitter amplitude in degrees */
    saccadeJitterDeg: { type: Types.Float32, default: 2.0 },
    /** Current smoothed head yaw in degrees */
    currentYaw: { type: Types.Float32, default: 0.0 },
    /** Current smoothed head pitch in degrees */
    currentPitch: { type: Types.Float32, default: 0.0 },
    /** Timestamp of the last saccade trigger */
    lastSaccadeTime: { type: Types.Float64, default: 0.0 },
    /** Current saccade offset yaw */
    saccadeOffsetYaw: { type: Types.Float32, default: 0.0 },
    /** Current saccade offset pitch */
    saccadeOffsetPitch: { type: Types.Float32, default: 0.0 },
  },
  'Procedural head tracking, eye saccades, and gaze IK for NPCs',
);
