import { describe, it, expect } from 'vitest';
import { perceive, DAY_VISION, NIGHT_VISION, HEARING_RADIUS } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';

function makeWorld(): GroundTruthWorld {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return new GroundTruthWorld(reg);
}

const NOON_TICK = TICKS_PER_DAY / 2;      // hour 12
const MIDNIGHT_TICK = TICKS_PER_DAY;      // hour 0

describe('perceive', () => {
  it('sees nearby objects with their state and verbs, sorted by id', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 3, 0);       // 3 m away
    world.spawn('oak_tree', 40, 40);       // far away
    const obs = perceive(world, { id: 'a1', x: 0, z: 0 }, [], NOON_TICK);
    expect(obs.visionRadius).toBe(DAY_VISION);
    expect(obs.objects).toHaveLength(1);
    expect(obs.objects[0]?.type).toBe('berry_bush');
    expect(obs.objects[0]?.state.berriesLeft).toBe(12);
    expect(obs.objects[0]?.verbs).toEqual(['gather_berries']);
    expect(obs.objects[0]?.distance).toBeCloseTo(3);
  });

  it('shrinks vision at night', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 10, 0);      // visible by day (12), not by night (8)
    const day = perceive(world, { id: 'a1', x: 0, z: 0 }, [], NOON_TICK);
    const night = perceive(world, { id: 'a1', x: 0, z: 0 }, [], MIDNIGHT_TICK);
    expect(night.night).toBe(true);
    expect(night.visionRadius).toBe(NIGHT_VISION);
    expect(day.objects).toHaveLength(1);
    expect(night.objects).toHaveLength(0);
  });

  it('splits other agents into seen and heard', () => {
    const world = makeWorld();
    const others = [
      { id: 'close', x: 5, z: 0, verb: 'gather_wood', distance: 0 },
      { id: 'audible', x: 15, z: 0, verb: null, distance: 0 },
      { id: 'gone', x: 30, z: 0, verb: null, distance: 0 },
    ];
    const obs = perceive(world, { id: 'me', x: 0, z: 0 }, others, NOON_TICK);
    expect(obs.agents.map((a) => a.id)).toEqual(['close']);
    expect(obs.heard.map((a) => a.id)).toEqual(['audible']);
    expect(HEARING_RADIUS).toBe(20);
  });

  it('reports the named place the agent stands in', () => {
    const world = makeWorld();
    world.definePlace('camp_aube', 0, 0, 6);
    const obs = perceive(world, { id: 'me', x: 1, z: 1 }, [], NOON_TICK);
    expect(obs.place).toBe('camp_aube');
  });

  it('state in observations is a copy, not a live reference', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 1, 0);
    const obs = perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON_TICK);
    bush.state.berriesLeft = 0;
    expect(obs.objects[0]?.state.berriesLeft).toBe(12);
  });
});
