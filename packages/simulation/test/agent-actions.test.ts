import { describe, it, expect } from 'vitest';
import { createAgent, type CurrentAction } from '../src/agents/AgentState';
import { executeActionTick } from '../src/agents/actions';
import { defaultIntrinsics } from '../src/agents/intrinsics';
import { perceive } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';

const NOON = TICKS_PER_DAY / 2;
const INTRINSICS = defaultIntrinsics();

function setup() {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  const world = new GroundTruthWorld(reg);
  const agent = createAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'Cueilleuse' }, 0, 0);
  return { world, agent };
}

function worldAction(objectId: string, verb: string, x: number, z: number): CurrentAction {
  return { kind: 'world', objectId, verb, phase: 'goto', targetX: x, targetZ: z, remainingTicks: 0 };
}

describe('executeActionTick — world actions', () => {
  it('walks to a bush, gathers, and completes with loot', () => {
    const { world, agent } = setup();
    const bush = world.spawn('berry_bush', 3, 0);
    agent.beliefs.update(perceive(world, { id: 'mira', x: 0, z: 0 }, [], NOON));
    agent.currentAction = worldAction(bush.id, 'gather_berries', bush.x, bush.z);

    let completed = false;
    for (let t = 0; t < 300 && !completed; t++) {
      const ev = executeActionTick(agent, world, INTRINSICS, NOON + t);
      if (ev?.type === 'completed') completed = true;
      expect(ev?.type).not.toBe('failed');
    }
    expect(completed).toBe(true);
    expect(agent.inventory.berries).toBe(2);
    expect(bush.state.berriesLeft).toBe(10);
    expect(agent.currentAction).toBeNull();
    expect(Math.hypot(agent.x - bush.x, agent.z - bush.z)).toBeLessThan(1.5);
  });

  it('fails with surprise when the believed object is empty in reality', () => {
    const { world, agent } = setup();
    const bush = world.spawn('berry_bush', 2, 0);
    agent.beliefs.update(perceive(world, { id: 'mira', x: 0, z: 0 }, [], NOON));
    bush.state.berriesLeft = 0; // emptied behind the agent's back
    agent.currentAction = worldAction(bush.id, 'gather_berries', bush.x, bush.z);

    let failed: string | undefined;
    for (let t = 0; t < 300 && failed === undefined; t++) {
      const ev = executeActionTick(agent, world, INTRINSICS, NOON + t);
      if (ev?.type === 'failed') failed = ev.reason;
    }
    expect(failed).toContain('berriesLeft');
    expect(agent.currentAction).toBeNull();
  });

  it('sleeping is set during rest/sleep performs', () => {
    const { world, agent } = setup();
    const fire = world.spawn('campfire', 0.5, 0);
    fire.state.lit = 1;
    agent.currentAction = worldAction(fire.id, 'rest_nearby', fire.x, fire.z);
    executeActionTick(agent, world, INTRINSICS, NOON);      // arrive -> perform
    executeActionTick(agent, world, INTRINSICS, NOON + 1);  // performing
    expect(agent.sleeping).toBe(true);
  });
});

describe('executeActionTick — intrinsic actions', () => {
  it('eats berries from inventory and restores hunger', () => {
    const { world, agent } = setup();
    agent.inventory.berries = 1;
    agent.needs.hunger = 40;
    agent.currentAction = { kind: 'intrinsic', verb: 'eat_berries', remainingTicks: 20 };
    let completed = false;
    for (let t = 0; t < 25 && !completed; t++) {
      if (executeActionTick(agent, world, INTRINSICS, NOON + t)?.type === 'completed') completed = true;
    }
    expect(completed).toBe(true);
    expect(agent.inventory.berries).toBe(0);
    expect(agent.needs.hunger).toBe(70);
    expect(agent.sleeping).toBe(false);
  });
});
