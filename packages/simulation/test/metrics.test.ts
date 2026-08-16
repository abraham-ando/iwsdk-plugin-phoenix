import { describe, it, expect } from 'vitest';
import { buildVillageSim } from '../src/content/scenario';
import { MetricsCollector, METRICS_SAMPLE_PERIOD } from '../src/telemetry/MetricsCollector';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';

describe('MetricsCollector', () => {
  it('accumulates wellbeing, divergence and action counters over a day', () => {
    const sim = buildVillageSim(11);
    const collector = new MetricsCollector(sim.world, sim.runtime);
    collector.attachTo(sim.kernel);
    for (let t = 0; t < TICKS_PER_DAY; t++) sim.kernel.step();
    const m = collector.metrics();
    expect(m.ticks).toBe(TICKS_PER_DAY);
    expect(m.samples).toBe(TICKS_PER_DAY / METRICS_SAMPLE_PERIOD);
    const mira = m.perAgent.mira!;
    expect(mira.wellbeingCostIntegral).toBeGreaterThan(0);
    expect(mira.avgBeliefDivergence).toBeGreaterThanOrEqual(0);
    expect(mira.avgBeliefDivergence).toBeLessThanOrEqual(1);
    expect(mira.reflexActionsStarted).toBeGreaterThan(0);
  });

  it('attributes plan step outcomes to the plan counters', () => {
    const sim = buildVillageSim(3);
    const collector = new MetricsCollector(sim.world, sim.runtime);
    collector.attachTo(sim.kernel);
    for (let t = 0; t < 12; t++) sim.kernel.step();
    const mira = sim.runtime.agents.get('mira')!;
    mira.needs = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    const bushId = mira.beliefs.byType('berry_bush')[0]!.objectId;
    sim.kernel.submitEvent('llm_plan', {
      requestId: 'x',
      agentId: 'mira',
      steps: [{ goal: 'g', verb: 'gather_berries', objectId: bushId, predicted: 'p' }],
    });
    for (let t = 0; t < 300; t++) sim.kernel.step();
    expect(collector.metrics().perAgent.mira!.planStepsCompleted).toBeGreaterThanOrEqual(1);
  });

  it('recording does not perturb the simulation (same snapshot with and without)', () => {
    const a = buildVillageSim(7);
    const b = buildVillageSim(7);
    new MetricsCollector(a.world, a.runtime).attachTo(a.kernel);
    for (let t = 0; t < 600; t++) {
      a.kernel.step();
      b.kernel.step();
    }
    const [sa, sb] = [a, b].map((s) =>
      JSON.stringify([s.kernel.tick, s.kernel.rng.getState(), s.world.toJSON()])
    );
    expect(sa).toBe(sb);
  });
});
