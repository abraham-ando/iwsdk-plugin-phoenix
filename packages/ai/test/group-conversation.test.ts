import { describe, it, expect, beforeEach } from 'vitest';
import { World, Entity } from '@iwsdk/core';
import { GroupConversationSystem } from '../src/social/GroupConversationSystem';
import { NPCBanter } from '../src/components/NPCBanter';
import { SmartNPC } from '../src/components/SmartNPC';

describe('GroupConversationSystem', () => {
  let world: World;
  let groupSystem: GroupConversationSystem;
  let npc1: Entity;
  let npc2: Entity;
  let npc3: Entity;

  beforeEach(() => {
    world = new World();
    world.registerComponent(SmartNPC);
    world.registerComponent(NPCBanter);

    world.registerSystem(GroupConversationSystem);
    groupSystem = world.getSystem(GroupConversationSystem)!;

    npc1 = world.createEntity();
    npc1.addComponent(SmartNPC, { name: 'Eldrin', role: 'Mage' });
    npc1.addComponent(NPCBanter);

    npc2 = world.createEntity();
    npc2.addComponent(SmartNPC, { name: 'Garrick', role: 'Guard' });
    npc2.addComponent(NPCBanter);

    npc3 = world.createEntity();
    npc3.addComponent(SmartNPC, { name: 'Sylvia', role: 'Merchant' });
    npc3.addComponent(NPCBanter);
  });

  it('should create a conversation circle and queue participants', () => {
    const circleId = groupSystem.createCircle([npc1, npc2, npc3], 'Mystic Anomaly');
    const circle = groupSystem.getCircle(circleId);

    expect(circle).toBeDefined();
    expect(circle?.participantIndices).toHaveLength(3);
    expect(circle?.topic).toBe('Mystic Anomaly');
    expect(npc1.getValue(NPCBanter, 'isBantering')).toBe(true);
  });

  it('should handle turn taking and next speaker designation', () => {
    const circleId = groupSystem.createCircle([npc1, npc2], 'Dragon sighting');

    // First speaker finishes turn
    const nextSpeakerIndex = groupSystem.finishTurn(circleId, npc1, 'I saw a dragon near the mountain!');
    expect(nextSpeakerIndex).toBe(npc2.index);

    const circle = groupSystem.getCircle(circleId);
    expect(circle?.turns).toHaveLength(1);
    expect(circle?.turns[0].text).toContain('dragon');
  });

  it('should inject player speech and notify participants', () => {
    const circleId = groupSystem.createCircle([npc1, npc2], 'Local rumors');
    groupSystem.injectPlayerSpeech(circleId, 'Did anyone hear that strange noise?');

    const circle = groupSystem.getCircle(circleId);
    expect(circle?.turns).toHaveLength(1);
    expect(circle?.turns[0].speakerEntityIndex).toBe(-1);
    expect(circle?.turnQueue).toEqual([npc1.index, npc2.index]);
  });
});
