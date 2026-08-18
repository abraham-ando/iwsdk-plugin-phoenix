import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { NPCMemory, NPCMemoryStore } from '../src/components/NPCMemory';

describe('NPCMemory Component', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
    world.registerComponent(NPCMemory);
  });

  it('initializes with default memory values', () => {
    const entity = world.createEntity();
    entity.addComponent(NPCMemory);

    expect(entity.getValue(NPCMemory, 'maxHistoryTurns')).toBe(4);
    expect(entity.getValue(NPCMemory, 'totalInteractions')).toBe(0);
  });
});

describe('NPCMemoryStore', () => {
  it('stores dialogue turns and enforces maximum ring buffer size', () => {
    const store = new NPCMemoryStore();
    const entityId = 42;

    store.addDialogueTurn(entityId, { role: 'user', content: 'Bonjour', timestamp: 100 }, 2);
    store.addDialogueTurn(entityId, { role: 'assistant', content: 'Salut !', timestamp: 105 }, 2);
    store.addDialogueTurn(entityId, { role: 'user', content: 'Comment vas-tu ?', timestamp: 200 }, 2);
    store.addDialogueTurn(entityId, { role: 'assistant', content: 'Très bien !', timestamp: 205 }, 2);
    store.addDialogueTurn(entityId, { role: 'user', content: 'Où est le château ?', timestamp: 300 }, 2);

    const history = store.getDialogueHistory(entityId);
    expect(history.length).toBeLessThanOrEqual(4); // maxTurns (2) * 2 = 4
    expect(history[history.length - 1]?.content).toBe('Où est le château ?');
  });

  it('keeps dialogue history isolated per player session on the same NPC', () => {
    const store = new NPCMemoryStore();
    const npcId = 7;

    store.addDialogueTurn(npcId, { role: 'user', content: 'Secret d\'Alice', timestamp: 100 }, 4, 'alice');
    store.addDialogueTurn(npcId, { role: 'user', content: 'Secret de Bob', timestamp: 200 }, 4, 'bob');

    const aliceHistory = store.getDialogueHistory(npcId, 'alice');
    const bobHistory = store.getDialogueHistory(npcId, 'bob');
    const legacyHistory = store.getDialogueHistory(npcId);

    expect(aliceHistory).toHaveLength(1);
    expect(aliceHistory[0]?.content).toBe('Secret d\'Alice');
    expect(bobHistory).toHaveLength(1);
    expect(bobHistory[0]?.content).toBe('Secret de Bob');
    // Bob must never see Alice's turns and vice versa (cross-session leakage).
    expect(bobHistory.some((t) => t.content.includes('Alice'))).toBe(false);
    expect(aliceHistory.some((t) => t.content.includes('Bob'))).toBe(false);
    // The un-scoped legacy bucket (no playerId) stays untouched.
    expect(legacyHistory).toHaveLength(0);
  });

  it('clears only the targeted player session, leaving other sessions and the legacy bucket intact', () => {
    const store = new NPCMemoryStore();
    const npcId = 9;

    store.addDialogueTurn(npcId, { role: 'user', content: 'Salut', timestamp: 100 }, 4, 'alice');
    store.addDialogueTurn(npcId, { role: 'user', content: 'Coucou', timestamp: 100 }, 4, 'bob');
    store.addDialogueTurn(npcId, { role: 'user', content: 'Legacy', timestamp: 100 }, 4);

    store.clearDialogueHistory(npcId, 'alice');

    expect(store.getDialogueHistory(npcId, 'alice')).toHaveLength(0);
    expect(store.getDialogueHistory(npcId, 'bob')).toHaveLength(1);
    expect(store.getDialogueHistory(npcId)).toHaveLength(1);
  });

  it('purges every session bucket for one entity in a single call, leaving other entities untouched', () => {
    const store = new NPCMemoryStore();
    const npcId = 7;
    const otherNpcId = 70;

    store.addDialogueTurn(npcId, { role: 'user', content: 'Secret d\'Alice', timestamp: 100 }, 4, 'alice');
    store.addDialogueTurn(npcId, { role: 'user', content: 'Secret de Bob', timestamp: 100 }, 4, 'bob');
    store.addDialogueTurn(npcId, { role: 'user', content: 'Legacy', timestamp: 100 }, 4);
    store.addDialogueTurn(otherNpcId, { role: 'user', content: 'Un autre PNJ', timestamp: 100 }, 4, 'alice');

    store.clearEntity(npcId);

    expect(store.getDialogueHistory(npcId, 'alice')).toHaveLength(0);
    expect(store.getDialogueHistory(npcId, 'bob')).toHaveLength(0);
    expect(store.getDialogueHistory(npcId)).toHaveLength(0);
    // A numeric prefix collision (7 vs 70) must not cause an accidental purge.
    expect(store.getDialogueHistory(otherNpcId, 'alice')).toHaveLength(1);
  });

  it('dispose() releases every stored history regardless of how many entities have one', () => {
    const store = new NPCMemoryStore();

    store.addDialogueTurn(1, { role: 'user', content: 'Un', timestamp: 100 }, 4);
    store.addDialogueTurn(2, { role: 'user', content: 'Deux', timestamp: 100 }, 4, 'alice');
    store.addDialogueTurn(3, { role: 'user', content: 'Trois', timestamp: 100 }, 4, 'bob');

    store.dispose();

    expect(store.getDialogueHistory(1)).toHaveLength(0);
    expect(store.getDialogueHistory(2, 'alice')).toHaveLength(0);
    expect(store.getDialogueHistory(3, 'bob')).toHaveLength(0);
  });

  it('never shares state between two separate store instances', () => {
    const storeA = new NPCMemoryStore();
    const storeB = new NPCMemoryStore();
    const npcId = 7;

    storeA.addDialogueTurn(npcId, { role: 'user', content: 'le joueur m\'a offert une baie', timestamp: 100 });

    expect(storeA.getDialogueHistory(npcId)).toHaveLength(1);
    expect(storeB.getDialogueHistory(npcId)).toHaveLength(0);
  });
});
