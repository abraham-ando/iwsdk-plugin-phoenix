import { describe, it, expect } from 'vitest';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { defaultIntrinsics } from '../src/agents/intrinsics';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { createAgent } from '../src/agents/AgentState';
import { executeActionTick } from '../src/agents/actions';
import { DEFAULT_VILLAGE } from '../src/content/scenario';

const INTRINSICS = defaultIntrinsics();

function makeWorld() {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return { reg, world: new GroundTruthWorld(reg) };
}

describe('fauna: hunting grounds and meat', () => {
  it('hunting_ground exposes hunt with game depletion and daily regrowth', () => {
    const { reg } = makeWorld();
    const def = reg.get('hunting_ground');
    expect(def.state.gameLeft).toBe(5);
    expect(def.regrowth).toEqual([{ field: 'gameLeft', perDay: 1, max: 5 }]);
    const hunt = def.affordances.find((a) => a.verb === 'hunt');
    expect(hunt?.durationTicks).toBe(80);
    expect(hunt?.effects.object).toEqual({ gameLeft: -1 });
    expect(hunt?.effects.actorInventory).toEqual({ meat: 1 });
  });

  it('eat_meat restores 50 hunger from one meat', () => {
    const eat = INTRINSICS.find((i) => i.verb === 'eat_meat');
    expect(eat?.effects.actorNeeds).toEqual({ hunger: 50 });
    expect(eat?.effects.actorInventory).toEqual({ meat: -1 });
  });

  it('a full hunt-then-eat loop works through the executor', () => {
    const { world } = makeWorld();
    const ground = world.spawn('hunting_ground', 2, 0);
    const agent = createAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, 0, 0);
    agent.needs.hunger = 30;
    agent.currentAction = {
      kind: 'world',
      objectId: ground.id,
      verb: 'hunt',
      phase: 'goto',
      targetX: ground.x,
      targetZ: ground.z,
      remainingTicks: 0,
    };
    for (let t = 0; t < 200 && agent.currentAction !== null; t++) {
      executeActionTick(agent, world, INTRINSICS, t);
    }
    expect(agent.inventory.meat).toBe(1);
    expect(ground.state.gameLeft).toBe(4);

    agent.currentAction = { kind: 'intrinsic', verb: 'eat_meat', remainingTicks: 30 };
    for (let t = 0; t < 40 && agent.currentAction !== null; t++) {
      executeActionTick(agent, world, INTRINSICS, t);
    }
    expect(agent.inventory.meat).toBe(0);
    expect(agent.needs.hunger).toBe(80);
  });

  it('the default village hosts two hunting grounds', () => {
    const grounds = DEFAULT_VILLAGE.objects.filter((o) => o.type === 'hunting_ground');
    expect(grounds).toHaveLength(2);
    expect(DEFAULT_VILLAGE.objects).toHaveLength(23);
  });
});
