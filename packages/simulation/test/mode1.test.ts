import { describe, it, expect } from 'vitest';
import { selectAction } from '../src/agents/Mode1';
import { createAgent } from '../src/agents/AgentState';
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
  const agent = createAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, 0, 0);
  const see = () => agent.beliefs.update(perceive(world, { id: 'a', x: agent.x, z: agent.z }, [], NOON));
  return { reg, world, agent, see };
}

describe('selectAction', () => {
  it('hungry with berries in inventory -> eat them (intrinsic beats travel)', () => {
    const { reg, world, agent, see } = setup();
    world.spawn('berry_bush', 8, 0);
    see();
    agent.needs.hunger = 20;
    agent.inventory.berries = 2;
    const action = selectAction(agent, reg, INTRINSICS);
    expect(action).toEqual({ kind: 'intrinsic', verb: 'eat_berries', remainingTicks: 20 });
  });

  it('hungry without food -> go gather the believed bush (provider chain)', () => {
    const { reg, world, agent, see } = setup();
    const bush = world.spawn('berry_bush', 8, 0);
    see();
    agent.needs.hunger = 20;
    const action = selectAction(agent, reg, INTRINSICS);
    expect(action).toMatchObject({ kind: 'world', objectId: bush.id, verb: 'gather_berries' });
  });

  it('cold at an unlit fire with empty hands -> gather wood or flint (depth-3 chain)', () => {
    const { reg, world, agent, see } = setup();
    world.spawn('campfire', 1, 0);          // lit=0: rest_nearby blocked
    world.spawn('oak_tree', 5, 0);
    world.spawn('flint_deposit', 6, 0);
    see();
    agent.needs.warmth = 10;
    agent.needs.hunger = 90;                // hunger not urgent
    const action = selectAction(agent, reg, INTRINSICS);
    expect(action?.kind).toBe('world');
    if (action?.kind === 'world') {
      expect(['gather_wood', 'gather_flint']).toContain(action.verb);
    }
  });

  it('cold with wood and flint at an unlit fire -> light it', () => {
    const { reg, world, agent, see } = setup();
    const fire = world.spawn('campfire', 1, 0);
    see();
    agent.needs.warmth = 10;
    agent.needs.hunger = 90;
    agent.inventory.wood = 2;
    agent.inventory.flint = 1;
    const action = selectAction(agent, reg, INTRINSICS);
    expect(action).toMatchObject({ kind: 'world', objectId: fire.id, verb: 'light_fire' });
  });

  it('fully satisfied -> no action (idle)', () => {
    const { reg, world, agent, see } = setup();
    world.spawn('berry_bush', 3, 0);
    see();
    agent.needs = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    expect(selectAction(agent, reg, INTRINSICS)).toBeNull();
  });

  it('is deterministic on ties', () => {
    const { reg, world, agent, see } = setup();
    world.spawn('berry_bush', 4, 0);
    world.spawn('berry_bush', -4, 0);       // symmetric alternatives
    see();
    agent.needs.hunger = 20;
    const first = selectAction(agent, reg, INTRINSICS);
    for (let i = 0; i < 5; i++) {
      expect(selectAction(agent, reg, INTRINSICS)).toEqual(first);
    }
  });
});
