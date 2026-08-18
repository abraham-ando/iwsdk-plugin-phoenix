import { describe, it, expect } from 'vitest';
import type { Entity } from '@iwsdk/core';
import { CardinalContextBuilder } from '../src/context/CardinalContextBuilder';
import { addDialogueTurn, clearDialogueHistory } from '../src/components/NPCMemory';

function fakeEntity(index: number): Entity {
  return { index, hasComponent: () => false } as unknown as Entity;
}

describe('CardinalContextBuilder', () => {
  it('derives daylight phases correctly from world time', () => {
    const midday = CardinalContextBuilder.getDayPhase(600000, 1200000); // 50% through day
    expect(midday.phase).toBe('Plein jour');
    expect(midday.timeString).toBe('12h00');

    const midnight = CardinalContextBuilder.getDayPhase(1150000, 1200000); // ~95% through day
    expect(midnight.phase).toBe('Nuit noire');
  });

  it('builds structured world context string from weather and location', () => {
    const context = CardinalContextBuilder.buildContext(null, {
      sectorName: 'Place du Marché',
      worldTimeMs: 600000,
      weather: { kind: 1, intensity: 0.8 },
      customContext: 'Un voleur rôde dans les parages.',
    });

    expect(context).toContain('Place du Marché');
    expect(context).toContain('Pluie battante');
    expect(context).toContain('intensité : 80%');
    expect(context).toContain('Un voleur rôde');
  });

  it('scopes the conversational memory summary to the requesting player session', () => {
    const npcId = 55;
    clearDialogueHistory(npcId, 'alice');
    clearDialogueHistory(npcId, 'bob');

    addDialogueTurn(npcId, { role: 'user', content: 'Je cherche le trésor secret', timestamp: 100 }, 4, 'alice');
    addDialogueTurn(npcId, { role: 'user', content: 'Salut PNJ', timestamp: 100 }, 4, 'bob');

    const contextForBob = CardinalContextBuilder.buildContext(fakeEntity(npcId), { playerId: 'bob' });

    expect(contextForBob).toContain('Salut PNJ');
    expect(contextForBob).not.toContain('trésor secret');
  });
});
