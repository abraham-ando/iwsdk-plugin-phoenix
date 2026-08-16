import { describe, it, expect } from 'vitest';
import { buildPlanRequest, parsePlanSteps } from '../src/agents/Mode2';
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
  const agent = createAgent(
    { id: 'mira', name: 'Mira', tribe: 'Aube', role: 'Cueilleuse', persona: 'Douce et prévoyante' },
    0,
    0
  );
  return { reg, world, agent };
}

describe('buildPlanRequest', () => {
  it('assembles a serializable request from beliefs only', () => {
    const { reg, world, agent } = setup();
    const bush = world.spawn('berry_bush', 3, 0);
    agent.beliefs.update(perceive(world, { id: 'mira', x: 0, z: 0 }, [], NOON));
    agent.memories.add({ tick: NOON - 10, text: 'le feu était éteint ce matin', importance: 5, kind: 'event' });
    const req = buildPlanRequest(agent, reg, INTRINSICS, NOON, 'dawn', 'camp_aube');
    expect(req.requestId).toBe(`mira:${NOON}:dawn`);
    expect(req.persona).toBe('Douce et prévoyante');
    expect(req.beliefs.map((b) => b.objectId)).toContain(bush.id);
    expect(req.tools.some((t) => t.verb === 'gather_berries' && t.objectId === bush.id)).toBe(true);
    expect(req.tools.some((t) => t.verb === 'eat_berries' && t.objectId === undefined)).toBe(true);
    expect(req.memories[0]).toContain('feu');
    expect(() => JSON.stringify(req)).not.toThrow();
  });
});

describe('parsePlanSteps', () => {
  it('keeps valid steps and drops unknown verbs or unbelieved objects', () => {
    const { reg, world, agent } = setup();
    const bush = world.spawn('berry_bush', 3, 0);
    agent.beliefs.update(perceive(world, { id: 'mira', x: 0, z: 0 }, [], NOON));
    const steps = parsePlanSteps(
      {
        steps: [
          { goal: 'manger', verb: 'gather_berries', objectId: bush.id, predicted: 'j’aurai 2 baies' },
          { goal: 'tricher', verb: 'summon_dragon', objectId: bush.id, predicted: 'x' },
          { goal: 'voler', verb: 'gather_wood', objectId: 'oak_tree_99', predicted: 'x' },
          { goal: 'me nourrir', verb: 'eat_berries', predicted: 'faim +30' },
        ],
      },
      reg,
      INTRINSICS,
      agent
    );
    expect(steps.map((s) => s.verb)).toEqual(['gather_berries', 'eat_berries']);
  });

  it('returns [] on malformed payloads without throwing', () => {
    const { reg, agent } = setup();
    expect(parsePlanSteps(null, reg, INTRINSICS, agent)).toEqual([]);
    expect(parsePlanSteps({ steps: 'nope' }, reg, INTRINSICS, agent)).toEqual([]);
    expect(parsePlanSteps({ steps: [{ verb: 42 }] }, reg, INTRINSICS, agent)).toEqual([]);
  });
});
