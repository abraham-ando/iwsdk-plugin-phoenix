import { describe, it, expect } from 'vitest';
import { buildVillageSim } from '../src/content/scenario';
import type { ActionEvent } from '../src/agents/actions';

describe('runtime observers', () => {
  it('subscribeEvents observes without consuming drainEvents', () => {
    const sim = buildVillageSim(3);
    const seen: ActionEvent[] = [];
    sim.runtime.subscribeEvents((e) => seen.push(e));
    for (let t = 0; t < 300; t++) sim.kernel.step();
    const drained = sim.runtime.drainEvents();
    expect(seen.length).toBeGreaterThan(0);
    expect(drained.length).toBe(seen.length); // both saw everything
  });

  it('subscribePlanRequests observes the outbox non-destructively', () => {
    const sim = buildVillageSim(3);
    let observed = 0;
    sim.runtime.subscribePlanRequests(() => observed++);
    for (let t = 0; t < 700; t++) sim.kernel.step(); // crosses dawn
    const drained = sim.runtime.drainPlanRequests();
    expect(observed).toBeGreaterThan(0);
    expect(drained.length).toBe(observed);
  });

  it('started events carry provenance: reflex vs plan with prediction', () => {
    const sim = buildVillageSim(3);
    const started: ActionEvent[] = [];
    sim.runtime.subscribeEvents((e) => {
      if (e.type === 'started') started.push(e);
    });
    for (let t = 0; t < 12; t++) sim.kernel.step();
    const mira = sim.runtime.agents.get('mira')!;
    mira.needs = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    const bushId = mira.beliefs.byType('berry_bush')[0]?.objectId;
    expect(bushId).toBeDefined();
    sim.kernel.submitEvent('llm_plan', {
      requestId: 'x',
      agentId: 'mira',
      steps: [{ goal: 'g', verb: 'gather_berries', objectId: bushId, predicted: '+2 baies' }],
    });
    for (let t = 0; t < 300; t++) sim.kernel.step();
    expect(started.some((e) => e.source === 'reflex')).toBe(true);
    const planStart = started.find((e) => e.source === 'plan');
    expect(planStart?.predicted).toBe('+2 baies');
    expect(planStart?.objectId).toBe(bushId);
  });
});
