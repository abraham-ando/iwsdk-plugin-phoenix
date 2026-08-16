/**
 * Headless batch runner (spec §8.5, §13.5): the SAME engine and village the
 * VR headset renders, driven as fast as the CPU allows, with a deterministic
 * mock planner answering Mode-2 requests — the dataset factory's assembly
 * line. This is the package's ONLY file with disk I/O; it is a separate
 * build entry, never imported by index.ts.
 *
 * CLI: node dist/headless.js --seed 42 --days 2 --runs 3 --out ./datasets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TICKS_PER_DAY } from './kernel/SimKernel';
import { snapshotSim, type SimSnapshot } from './kernel/snapshot';
import { buildVillageSim } from './content/scenario';
import { MetricsCollector, type RunMetrics } from './telemetry/MetricsCollector';
import { TrajectoryRecorder, type TrajectoryBatch } from './telemetry/TrajectoryRecorder';
import { mockPlanResponse } from './telemetry/MockPlanner';

export interface HeadlessOptions {
  seed: number;
  days: number;
  planner?: 'mock' | 'none';
  onDay?: (day: number) => void;
}

export interface HeadlessResult {
  seed: number;
  days: number;
  metrics: RunMetrics;
  batch: TrajectoryBatch;
  snapshot: SimSnapshot;
}

export function runHeadlessSim(options: HeadlessOptions): HeadlessResult {
  const { seed, days, planner = 'mock', onDay } = options;
  const sim = buildVillageSim(seed);
  const recorder = new TrajectoryRecorder(sim.runtime, seed, sim.weather);
  recorder.attachTo(sim.kernel);
  const collector = new MetricsCollector(sim.world, sim.runtime);
  collector.attachTo(sim.kernel);

  const totalTicks = days * TICKS_PER_DAY;
  for (let t = 1; t <= totalTicks; t++) {
    sim.kernel.step();
    if (planner === 'mock') {
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
    if (t % TICKS_PER_DAY === 0 && onDay !== undefined) {
      onDay(t / TICKS_PER_DAY);
    }
  }

  return {
    seed,
    days,
    metrics: collector.metrics(),
    batch: recorder.drain(),
    snapshot: snapshotSim(sim.kernel, sim.world, sim.runtime, sim.weather),
  };
}

export function writeHeadlessRun(outDir: string, runId: string, result: HeadlessResult): void {
  const dir = join(outDir, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'decisions.jsonl'), TrajectoryRecorder.toJsonl(result.batch.decisions));
  writeFileSync(join(dir, 'predictions.jsonl'), TrajectoryRecorder.toJsonl(result.batch.predictions));
  writeFileSync(join(dir, 'episodes.jsonl'), TrajectoryRecorder.toJsonl(result.batch.episodes));
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify(result.metrics, null, 2));
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(result.snapshot));
}

function cliArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

function main(): void {
  const seed = Number(cliArg('seed', '42'));
  const days = Number(cliArg('days', '1'));
  const runs = Number(cliArg('runs', '1'));
  const out = cliArg('out', './datasets');

  for (let i = 0; i < runs; i++) {
    const runSeed = seed + i;
    const runId = `run-${runSeed}-d${days}`;
    console.log(`[headless] ${runId}: simulating ${days} day(s)…`);
    const result = runHeadlessSim({
      seed: runSeed,
      days,
      onDay: (day) => console.log(`[headless] ${runId}: day ${day}/${days} done`),
    });
    writeHeadlessRun(out, runId, result);
    const totals = Object.values(result.metrics.perAgent);
    const surprises = totals.reduce((s, a) => s + a.surprises, 0);
    const planned = totals.reduce((s, a) => s + a.planStepsCompleted, 0);
    console.log(
      `[headless] ${runId}: decisions=${result.batch.decisions.length} ` +
        `predictions=${result.batch.predictions.length} episodes=${result.batch.episodes.length} ` +
        `planStepsCompleted=${planned} surprises=${surprises} -> ${join(out, runId)}`
    );
  }
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('headless.js') || entry.endsWith('headless.ts')) {
  main();
}
