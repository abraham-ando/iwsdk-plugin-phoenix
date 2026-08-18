import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { NPCMemory, addDialogueTurn, getDialogueHistory, clearDialogueHistory } from '../src/components/NPCMemory';

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

  it('stores dialogue turns and enforces maximum ring buffer size', () => {
    const entityId = 42;
    clearDialogueHistory(entityId);

    addDialogueTurn(entityId, { role: 'user', content: 'Bonjour', timestamp: 100 }, 2);
    addDialogueTurn(entityId, { role: 'assistant', content: 'Salut !', timestamp: 105 }, 2);
    addDialogueTurn(entityId, { role: 'user', content: 'Comment vas-tu ?', timestamp: 200 }, 2);
    addDialogueTurn(entityId, { role: 'assistant', content: 'Très bien !', timestamp: 205 }, 2);
    addDialogueTurn(entityId, { role: 'user', content: 'Où est le château ?', timestamp: 300 }, 2);

    const history = getDialogueHistory(entityId);
    expect(history.length).toBeLessThanOrEqual(4); // maxTurns (2) * 2 = 4
    expect(history[history.length - 1]?.content).toBe('Où est le château ?');
  });

  it('keeps dialogue history isolated per player session on the same NPC', () => {
    const npcId = 7;
    clearDialogueHistory(npcId, 'alice');
    clearDialogueHistory(npcId, 'bob');
    clearDialogueHistory(npcId);

    addDialogueTurn(npcId, { role: 'user', content: 'Secret d\'Alice', timestamp: 100 }, 4, 'alice');
    addDialogueTurn(npcId, { role: 'user', content: 'Secret de Bob', timestamp: 200 }, 4, 'bob');

    const aliceHistory = getDialogueHistory(npcId, 'alice');
    const bobHistory = getDialogueHistory(npcId, 'bob');
    const legacyHistory = getDialogueHistory(npcId);

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
    const npcId = 9;
    clearDialogueHistory(npcId, 'alice');
    clearDialogueHistory(npcId, 'bob');
    clearDialogueHistory(npcId);

    addDialogueTurn(npcId, { role: 'user', content: 'Salut', timestamp: 100 }, 4, 'alice');
    addDialogueTurn(npcId, { role: 'user', content: 'Coucou', timestamp: 100 }, 4, 'bob');
    addDialogueTurn(npcId, { role: 'user', content: 'Legacy', timestamp: 100 }, 4);

    clearDialogueHistory(npcId, 'alice');

    expect(getDialogueHistory(npcId, 'alice')).toHaveLength(0);
    expect(getDialogueHistory(npcId, 'bob')).toHaveLength(1);
    expect(getDialogueHistory(npcId)).toHaveLength(1);
  });
});
