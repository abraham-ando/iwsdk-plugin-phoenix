import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import {
  NPCEmotion,
  EmotionType,
  EmotionAudioProfiles,
  EmotionPromptModifiers,
} from '../src/components/NPCEmotion';

describe('NPCEmotion Component', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
    world.registerComponent(NPCEmotion);
  });

  it('initializes with default Neutral emotion', () => {
    const entity = world.createEntity();
    entity.addComponent(NPCEmotion);

    expect(entity.getValue(NPCEmotion, 'currentEmotion')).toBe(EmotionType.NEUTRAL);
    expect(entity.getValue(NPCEmotion, 'intensity')).toBeCloseTo(0.5);
  });

  it('provides mood prompt modifiers and acoustic modulations', () => {
    expect(EmotionPromptModifiers[EmotionType.HOSTILE]).toContain('agressif');
    expect(EmotionAudioProfiles[EmotionType.FEARFUL].pitchMultiplier).toBeGreaterThan(1.0);
    expect(EmotionAudioProfiles[EmotionType.HOSTILE].pitchMultiplier).toBeLessThan(1.0);
  });
});
