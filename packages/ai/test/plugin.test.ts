import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { installCardinalAI, SmartNPC, SpatialVoice } from '../src';
import { CardinalIntelligenceSystem, CardinalSpatialAudioSystem } from '../src/systems';

describe('installCardinalAI Plugin', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
  });

  it('registers components, systems and returns handle', async () => {
    const handle = installCardinalAI(world, {
      remoteFallbackUrl: 'https://api.example.com/v1/chat/completions',
    });

    expect(handle).toBeDefined();
    expect(handle.inferenceAdapter).toBeDefined();
    expect(handle.ttsAdapter).toBeDefined();
    expect(world.getSystem(CardinalIntelligenceSystem)).toBeDefined();
    expect(world.getSystem(CardinalSpatialAudioSystem)).toBeDefined();

    const entity = world.createEntity();
    entity.addComponent(SmartNPC);
    entity.addComponent(SpatialVoice);

    expect(entity.hasComponent(SmartNPC)).toBe(true);
    expect(entity.hasComponent(SpatialVoice)).toBe(true);

    handle.dispose();
  });
});
