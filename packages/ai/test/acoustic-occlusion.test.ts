import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { SpatialVoice } from '../src/components/SpatialVoice';
import { AcousticOcclusionSystem } from '../src/acoustics/AcousticOcclusionSystem';

describe('AcousticOcclusionSystem', () => {
  let world: World;
  let occlusionSystem: AcousticOcclusionSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(SpatialVoice);
    world.registerSystem(AcousticOcclusionSystem);
    occlusionSystem = world.getSystem(AcousticOcclusionSystem)!;
  });

  it('adjusts audio cutoff frequency and volume attenuation when occluded', () => {
    const entity = world.createEntity();
    entity.addComponent(SpatialVoice, { voiceId: 1 });

    expect(occlusionSystem.getCutoffFrequency(entity)).toBe(20000);
    expect(occlusionSystem.getVolumeMultiplier(entity)).toBe(1.0);

    occlusionSystem.setEntityOcclusion(entity, true);

    expect(occlusionSystem.getCutoffFrequency(entity)).toBe(700);
    expect(occlusionSystem.getVolumeMultiplier(entity)).toBe(0.4);
  });
});
