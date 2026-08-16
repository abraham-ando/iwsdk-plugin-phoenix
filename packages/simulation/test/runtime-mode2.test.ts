import { describe, it, expect } from 'vitest';
import { AgentRuntime, MODE2_DAILY_BUDGET } from '../src/agents/AgentRuntime';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { SimKernel, TICKS_PER_DAY } from '../src/kernel/SimKernel';
import { EventLog } from '../src/kernel/EventLog';

function setup(seed = 5, replayLog?: EventLog) {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  const world = new GroundTruthWorld(reg);
  const kernel = replayLog ? new SimKernel({ seed, replayLog }) : new SimKernel({ seed });
  world.attachTo(kernel);
  const runtime = new AgentRuntime(world, reg);
  runtime.attachTo(kernel);
  return { reg, world, kernel, runtime };
}

const DAWN_TICK = Math.ceil((6 / 24) * TICKS_PER_DAY); // hour 6

describe('mode-2 triggers', () => {
  it('emits one dawn plan request per agent per day, budget capped', () => {
    const { kernel, runtime } = setup();
    const agent = runtime.addAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'C' }, 0, 0);
    agent.needs = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 }; // idle

    for (let t = 0; t < DAWN_TICK + 5; t++) kernel.step();
    const requests = runtime.drainPlanRequests();
    const dawns = requests.filter((r) => r.reason === 'dawn');
    expect(dawns).toHaveLength(1);
    expect(agent.mode2.pendingRequestId).toBe(dawns[0]!.requestId);
    expect(agent.mode2.budgetUsed).toBe(1);
    expect(MODE2_DAILY_BUDGET).toBe(12);

    // No second dawn request the same day, even after draining.
    for (let t = 0; t < 200; t++) kernel.step();
    expect(runtime.drainPlanRequests().filter((r) => r.reason === 'dawn')).toHaveLength(0);
  });

  it('a failed action triggers a surprise request and a memory', () => {
    const { world, kernel, runtime } = setup();
    const bush = world.spawn('berry_bush', 2, 0);
    const agent = runtime.addAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, 0, 0);
    agent.needs.hunger = 15;
    for (let t = 0; t < 12; t++) kernel.step(); // perceives the full bush
    bush.state.berriesLeft = 0;                 // emptied behind its back
    for (let t = 0; t < 300; t++) kernel.step(); // walks, fails, surprise
    const surprise = runtime.drainPlanRequests().find((r) => r.reason === 'surprise');
    expect(surprise).toBeDefined();
    expect(agent.memories.all().some((m) => m.text.includes('Échec'))).toBe(true);
  });
});

