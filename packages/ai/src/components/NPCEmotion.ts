import { Types, createComponent } from '@iwsdk/core';

export const EmotionType = {
  NEUTRAL: 0,
  FRIENDLY: 1,
  SUSPICIOUS: 2,
  HOSTILE: 3,
  FEARFUL: 4,
  EXCITED: 5,
} as const;

export type EmotionTypeValue = (typeof EmotionType)[keyof typeof EmotionType];

export const EmotionNames: Record<EmotionTypeValue, string> = {
  [EmotionType.NEUTRAL]: 'Neutre',
  [EmotionType.FRIENDLY]: 'Amical',
  [EmotionType.SUSPICIOUS]: 'Méfiant',
  [EmotionType.HOSTILE]: 'Hostile',
  [EmotionType.FEARFUL]: 'Apeuré',
  [EmotionType.EXCITED]: 'Enthousiaste',
};

export const EmotionPromptModifiers: Record<EmotionTypeValue, string> = {
  [EmotionType.NEUTRAL]: 'Tu restes calme et posé.',
  [EmotionType.FRIENDLY]: 'Tu es chaleureux, bienveillant et disposé à aider.',
  [EmotionType.SUSPICIOUS]: 'Tu te méfies de ton interlocuteur et restes sur tes gardes.',
  [EmotionType.HOSTILE]: 'Tu es agressif, menaçant et prompt à la colère.',
  [EmotionType.FEARFUL]: 'Tu es terrifié, hésitant et crains pour ta sécurité.',
  [EmotionType.EXCITED]: 'Tu es très enthousiaste, énergique et bavard.',
};

/** Acoustic modulation factor based on emotion */
export interface EmotionAudioModulation {
  pitchMultiplier: number;
  speedMultiplier: number;
}

export const EmotionAudioProfiles: Record<EmotionTypeValue, EmotionAudioModulation> = {
  [EmotionType.NEUTRAL]: { pitchMultiplier: 1.0, speedMultiplier: 1.0 },
  [EmotionType.FRIENDLY]: { pitchMultiplier: 1.05, speedMultiplier: 1.0 },
  [EmotionType.SUSPICIOUS]: { pitchMultiplier: 0.95, speedMultiplier: 0.9 },
  [EmotionType.HOSTILE]: { pitchMultiplier: 0.9, speedMultiplier: 1.15 },
  [EmotionType.FEARFUL]: { pitchMultiplier: 1.2, speedMultiplier: 1.25 },
  [EmotionType.EXCITED]: { pitchMultiplier: 1.15, speedMultiplier: 1.2 },
};

/**
 * ECS component modeling an NPC's emotional state and mood intensity.
 */
export const NPCEmotion = createComponent(
  'NPCEmotion',
  {
    /** Active emotion ID (see EmotionType) */
    currentEmotion: { type: Types.Int32, default: EmotionType.NEUTRAL },
    /** Emotional intensity [0.0 - 1.0] */
    intensity: { type: Types.Float32, default: 0.5 },
    /** `performance.now()` timestamp of the last emotion state transition */
    lastTransitionTime: { type: Types.Float64, default: 0 },
  },
  'Emotional mood state and behavioral modulation for NPCs',
);
