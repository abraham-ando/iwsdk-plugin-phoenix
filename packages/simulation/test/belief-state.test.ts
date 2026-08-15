import { describe, it, expect } from 'vitest';
import { BeliefState } from '../src/agents/BeliefState';
import { perceive } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';

const NOON = TICKS_PER_DAY / 2;

function makeWorld(): GroundTruthWorld {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return new GroundTruthWorld(reg);
}

describe('BeliefState', () => {
  it('learns objects from observations and dates them', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    const known = beliefs.known();
    expect(known).toHaveLength(1);
    expect(known[0]?.type).toBe('berry_bush');
    expect(known[0]?.lastSeenTick).toBe(NOON);
    expect(beliefs.byType('berry_bush')).toHaveLength(1);
  });

  it('beliefs go stale: the world changes, the belief does not', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    bush.state.berriesLeft = 0; // someone else empties the bush
    expect(beliefs.get(bush.id)?.state.berriesLeft).toBe(12); // still believed full
  });

  it('re-observation refreshes the belief', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    bush.state.berriesLeft = 4;
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON + 100));
    expect(beliefs.get(bush.id)?.state.berriesLeft).toBe(4);
    expect(beliefs.get(bush.id)?.lastSeenTick).toBe(NOON + 100);
  });

  it('divergenceFrom measures belief accuracy (spec §6.2)', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    expect(beliefs.divergenceFrom(world)).toBe(0); // fresh = exact
    bush.state.berriesLeft = 0;                    // 1 field of 1 now wrong
    expect(beliefs.divergenceFrom(world)).toBe(1);
    expect(new BeliefState().divergenceFrom(world)).toBe(0); // no beliefs, no error
  });

  it('forget removes a belief (used when an expected object is gone)', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    beliefs.forget(bush.id);
    expect(beliefs.known()).toHaveLength(0);
  });

  it('JSON round-trips', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    const restored = BeliefState.fromJSON(JSON.parse(JSON.stringify(beliefs.toJSON())));
    expect(restored.known()).toEqual(beliefs.known());
  });
});