describe('mode-2 plan execution', () => {
  it('an injected llm_plan drives the agent through its steps', () => {
    const { world, kernel, runtime } = setup();
    const bush = world.spawn('berry_bush', 3, 0);
    const agent = runtime.addAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'C' }, 0, 0);
    agent.needs = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    for (let t = 0; t < 12; t++) kernel.step(); // perception -> belief on the bush
    runtime.drainPlanRequests();

    kernel.submitEvent('llm_plan', {
      requestId: 'x',
      agentId: 'mira',
      steps: [
        { goal: 'récolter', verb: 'gather_berries', objectId: bush.id, predicted: '+2 baies' },
        { goal: 'goûter', verb: 'eat_berries', predicted: 'faim +30' },
      ],
    });
    for (let t = 0; t < 400; t++) kernel.step();
    const done = runtime.drainEvents().filter((e) => e.type === 'completed').map((e) => e.verb);
    expect(done).toContain('gather_berries');
    expect(done).toContain('eat_berries');
    expect(agent.plan).toHaveLength(0);
  });

  it('an urgent need overrides the plan (LeCun arbitration)', () => {
    const { world, kernel, runtime } = setup();
    world.spawn('berry_bush', 2, 0);
    const oak = world.spawn('oak_tree', 5, 5); // within NIGHT vision (tick 10 is midnight), so believed
    const agent = runtime.addAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, 0, 0);
    agent.needs.hunger = 5; // extreme urgency
    for (let t = 0; t < 12; t++) kernel.step();
    kernel.submitEvent('llm_plan', {
      requestId: 'x',
      agentId: 'a',
      steps: [{ goal: 'bois', verb: 'gather_wood', objectId: oak.id, predicted: '+1 bois' }],
    });
    for (let t = 0; t < 60; t++) kernel.step();
    // The reflex (food) preempted the plan step (wood): the plan is untouched.
    expect(agent.plan).toHaveLength(1);
    const started = runtime.drainEvents().filter((e) => e.type === 'started').map((e) => e.verb);
    expect(started).toContain('gather_berries');
    expect(started).not.toContain('gather_wood');
  });

  it('llm events ride the journal: replay reproduces the run', () => {
    const live = setup(9);
    const bush = live.world.spawn('berry_bush', 3, 0);
    live.runtime.addAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'C' }, 0, 0);
    for (let t = 0; t < 12; t++) live.kernel.step();
    live.kernel.submitEvent('llm_plan', {
      requestId: 'x',
      agentId: 'mira',
      steps: [{ goal: 'r', verb: 'gather_berries', objectId: bush.id, predicted: 'p' }],
    });
    for (let t = 0; t < 200; t++) live.kernel.step();

    const replay = setup(9, EventLog.fromJSON(live.kernel.log.toJSON()));
    replay.world.spawn('berry_bush', 3, 0);
    replay.runtime.addAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'C' }, 0, 0);
    for (let t = 0; t < 212; t++) replay.kernel.step();

    const a = live.runtime.agents.get('mira')!;
    const b = replay.runtime.agents.get('mira')!;
    expect([b.x, b.z, b.inventory]).toEqual([a.x, a.z, a.inventory]);
  });

  it('dialogue trigger: two idle neighbors request one dialogue with cooldown', () => {
    const { kernel, runtime } = setup();
    const a = runtime.addAgent({ id: 'ana', name: 'Ana', tribe: 'T', role: 'R' }, 0, 0);
    const b = runtime.addAgent({ id: 'ben', name: 'Ben', tribe: 'T', role: 'R' }, 1, 0);
    a.needs = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    b.needs = { ...a.needs };
    for (let t = 0; t < 30; t++) kernel.step();
    const dialogues = runtime.drainPlanRequests().filter((r) => r.reason === 'dialogue');
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0]?.participantIds).toEqual(['ana', 'ben']);
    for (let t = 0; t < 100; t++) kernel.step();
    expect(runtime.drainPlanRequests().filter((r) => r.reason === 'dialogue')).toHaveLength(0);
  });

  it('llm_dialogue plants memories, beliefs (rumor) and speech bubbles', () => {
    const { kernel, runtime } = setup();
    const a = runtime.addAgent({ id: 'ana', name: 'Ana', tribe: 'T', role: 'R' }, 0, 0);
    const b = runtime.addAgent({ id: 'ben', name: 'Ben', tribe: 'T', role: 'R' }, 1, 0);
    kernel.submitEvent('llm_dialogue', {
      requestId: 'd',
      agentId: 'ana',
      participantIds: ['ana', 'ben'],
      lines: [
        { speaker: 'ana', text: 'Le gisement de silex de la crête est riche.' },
        { speaker: 'ben', text: 'Bon à savoir, j’irai demain.' },
      ],
      sharedFacts: [
        { objectId: 'flint_deposit_9', type: 'flint_deposit', x: 20, z: -14, state: { flintLeft: 6 } },
      ],
    });
    kernel.step();
    expect(a.memories.all().some((m) => m.kind === 'dialogue')).toBe(true);
    expect(b.beliefs.get('flint_deposit_9')?.type).toBe('flint_deposit'); // rumor became belief
    expect(runtime.view('ana')?.dialogue).toContain('silex');
    for (let t = 0; t < 60; t++) kernel.step();
    expect(runtime.view('ana')?.dialogue).toBeNull(); // bubble expired
  });

  it('reflection insights become high-importance memories', () => {
    const { kernel, runtime } = setup();
    const agent = runtime.addAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, 0, 0);
    kernel.submitEvent('llm_reflection', {
      requestId: 'r',
      agentId: 'a',
      insights: ['La rivière nord s’épuise', 'Mira est loyale'],
    });
    kernel.step();
    const reflections = agent.memories.all().filter((m) => m.kind === 'reflection');
    expect(reflections).toHaveLength(2);
    expect(reflections[0]?.importance).toBe(8);
  });
});
