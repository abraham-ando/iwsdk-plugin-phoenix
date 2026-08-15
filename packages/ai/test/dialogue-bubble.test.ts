import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { SpatialDialogueUI } from '../src/components/SpatialDialogueUI';
import { SmartNPC } from '../src/components/SmartNPC';
import { DialogueBubbleSystem } from '../src/ui/DialogueBubbleSystem';

describe('DialogueBubbleSystem', () => {
  let world: World;
  let bubbleSystem: DialogueBubbleSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(SpatialDialogueUI).registerComponent(SmartNPC);
    world.registerSystem(DialogueBubbleSystem);
    bubbleSystem = world.getSystem(DialogueBubbleSystem)!;
  });

  it('manages speech bubble text and word advancement', () => {
    const entity = world.createEntity();
    entity.addComponent(SpatialDialogueUI);
    entity.addComponent(SmartNPC);

    bubbleSystem.showSpeech(entity, 'Bienvenue dans notre cité des vents !');

    const state = bubbleSystem.getBubbleState(entity);
    expect(state).toBeDefined();
    expect(state?.text).toBe('Bienvenue dans notre cité des vents !');
    expect(state?.words.length).toBe(7);
    expect(state?.visible).toBe(true);

    bubbleSystem.update(0.5, 2000);
    expect(entity.getValue(SpatialDialogueUI, 'activeWordIndex')).toBeGreaterThanOrEqual(0);
  });
});
