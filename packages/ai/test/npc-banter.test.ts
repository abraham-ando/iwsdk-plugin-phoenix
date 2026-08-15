import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { NPCBanter } from '../src/components/NPCBanter';
import { SmartNPC } from '../src/components/SmartNPC';
import { NPCBanterSystem } from '../src/social/NPCBanterSystem';

describe('NPCBanterSystem', () => {
  let world: World;
  let banterSystem: NPCBanterSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(NPCBanter).registerComponent(SmartNPC);
    world.registerSystem(NPCBanterSystem);
    banterSystem = world.getSystem(NPCBanterSystem)!;
  });

  it('triggers spontaneous banter between nearby NPCs', async () => {
    const npcA = world.createEntity();
    npcA.addComponent(NPCBanter, { talkativeness: 1.0, cooldownMs: 1000 });
    npcA.addComponent(SmartNPC, { personalityId: 1 });

    const npcB = world.createEntity();
    npcB.addComponent(NPCBanter, { talkativeness: 1.0, cooldownMs: 1000 });
    npcB.addComponent(SmartNPC, { personalityId: 2 });

    const lines: string[] = [];
    banterSystem.onBanter((_speaker, _listener, line) => {
      lines.push(line);
    });

    await banterSystem.triggerBanter(npcA, npcB);

    expect(lines.length).toBe(2);
    expect(npcA.getValue(NPCBanter, 'isBantering')).toBe(false);
    expect(npcB.getValue(NPCBanter, 'isBantering')).toBe(false);
  });
});
