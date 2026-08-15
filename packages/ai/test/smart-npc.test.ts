import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { SmartNPC, SpatialVoice } from '../src/components';

describe('Cardinal AI ECS Components', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
    world.registerComponent(SmartNPC).registerComponent(SpatialVoice);
  });

  it('initializes SmartNPC with default values', () => {
    const entity = world.createEntity();
    entity.addComponent(SmartNPC);

    expect(entity.getValue(SmartNPC, 'personalityId')).toBe(0);
    expect(entity.getValue(SmartNPC, 'isThinking')).toBe(false);
    expect(entity.getValue(SmartNPC, 'interactionRadius')).toBe(3.0);
    expect(entity.getValue(SmartNPC, 'cooldownMs')).toBe(1000);
  });

  it('updates SmartNPC field values correctly', () => {
    const entity = world.createEntity();
    entity.addComponent(SmartNPC, { personalityId: 2, interactionRadius: 5.5 });

    expect(entity.getValue(SmartNPC, 'personalityId')).toBe(2);
    expect(entity.getValue(SmartNPC, 'interactionRadius')).toBe(5.5);

    entity.setValue(SmartNPC, 'isThinking', true);
    expect(entity.getValue(SmartNPC, 'isThinking')).toBe(true);
  });

  it('initializes SpatialVoice with default acoustic properties', () => {
    const entity = world.createEntity();
    entity.addComponent(SpatialVoice);

    expect(entity.getValue(SpatialVoice, 'refDistance')).toBe(2.0);
    expect(entity.getValue(SpatialVoice, 'maxDistance')).toBe(25.0);
    expect(entity.getValue(SpatialVoice, 'pitch')).toBe(1.0);
    expect(entity.getValue(SpatialVoice, 'isPlaying')).toBe(false);
  });

  it('supports custom SpatialVoice configuration', () => {
    const entity = world.createEntity();
    entity.addComponent(SpatialVoice, { refDistance: 1.0, maxDistance: 10.0, pitch: 1.25 });

    expect(entity.getValue(SpatialVoice, 'refDistance')).toBe(1.0);
    expect(entity.getValue(SpatialVoice, 'maxDistance')).toBe(10.0);
    expect(entity.getValue(SpatialVoice, 'pitch')).toBe(1.25);
  });
});
