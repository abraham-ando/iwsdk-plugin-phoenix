import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { installCardinalAI, SmartNPC, SpatialVoice } from '../src';
import { CardinalIntelligenceSystem, CardinalSpatialAudioSystem } from '../src/systems';
import { CloudInferenceAdapter } from '../src/adapters/CloudInferenceAdapter';
import { SelfHostedInferenceAdapter } from '../src/adapters/SelfHostedInferenceAdapter';
import { WebGPUInferenceAdapter } from '../src/adapters/WebGPUInferenceAdapter';

describe('installCardinalAI Plugin', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
  });

  it('registers components, systems and returns handle with fallback', async () => {
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

  it('initializes CloudInferenceAdapter when provider is cloud', () => {
    const handle = installCardinalAI(world, {
      provider: 'cloud',
      cloud: {
        provider: 'groq',
        apiKey: 'gsk_test',
        model: 'llama-3.1-8b-instant',
      },
    });

    expect(handle.inferenceAdapter).toBeInstanceOf(CloudInferenceAdapter);
    handle.dispose();
  });

  it('initializes SelfHostedInferenceAdapter when provider is self-hosted', () => {
    const handle = installCardinalAI(world, {
      provider: 'self-hosted',
      selfHosted: {
        endpoint: 'http://192.168.1.50:11434',
        model: 'llama3.2:3b',
        serverType: 'ollama',
      },
    });

    expect(handle.inferenceAdapter).toBeInstanceOf(SelfHostedInferenceAdapter);
    handle.dispose();
  });

  it('initializes WebGPUInferenceAdapter by default', () => {
    const handle = installCardinalAI(world, {
      provider: 'local-webgpu',
      llm: {
        modelId: 'qwen2.5-1.5b-it-q4f16',
      },
    });

    expect(handle.inferenceAdapter).toBeInstanceOf(WebGPUInferenceAdapter);
    handle.dispose();
  });
});
