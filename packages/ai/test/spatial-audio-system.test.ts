import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { SpatialVoice } from '../src/components';
import { NPCEmotion, EmotionType, EmotionAudioProfiles } from '../src/components/NPCEmotion';
import { CardinalSpatialAudioSystem } from '../src/systems';
import type { ITTSAdapter, SpeechRequest, SpeechResponse } from '../src/adapters/types';

class MockTTSAdapter implements ITTSAdapter {
  public isReady = true;
  public lastRequest: SpeechRequest | null = null;

  public async init(): Promise<void> {
    this.isReady = true;
  }

  public async synthesize(request: SpeechRequest): Promise<SpeechResponse> {
    this.lastRequest = request;
    return {
      audioData: new Float32Array(100),
      sampleRate: 22050,
    };
  }

  public dispose(): void {
    this.isReady = false;
  }
}

describe('CardinalSpatialAudioSystem', () => {
  let world: World;
  let mockTTS: MockTTSAdapter;

  beforeEach(() => {
    world = new World();
    world.registerComponent(SpatialVoice);
    mockTTS = new MockTTSAdapter();
  });

  it('synthesizes and plays audio for an entity with SpatialVoice', async () => {
    world.registerSystem(CardinalSpatialAudioSystem, {
      configData: { adapter: mockTTS },
    });

    const system = world.getSystem(CardinalSpatialAudioSystem)!;
    expect(system).toBeDefined();

    const entity = world.createEntity();
    entity.addComponent(SpatialVoice, { pitch: 1.1 });

    await system.speak(entity, 'Salutations aventurier !', 'fr_FR-siwis-medium');

    expect(mockTTS.lastRequest?.text).toBe('Salutations aventurier !');
    expect(mockTTS.lastRequest?.voiceId).toBe('fr_FR-siwis-medium');
    expect(mockTTS.lastRequest?.pitch).toBeCloseTo(1.1);
  });

  it('stops playback and resets isPlaying flag', () => {
    world.registerSystem(CardinalSpatialAudioSystem, {
      configData: { adapter: mockTTS },
    });

    const system = world.getSystem(CardinalSpatialAudioSystem)!;
    const entity = world.createEntity();
    entity.addComponent(SpatialVoice, { isPlaying: true });

    system.stopSpeaking(entity);
    expect(entity.getValue(SpatialVoice, 'isPlaying')).toBe(false);
  });

  it('modulates pitch and speed from the NPC\'s current emotion', async () => {
    world.registerComponent(NPCEmotion);
    world.registerSystem(CardinalSpatialAudioSystem, {
      configData: { adapter: mockTTS },
    });

    const system = world.getSystem(CardinalSpatialAudioSystem)!;
    const entity = world.createEntity();
    entity.addComponent(SpatialVoice, { pitch: 1.0 });
    entity.addComponent(NPCEmotion, { currentEmotion: EmotionType.HOSTILE });

    await system.speak(entity, 'Rends-toi immédiatement !');

    const profile = EmotionAudioProfiles[EmotionType.HOSTILE];
    expect(mockTTS.lastRequest?.pitch).toBeCloseTo(1.0 * profile.pitchMultiplier);
    expect(mockTTS.lastRequest?.speed).toBeCloseTo(1.0 * profile.speedMultiplier);
  });
});
