import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { SmartNPC } from '../src/components';
import { CardinalIntelligenceSystem } from '../src/systems';
import type { IInferenceAdapter, InferenceRequest, InferenceResponse } from '../src/adapters/types';

class MockInferenceAdapter implements IInferenceAdapter {
  public isReady = true;
  public lastRequest: InferenceRequest | null = null;
  public responseText = 'Réponse du garde PNJ';

  public async init(): Promise<void> {
    this.isReady = true;
  }

  public async generate(request: InferenceRequest): Promise<InferenceResponse> {
    this.lastRequest = request;
    return {
      text: this.responseText,
      tokensGenerated: 12,
      latencyMs: 45,
    };
  }

  public dispose(): void {
    this.isReady = false;
  }
}

describe('CardinalIntelligenceSystem', () => {
  let world: World;
  let mockAdapter: MockInferenceAdapter;

  beforeEach(() => {
    world = new World();
    world.registerComponent(SmartNPC);
    mockAdapter = new MockInferenceAdapter();
  });

  it('registers and resolves queries with the active adapter', async () => {
    world.registerSystem(CardinalIntelligenceSystem, {
      configData: { adapter: mockAdapter },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;
    expect(system).toBeDefined();

    const entity = world.createEntity();
    entity.addComponent(SmartNPC, { personalityId: 1 });

    const reply = await system.queryNPC(entity, 'Bonjour garde', 'Météo: Pluie, Heure: 22h00');
    expect(reply).toBe('Réponse du garde PNJ');
    expect(mockAdapter.lastRequest?.playerMessage).toBe('Bonjour garde');
    expect(mockAdapter.lastRequest?.worldContext).toBe('Météo: Pluie, Heure: 22h00');
    expect(entity.getValue(SmartNPC, 'isThinking')).toBe(false);
  });

  it('prevents overlapping queries when already thinking', async () => {
    world.registerSystem(CardinalIntelligenceSystem, {
      configData: { adapter: mockAdapter },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;
    const entity = world.createEntity();
    entity.addComponent(SmartNPC, { personalityId: 0, isThinking: true });

    const reply = await system.queryNPC(entity, 'Parle-moi');
    expect(reply).toContain('réfléchir');
  });

  it('allows registering custom personality prompts', async () => {
    world.registerSystem(CardinalIntelligenceSystem, {
      configData: { adapter: mockAdapter },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;
    system.registerPersonality(5, 'Tu es un alchimiste fou.');

    const entity = world.createEntity();
    entity.addComponent(SmartNPC, { personalityId: 5 });

    await system.queryNPC(entity, 'Quelle potion as-tu ?');
    expect(mockAdapter.lastRequest?.systemPrompt).toContain('Tu es un alchimiste fou.');
  });
});
