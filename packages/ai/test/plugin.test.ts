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

  it('shares no NPC memory between two installations in two distinct worlds', () => {
    const worldA = new World();
    const worldB = new World();

    const handleA = installCardinalAI(worldA, { remoteFallbackUrl: 'https://api.example.com/v1/chat/completions' });
    const handleB = installCardinalAI(worldB, { remoteFallbackUrl: 'https://api.example.com/v1/chat/completions' });

    const systemA = worldA.getSystem(CardinalIntelligenceSystem)!;
    const systemB = worldB.getSystem(CardinalIntelligenceSystem)!;

    const npcId = 7;
    systemA.memoryStore.addDialogueTurn(npcId, {
      role: 'user',
      content: 'le joueur m\'a offert une baie',
      timestamp: 100,
    });

    expect(systemA.memoryStore.getDialogueHistory(npcId)).toHaveLength(1);
    expect(systemB.memoryStore.getDialogueHistory(npcId)).toHaveLength(0);

    handleA.dispose();
    handleB.dispose();
  });

  it('leaves no residual memory entry after dispose(), for any number of NPCs that had a history', () => {
    const handle = installCardinalAI(world, { remoteFallbackUrl: 'https://api.example.com/v1/chat/completions' });
    const system = world.getSystem(CardinalIntelligenceSystem)!;
    const store = system.memoryStore;

    store.addDialogueTurn(1, { role: 'user', content: 'Un', timestamp: 100 });
    store.addDialogueTurn(2, { role: 'user', content: 'Deux', timestamp: 100 });
    store.addDialogueTurn(3, { role: 'user', content: 'Trois', timestamp: 100 });

    handle.dispose();

    expect(store.getDialogueHistory(1)).toHaveLength(0);
    expect(store.getDialogueHistory(2)).toHaveLength(0);
    expect(store.getDialogueHistory(3)).toHaveLength(0);
  });
});
