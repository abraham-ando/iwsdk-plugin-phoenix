import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { VoiceReceiver } from '../src/components/VoiceReceiver';
import { VoiceInputSystem } from '../src/systems/VoiceInputSystem';

describe('VoiceInputSystem', () => {
  let world: World;
  let voiceInputSystem: VoiceInputSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(VoiceReceiver);
    world.registerSystem(VoiceInputSystem);
    voiceInputSystem = world.getSystem(VoiceInputSystem)!;
  });

  it('triggers VAD speech detected when volume exceeds threshold', () => {
    const entity = world.createEntity();
    entity.addComponent(VoiceReceiver, { vadThreshold: 0.05, silenceTimeoutMs: 500 });

    // Below threshold
    voiceInputSystem.processVADLevel(entity, 0.01, 1000);
    expect(entity.getValue(VoiceReceiver, 'isSpeechDetected')).toBe(false);

    // Above threshold
    voiceInputSystem.processVADLevel(entity, 0.08, 1050);
    expect(entity.getValue(VoiceReceiver, 'isSpeechDetected')).toBe(true);

    // Silence starts at 1100, but under silenceTimeoutMs (500ms)
    voiceInputSystem.processVADLevel(entity, 0.01, 1200);
    expect(entity.getValue(VoiceReceiver, 'isSpeechDetected')).toBe(true);

    // Silence exceeds timeout
    voiceInputSystem.processVADLevel(entity, 0.01, 1700);
    expect(entity.getValue(VoiceReceiver, 'isSpeechDetected')).toBe(false);
  });

  it('dispatches transcribed text to listeners', async () => {
    const entity = world.createEntity();
    entity.addComponent(VoiceReceiver);

    let receivedTranscript = '';
    voiceInputSystem.onTranscript((text) => {
      receivedTranscript = text;
    });

    await voiceInputSystem.dispatchTranscript('Où est le temple ancien ?', entity);
    expect(receivedTranscript).toBe('Où est le temple ancien ?');
  });
});
