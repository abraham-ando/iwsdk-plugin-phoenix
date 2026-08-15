import { describe, it, expect } from 'vitest';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { SimKernel, TICKS_PER_DAY } from '../src/kernel/SimKernel';

function makeWorld(): GroundTruthWorld {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return new GroundTruthWorld(reg);
}

describe('GroundTruthWorld', () => {
  it('spawns instances with deterministic ids and initial state copies', () => {
    const world = makeWorld();
    const a = world.spawn('berry_bush', 10, 5);
    const b = world.spawn('berry_bush', -8, 3);
    expect(a.id).toBe('berry_bush_1');
    expect(b.id).toBe('berry_bush_2');
    a.state.berriesLeft = 0;
    expect(b.state.berriesLeft).toBe(12); // states are independent copies
    expect(world.get('berry_bush_2')?.x).toBe(-8);
  });

  it('objectsNear uses the spatial grid, sorted by id', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 1, 1);
    world.spawn('oak_tree', 2, 0);
    world.spawn('flint_deposit', 30, 30);
    expect(world.objectsNear(0, 0, 5).map((o) => o.type)).toEqual(['berry_bush', 'oak_tree']);
  });

  it('availableAffordances filters by preconditions', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 1, 0);
    world.spawn('campfire', 0.5, 0.5);
    const poor = { x: 0, z: 0, inventory: {} };
    const verbs = world.availableAffordances(poor, 12).map((r) => r.affordance.verb);
    expect(verbs).toContain('gather_berries');
    expect(verbs).not.toContain('light_fire'); // no wood/flint in inventory
    const equipped = { x: 0, z: 0, inventory: { wood: 1, flint: 1 } };
    expect(
      world.availableAffordances(equipped, 12).map((r) => r.affordance.verb)
    ).toContain('light_fire');
  });

  it('named places resolve by containment, nearest-defined-first wins', () => {
    const world = makeWorld();
    world.definePlace('camp_aube', 0, 0, 6);
    world.definePlace('riviere_nord', 4, -20, 5);
    expect(world.placeAt(1, 1)).toBe('camp_aube');
    expect(world.placeAt(4, -18)).toBe('riviere_nord');
    expect(world.placeAt(30, 30)).toBeNull();
    expect(world.getPlace('camp_aube')).toEqual({ name: 'camp_aube', x: 0, z: 0, radius: 6 });
  });

  it('day regrowth restores stocks up to their cap', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 0, 0);
    bush.state.berriesLeft = 3;
    world.applyDayRegrowth();
    expect(bush.state.berriesLeft).toBe(7);
    world.applyDayRegrowth();
    world.applyDayRegrowth();
    expect(bush.state.berriesLeft).toBe(12); // capped at max
  });

  it('attachTo(kernel) applies regrowth on day starts only', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 0, 0);
    bush.state.berriesLeft = 0;
    const kernel = new SimKernel({ seed: 1 });
    world.attachTo(kernel);
    for (let i = 0; i < TICKS_PER_DAY - 1; i++) kernel.step();
    expect(bush.state.berriesLeft).toBe(0);
    kernel.step(); // tick TICKS_PER_DAY -> day start
    expect(bush.state.berriesLeft).toBe(4);
  });

  it('JSON round-trips the full world', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 1, 2).state.berriesLeft = 5;
    world.spawn('campfire', 0, 0);
    world.definePlace('camp_aube', 0, 0, 6);

    const reg = new SmartObjectRegistry();
    registerDefaultContent(reg);
    const restored = GroundTruthWorld.fromJSON(
      JSON.parse(JSON.stringify(world.toJSON())),
      reg
    );
    expect(restored.toJSON()).toEqual(world.toJSON());
    expect(restored.get('berry_bush_1')?.state.berriesLeft).toBe(5);
    // Counter continues after restore: no id collision.
    expect(restored.spawn('berry_bush', 9, 9).id).toBe('berry_bush_3');
  });
});
