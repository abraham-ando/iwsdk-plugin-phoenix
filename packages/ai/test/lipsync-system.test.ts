import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { FacialLipSync } from '../src/components/FacialLipSync';
import { SpatialVoice } from '../src/components/SpatialVoice';
import { LipSyncSystem } from '../src/systems/LipSyncSystem';

describe('LipSyncSystem', () => {
  let world: World;
  let lipSyncSystem: LipSyncSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(FacialLipSync).registerComponent(SpatialVoice);
    world.registerSystem(LipSyncSystem);
    lipSyncSystem = world.getSystem(LipSyncSystem)!;
  });

  it('modulates jawOpen and viseme weights when entity is speaking', () => {
    const entity = world.createEntity();
    entity.addComponent(FacialLipSync, { smoothing: 0.5 });
    entity.addComponent(SpatialVoice, { isPlaying: true });

    lipSyncSystem.setAudioAmplitude(entity.index, 0.8);

    lipSyncSystem.update(0.016, 100);

    const jaw = entity.getValue(FacialLipSync, 'jawOpen') ?? 0;
    expect(jaw).toBeGreaterThan(0.0);
  });

  it('drives lip sync from SpatialVoice.isPlaying alone, with no amplitude fed in', () => {
    const entity = world.createEntity();
    entity.addComponent(FacialLipSync, { smoothing: 0.5 });
    entity.addComponent(SpatialVoice, { isPlaying: true });

    // No setAudioAmplitude call: isSpeaking must come from the SpatialVoice
    // component's isPlaying flag, not the (empty) amplitude fallback.
    lipSyncSystem.update(0.016, 100);

    const jaw = entity.getValue(FacialLipSync, 'jawOpen') ?? 0;
    expect(jaw).toBeGreaterThan(0.0);
  });
});
