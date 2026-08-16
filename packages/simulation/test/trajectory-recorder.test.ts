import { describe, it, expect } from 'vitest';
import { buildVillageSim } from '../src/content/scenario';
import { TrajectoryRecorder } from '../src/telemetry/TrajectoryRecorder';
import { mockPlanResponse } from '../src/telemetry/MockPlanner';

function runWithMockPlanner(seed: number, ticks: number) {
  const sim = buildVillageSim(seed);
  const recorder = new TrajectoryRecorder(sim.runtime, seed, sim.weather);
  recorder.attachTo(sim.kernel);
  for (let t = 0; t < ticks; t++) {
    sim.kernel.step();
    for (const request of sim.runtime.drainPlanRequests()) {
      sim.kernel.submitEvent(
        request.reason === 'dialogue'
          ? 'llm_dialogue'
          : request.reason === 'reflection'
            ? 'llm_reflection'
            : 'llm_plan',
        mockPlanResponse(request)
      );
    }
  }
  return { sim, recorder };
}

describe('TrajectoryRecorder', () => {
  it('produces the three streams over a simulated day', () => {
    const { recorder } = runWithMockPlanner(11, 2400);
    const batch = recorder.drain();
    expect(batch.decisions.length).toBeGreaterThan(0);
    expect(batch.predictions.length).toBeGreaterThan(0);
    expect(batch.episodes.length).toBeGreaterThan(2400 / 50 - 1);
    // decisions are tool-calling shaped
    const d = batch.decisions[0] as { messages: Array<{ role: string }>; tools: unknown[] };
    expect(d.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(d.tools.length).toBeGreaterThan(0);
    // predictions carry the LeCun quadruplet fields
    const p = batch.predictions[0] as Record<string, unknown>;
    for (const key of ['verb', 'predicted', 'outcome', 'needsDelta', 'inventoryDelta', 'surprise']) {
      expect(p).toHaveProperty(key);
    }
    // drain() empties the buffers
    expect(recorder.drain().decisions).toHaveLength(0);
  });

  it('is deterministic at fixed seed', () => {
    const a = runWithMockPlanner(21, 1200).recorder.drain();
    const b = runWithMockPlanner(21, 1200).recorder.drain();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('toJsonl emits one JSON object per line', () => {
    const jsonl = TrajectoryRecorder.toJsonl([{ a: 1 }, { b: 2 }]);
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ a: 1 });
    expect(TrajectoryRecorder.toJsonl([])).toBe('');
  });
});
