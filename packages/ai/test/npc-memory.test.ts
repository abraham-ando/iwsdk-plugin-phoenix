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
});
