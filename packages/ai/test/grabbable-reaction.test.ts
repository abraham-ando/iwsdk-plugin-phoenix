import { describe, it, expect, beforeEach, vi } from 'vitest';
import { World } from '@iwsdk/core';
import { NPCPerception } from '../src/components/NPCPerception';
import { NPCGazeTracker } from '../src/components/NPCGazeTracker';
import { GrabbableReactionSystem } from '../src/perception/GrabbableReactionSystem';

describe('GrabbableReactionSystem', () => {
  let world: World;
  let reactionSystem: GrabbableReactionSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(NPCPerception);
    world.registerComponent(NPCGazeTracker);
    world.registerSystem(GrabbableReactionSystem);
    reactionSystem = world.getSystem(GrabbableReactionSystem) as GrabbableReactionSystem;
  });

  it('locks gaze to an offered physical item and fires callback', () => {
    const npc = world.createEntity();
    npc.addComponent(NPCPerception);
    npc.addComponent(NPCGazeTracker);

    const item = world.createEntity();

    const listener = vi.fn();
    reactionSystem.onItemOffered(listener);

    reactionSystem.presentItemToNPC(npc, item, 'potion_health');

    expect(npc.getValue(NPCPerception, 'isNoticingItem')).toBe(true);
    expect(npc.getValue(NPCPerception, 'noticedItemEntityIndex')).toBe(item.index);
    expect(npc.getValue(NPCGazeTracker, 'targetEntityIndex')).toBe(item.index);
    expect(listener).toHaveBeenCalledWith({
      npc,
      itemEntity: item,
      itemName: 'potion_health',
    });

    // Release perception
    reactionSystem.releaseItemPerception(npc);
    expect(npc.getValue(NPCPerception, 'isNoticingItem')).toBe(false);
    expect(npc.getValue(NPCGazeTracker, 'targetEntityIndex')).toBe(-1);
  });
});
