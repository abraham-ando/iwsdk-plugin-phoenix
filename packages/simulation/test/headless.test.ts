import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHeadlessSim, writeHeadlessRun } from '../src/headless';

describe('headless batch', () => {
  it('runs a full simulated day and yields trajectories + metrics', () => {
    const days: number[] = [];
    const result = runHeadlessSim({ seed: 42, days: 1, onDay: (d) => days.push(d) });
    expect(days).toEqual([1]);
    expect(result.batch.decisions.length).toBeGreaterThan(0);
    expect(result.batch.predictions.length).toBeGreaterThan(0);
    expect(result.metrics.ticks).toBe(2400);
    expect(result.snapshot.agents).toHaveLength(11);
  });

  it('is deterministic at fixed seed', () => {
    const a = runHeadlessSim({ seed: 7, days: 1 });
    const b = runHeadlessSim({ seed: 7, days: 1 });
    expect(JSON.stringify(a.batch)).toBe(JSON.stringify(b.batch));
    expect(a.metrics).toEqual(b.metrics);
  });

  it('writeHeadlessRun lays out the dataset directory', () => {
    const out = mkdtempSync(join(tmpdir(), 'cardinal-headless-'));
    try {
      const result = runHeadlessSim({ seed: 1, days: 1 });
      writeHeadlessRun(out, 'run-test', result);
      for (const f of ['decisions.jsonl', 'predictions.jsonl', 'episodes.jsonl', 'metrics.json', 'snapshot.json']) {
        expect(existsSync(join(out, 'run-test', f))).toBe(true);
      }
      const metrics = JSON.parse(readFileSync(join(out, 'run-test', 'metrics.json'), 'utf8'));
      expect(metrics.ticks).toBe(2400);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
