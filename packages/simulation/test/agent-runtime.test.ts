import { describe, it, expect } from 'vitest';
import { AgentRuntime } from '../src/agents/AgentRuntime';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { SimKernel } from '../src/kernel/SimKernel';
import { getTerrainHeight } from '../src/world/terrain';

function setup() {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  const world = new GroundTruthWorld(reg);
  const runtime = new AgentRuntime(world, reg);
  const kernel = new SimKernel({ seed: 3 });
  world.attachTo(kernel);
  runtime.attachTo(kernel);
  return { reg, world, runtime, kernel };
}

describe('AgentRuntime', () => {
  it('a hungry agent autonomously walks to a bush, gathers and eats', () => {
    const { world, runtime, kernel } = setup();
    world.spawn('berry_bush', 5, 0);
    const agent = runtime.addAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'C' }, 0, 0);
    agent.needs.hunger = 15;

    for (let t = 0; t < 600; t++) kernel.step(); // 60 s simulées
    const events = runtime.drainEvents();
    const completed = events.filter((e) => e.type === 'completed').map((e) => e.verb);
    expect(completed).toContain('gather_berries');
    expect(completed).toContain('eat_berries');
    expect(agent.needs.hunger).toBeGreaterThan(15);
  });

  it('needs decay over time when idle', () => {
    const { runtime, kernel } = setup();
    const agent = runtime.addAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, -10, -10);
    const initialHunger = agent.needs.hunger;
    for (let t = 0; t < 100; t++) kernel.step();
    expect(agent.needs.hunger).toBeLessThan(initialHunger);
  });

  it('views project terrain height and semantic animation', () => {
    const { world, runtime, kernel } = setup();
    world.spawn('berry_bush', 5, 0);
    const agent = runtime.addAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, 0, 0);
    agent.needs.hunger = 15;
    for (let t = 0; t < 15; t++) kernel.step(); // perception au tick 10, puis départ
    const view = runtime.view('a')!;
    expect(view.y).toBe(getTerrainHeight(view.x, view.z));
    expect(view.animation).toBe('walk');
    expect(runtime.views()).toHaveLength(1);
  });

  it('agents are processed in sorted id order (determinism)', () => {
    const { runtime } = setup();
    runtime.addAgent({ id: 'zoe', name: 'Z', tribe: 'T', role: 'R' }, 0, 0);
    runtime.addAgent({ id: 'ana', name: 'A', tribe: 'T', role: 'R' }, 1, 0);
    expect(runtime.views().map((v) => v.id)).toEqual(['ana', 'zoe']);
  });
});
