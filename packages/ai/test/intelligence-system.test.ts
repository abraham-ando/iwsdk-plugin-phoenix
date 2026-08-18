import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { SmartNPC, NPCMemory, NPCMemoryStore } from '../src/components';
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

  it('carries a player\'s own prior turns into their next world context (same NPC, same session)', async () => {
    world.registerSystem(CardinalIntelligenceSystem, {
      configData: { adapter: mockAdapter, useScheduler: false },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;
    world.registerComponent(NPCMemory);
    const entity = world.createEntity();
    entity.addComponent(SmartNPC, { personalityId: 1 });
    entity.addComponent(NPCMemory);

    await system.queryNPC(entity, 'Mon lieu secret est la grotte', {}, undefined, 'alice');
    await system.queryNPC(entity, 'Salut', {}, undefined, 'alice');

    expect(mockAdapter.lastRequest?.worldContext).toContain('grotte');
  });

  it('does not leak another player\'s dialogue turns into a different player\'s world context', async () => {
    world.registerSystem(CardinalIntelligenceSystem, {
      // Scheduler dispatch is throttled (real-time gated); bypass it so two
      // back-to-back queries in the same tick both resolve synchronously.
      configData: { adapter: mockAdapter, useScheduler: false },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;
    world.registerComponent(NPCMemory);
    const entity = world.createEntity();
    entity.addComponent(SmartNPC, { personalityId: 1 });
    entity.addComponent(NPCMemory);

    // Player "alice" shares a secret with the NPC.
    await system.queryNPC(entity, 'Mon code secret est 1234', {}, undefined, 'alice');

    // Player "bob" then talks to the same NPC in a separate session.
    await system.queryNPC(entity, 'Salut', {}, undefined, 'bob');

    expect(mockAdapter.lastRequest?.worldContext).not.toContain('1234');
  });

  it('purges an NPC\'s dialogue history from the plugin memory when its entity is destroyed', async () => {
    world.registerSystem(CardinalIntelligenceSystem, {
      configData: { adapter: mockAdapter, useScheduler: false },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;
    world.registerComponent(NPCMemory);
    const entity = world.createEntity();
    entity.addComponent(SmartNPC, { personalityId: 1 });
    entity.addComponent(NPCMemory);
    const entityId = entity.index;

    // Six turns exchanged with the player, per the BDD scenario.
    await system.queryNPC(entity, 'Bonjour PNJ', {}, undefined, 'alice');
    await system.queryNPC(entity, 'Comment vas-tu ?', {}, undefined, 'alice');
    await system.queryNPC(entity, 'Où est le trésor ?', {}, undefined, 'alice');

    expect(system.memoryStore.getDialogueHistory(entityId, 'alice').length).toBeGreaterThan(0);

    entity.destroy();

    expect(system.memoryStore.getDialogueHistory(entityId, 'alice')).toHaveLength(0);
  });

  it('does not let a freshly created entity inherit a destroyed entity\'s memory when its numeric index is recycled', async () => {
    world.registerSystem(CardinalIntelligenceSystem, {
      configData: { adapter: mockAdapter, useScheduler: false },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;
    world.registerComponent(NPCMemory);

    const firstEntity = world.createEntity();
    firstEntity.addComponent(SmartNPC, { personalityId: 1 });
    firstEntity.addComponent(NPCMemory);
    const recycledIndex = firstEntity.index;

    await system.queryNPC(firstEntity, 'Mon code secret est 1234', {}, undefined, 'alice');
    expect(system.memoryStore.getDialogueHistory(recycledIndex, 'alice').length).toBeGreaterThan(0);

    firstEntity.destroy();

    // Create a new entity — elics recycles the freed index synchronously, so
    // this should land on the exact same numeric id the destroyed NPC held.
    const secondEntity = world.createEntity();
    expect(secondEntity.index).toBe(recycledIndex);

    // The new NPC at this recycled id must start with a clean slate — it
    // must never see the destroyed NPC's prior conversation.
    expect(system.memoryStore.getDialogueHistory(secondEntity.index, 'alice')).toHaveLength(0);
  });

  it('does not record a dialogue turn for an entity that was destroyed while its inference call was still in flight', async () => {
    world.registerSystem(CardinalIntelligenceSystem, {
      configData: { adapter: mockAdapter, useScheduler: false },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;
    world.registerComponent(NPCMemory);
    const entity = world.createEntity();
    entity.addComponent(SmartNPC, { personalityId: 1 });
    entity.addComponent(NPCMemory);
    const entityId = entity.index;

    // `queryNPC` awaits `inferenceAdapter.generate()` — that first await
    // yields a microtask, giving us a window to destroy the entity before
    // the response comes back and the memory write would otherwise happen.
    const queryPromise = system.queryNPC(entity, 'Secret furtif', {}, undefined, 'alice');
    entity.destroy();
    await queryPromise;

    expect(system.memoryStore.getDialogueHistory(entityId, 'alice')).toHaveLength(0);
  });

  it('uses the externally-owned memory store supplied via configData instead of creating its own', () => {
    const externalStore = new NPCMemoryStore();
    externalStore.addDialogueTurn(3, { role: 'user', content: 'Injecté par le plugin', timestamp: 100 });

    world.registerSystem(CardinalIntelligenceSystem, {
      configData: { adapter: mockAdapter, memoryStore: externalStore },
    });

    const system = world.getSystem(CardinalIntelligenceSystem)!;

    expect(system.memoryStore).toBe(externalStore);
    expect(system.memoryStore.getDialogueHistory(3)).toHaveLength(1);
  });
});
