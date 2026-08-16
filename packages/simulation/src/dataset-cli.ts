/**
 * Dataset CLI (spec §9.1): scans recorded runs — headless batches (`run-*​/`)
 * and BFF-ingested VR sessions (`trajectories/<runId>/`) — and writes SFT
 * datasets ready for `mlx_lm.lora` or HF/TRL. Second (with headless.ts) and
 * last file in the package allowed to touch the disk.
 *
 * node dist/dataset-cli.js --in ./datasets --out ./datasets/sft
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  toChatSft,
  toWorldModelSft,
  splitTrainValid,
  datasetSummary,
  type SftRecord,
} from './telemetry/datasetExport';

export interface RunFiles {
  runId: string;
  decisions: Array<Record<string, unknown>>;
  predictions: Array<Record<string, unknown>>;
}

export function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // A truncated last line (crash mid-append) must not sink the export.
    }
  }
  return out;
}

function readRunDir(dir: string, runId: string): RunFiles | null {
  const decisions = readJsonl(join(dir, 'decisions.jsonl'));
  const predictions = readJsonl(join(dir, 'predictions.jsonl'));
  if (decisions.length === 0 && predictions.length === 0) return null;
  return { runId, decisions, predictions };
}

export function scanRuns(root: string): RunFiles[] {
  const runs: RunFiles[] = [];
  if (!existsSync(root)) return runs;
  const roots: Array<[string, string]> = [[root, '']];
  const trajectories = join(root, 'trajectories');
  if (existsSync(trajectories)) roots.push([trajectories, 'bff/']);

  for (const [base, prefix] of roots) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'trajectories') continue;
      const run = readRunDir(join(base, entry.name), `${prefix}${entry.name}`);
      if (run !== null) runs.push(run);
    }
  }
  return runs.sort((a, b) => a.runId.localeCompare(b.runId));
}

export function writeSftDir(dir: string, train: SftRecord[], valid: SftRecord[]): void {
  mkdirSync(dir, { recursive: true });
  const toJsonl = (records: SftRecord[]): string =>
    records.length === 0 ? '' : records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(join(dir, 'train.jsonl'), toJsonl(train));
  writeFileSync(join(dir, 'valid.jsonl'), toJsonl(valid));
}

export function exportDatasets(options: {
  in: string;
  out: string;
  validRatio: number;
  includePlayerText: boolean;
}): { report: Record<string, unknown> } {
  const runs = scanRuns(options.in);
  const decisions = runs.flatMap((r) => r.decisions);
  const predictions = runs.flatMap((r) => r.predictions);
  const exportOptions = { includePlayerText: options.includePlayerText };

  const plans = splitTrainValid(toChatSft(decisions, exportOptions), options.validRatio);
  const worldModel = splitTrainValid(toWorldModelSft(predictions), options.validRatio);
  writeSftDir(join(options.out, 'plans'), plans.train, plans.valid);
  writeSftDir(join(options.out, 'world-model'), worldModel.train, worldModel.valid);

  const report = {
    runs: runs.map((r) => ({
      runId: r.runId,
      decisions: r.decisions.length,
      predictions: r.predictions.length,
    })),
    summary: datasetSummary(decisions, predictions, exportOptions),
    plans: { train: plans.train.length, valid: plans.valid.length },
    worldModel: { train: worldModel.train.length, valid: worldModel.valid.length },
  };
  mkdirSync(options.out, { recursive: true });
  writeFileSync(join(options.out, 'report.json'), JSON.stringify(report, null, 2));
  return { report };
}

function cliArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

function main(): void {
  const input = cliArg('in', './datasets');
  const out = cliArg('out', './datasets/sft');
  const validRatio = Number(cliArg('valid-ratio', '0.1'));
  const includePlayerText = process.argv.includes('--include-player');

  const { report } = exportDatasets({ in: input, out, validRatio, includePlayerText });
  const summary = report.summary as { decisions: number; predictions: number; surpriseRate: number };
  const plans = report.plans as { train: number; valid: number };
  const worldModel = report.worldModel as { train: number; valid: number };

  console.log(`[dataset] runs scannés: ${(report.runs as unknown[]).length}`);
  console.log(
    `[dataset] politique: ${plans.train} train / ${plans.valid} valid ` +
      `(sur ${summary.decisions} décisions)`
  );
  console.log(
    `[dataset] world-model: ${worldModel.train} train / ${worldModel.valid} valid ` +
      `(sur ${summary.predictions} prédictions, ${(summary.surpriseRate * 100).toFixed(1)}% de surprises)`
  );
  console.log(`[dataset] écrit dans ${out}`);
  console.log(
    `[dataset] entraîner: mlx_lm.lora --model mlx-community/Llama-3.2-1B-Instruct-4bit ` +
      `--train --data ${join(out, 'plans')} --iters 600`
  );
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('dataset-cli.js') || entry.endsWith('dataset-cli.ts')) {
  main();
}
