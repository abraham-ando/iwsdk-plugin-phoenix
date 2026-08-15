import { describe, it, expect } from 'vitest';
import { SimKernel, TICKS_PER_DAY } from '../src/kernel/SimKernel';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { AgentRuntime } from '../src/agents/AgentRuntime';
import { snapshotSim, restoreSim } from '../src/kernel/snapshot';
import type { ActionEvent } from '../src/agents/actions';

function makeRegistry(): SmartObjectRegistry {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return reg;
}

/** A small self-sufficient camp: food, wood, flint, fire, storage, shelter. */
function buildVillage(seed: number) {
  const reg = makeRegistry();
  const kernel = new SimKernel({ seed });
  const world = new GroundTruthWorld(reg);
  world.attachTo(kernel);
  world.definePlace('camp_aube', 0, 0, 8);
  world.spawn('berry_bush', 4, 2);
  world.spawn('berry_bush', -4, 3);
  world.spawn('berry_bush', 2, -4);
  world.spawn('oak_tree', 6, -2);
  world.spawn('oak_tree', -6, -3);
  world.spawn('flint_deposit', 5, 4);
  world.spawn('campfire', 0, 0);
  world.spawn('camp_storage', 1, 1);
  world.spawn('shelter', -2, -2);

  const runtime = new AgentRuntime(world, reg);
  runtime.attachTo(kernel);
  runtime.addAgent({ id: 'eldrin', name: 'Eldrin', tribe: 'Aube', role: 'Chef' }, 0, 1);
  runtime.addAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'Cueilleuse' }, 1, 0);
  runtime.addAgent({ id: 'sylvia', name: 'Sylvia', tribe: 'Aube', role: 'Chasseresse' }, -1, 0);
  return { reg, kernel, world, runtime };
}

describe('village end-to-end (spec §13.2: autonomous civilization without LLM)', () => {
  it('three agents survive two simulated days by acting on their needs', () => {
    const { kernel, runtime } = buildVillage(11);
    const events: ActionEvent[] = [];
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
      kernel.step();
      events.push(...runtime.drainEvents());
    }

    const completed = events.filter((e) => e.type === 'completed');
    expect(completed.length).toBeGreaterThan(10);
    // Everyone ate at least once, from gathering to eating (grounded loop).
    for (const id of ['eldrin', 'mira', 'sylvia']) {
      const mine = completed.filter((e) => e.agentId === id).map((e) => e.verb);
      expect(mine).toContain('eat_berries');
      const agent = runtime.agents.get(id)!;
      expect(agent.needs.hunger).toBeGreaterThan(10);
    }
    // The cold chain fired: someone lit the fire or at least gathered fuel.
    const verbs = completed.map((e) => e.verb);
    expect(
      verbs.includes('light_fire') || verbs.includes('gather_wood') || verbs.includes('gather_flint')
    ).toBe(true);
  });

  it('two identical runs are bit-identical (agents included)', () => {
    const a = buildVillage(42);
    const b = buildVillage(42);
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      a.kernel.step();
      b.kernel.step();
    }
    expect(snapshotSim(a.kernel, a.world, a.runtime)).toEqual(
      snapshotSim(b.kernel, b.world, b.runtime)
    );
  });

  it('snapshot v2 round-trips agents and the restored village keeps living', () => {
    const run = buildVillage(7);
    for (let t = 0; t < 1200; t++) run.kernel.step();
    const snap = JSON.parse(JSON.stringify(snapshotSim(run.kernel, run.world, run.runtime)));
    expect(snap.version).toBe(2);
    expect(snap.agents).toHaveLength(3);

    const { kernel, runtime } = restoreSim(snap, makeRegistry());
    expect(runtime.agents.size).toBe(3);
    const hungerBefore = runtime.agents.get('mira')!.needs.hunger;
    for (let t = 0; t < 600; t++) kernel.step();
    const mira = runtime.agents.get('mira')!;
    // The restored agent kept acting (needs changed, actions ran).
    expect(mira.needs.hunger).not.toBe(hungerBefore);
  });

  it('restoreSim still accepts version 1 snapshots (no agents)', () => {
    const reg = makeRegistry();
    const kernel = new SimKernel({ seed: 1 });
    const world = new GroundTruthWorld(reg);
    world.spawn('berry_bush', 1, 1);
    const v1 = JSON.parse(JSON.stringify(snapshotSim(kernel, world)));
    v1.version = 1;
    delete v1.agents;
    const restored = restoreSim(v1, makeRegistry());
    expect(restored.world.get('berry_bush_1')).toBeDefined();
    expect(restored.runtime.agents.size).toBe(0);
  });
});
