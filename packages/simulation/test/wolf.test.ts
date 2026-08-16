import { describe, it, expect } from 'vitest';
import { buildVillageSim } from '../src/content/scenario';
import { WolfSystem } from '../src/world/WolfSystem';

function setupWithWolf(seed: number) {
  const sim = buildVillageSim(seed);
  const wolf = new WolfSystem(sim.world, sim.runtime);
  sim.runtime.attachWolf(wolf);
  wolf.attachTo(sim.kernel);
  return { ...sim, wolf };
}

describe('WolfSystem', () => {
  it('is deterministic: same seed, same wolf trajectory', () => {
    const a = setupWithWolf(5);
    const b = setupWithWolf(5);
    for (let t = 0; t < 1200; t++) {
      a.kernel.step();
      b.kernel.step();
    }
    expect(a.wolf.state()).toEqual(b.wolf.state());
  });

  it('hunger drives it to a hunting ground where it eats game', () => {
    const sim = setupWithWolf(7);
    const before = sim.world
      .objectsNear(0, 0, 1000)
      .filter((o) => o.type === 'hunting_ground')
      .reduce((s, o) => s + (o.state.gameLeft ?? 0), 0);
    // Force hunger so the hunt starts immediately.
    sim.wolf.state(); // (read-only check below uses internals via forceState)
    sim.wolf.forceState({ hunger: 30, mode: 'hunt' });
    // ~10 m to the nearest ground at 0.18 m/tick: 600 ticks is 10x the need.
    for (let t = 0; t < 600; t++) sim.kernel.step();
    const after = sim.world
      .objectsNear(0, 0, 1000)
      .filter((o) => o.type === 'hunting_ground')
      .reduce((s, o) => s + (o.state.gameLeft ?? 0), 0);
    expect(after).toBeLessThan(before);
    expect(sim.wolf.state().hunger).toBeGreaterThan(30);
  });

  it('a nearby wolf frightens an agent: stress, memory, retreat to the fire', () => {
    const sim = setupWithWolf(3);
    const mira = sim.runtime.agents.get('mira')!;
    mira.needs = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    // Drop the wolf right next to mira (mira ~(-1, -3.8); no lit fire within 4m of her? the
    // camp fire at (0,-4.5) is ~1.2m away and lit -> extinguish it to force retreat).
    for (const fire of sim.world.objectsNear(0, -4.5, 2).filter((o) => o.type === 'campfire')) {
      fire.state.lit = 0;
    }
    sim.wolf.forceState({ x: -2, z: -3.5, mode: 'stalk', hunger: 20 });
    for (let t = 0; t < 30; t++) sim.kernel.step();
    expect(mira.needs.stress).toBeGreaterThan(0);
    expect(mira.memories.all().some((m) => m.text.includes('loup'))).toBe(true);
  });

  it('flees from a lit campfire', () => {
    const sim = setupWithWolf(3);
    sim.wolf.forceState({ x: 1, z: -4.5, mode: 'stalk', hunger: 20 }); // next to lit Aube fire
    sim.kernel.step();
    expect(sim.wolf.state().mode).toBe('flee');
  });

  it('serializes and restores through toJSON/fromJSON', () => {
    const sim = setupWithWolf(9);
    for (let t = 0; t < 500; t++) sim.kernel.step();
    const json = JSON.parse(JSON.stringify(sim.wolf.toJSON()));
    const restored = WolfSystem.fromJSON(json, sim.world, sim.runtime);
    expect(restored.state()).toEqual(sim.wolf.state());
  });
});
