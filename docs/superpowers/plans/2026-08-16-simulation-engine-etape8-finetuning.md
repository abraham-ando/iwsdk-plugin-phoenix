# Moteur de Simulation — Étape 8 : Pipeline de fine-tuning — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boucler la boucle d'entraînement (spec §9.1) : convertir les trajectoires capturées (`decisions.jsonl`, `predictions.jsonl`) en jeux SFT chat directement consommables par `mlx_lm.lora` (stack locale de l'utilisateur) ou HF/TRL — deux jeux distincts : **politique d'action** (le JSON strict que le BFF attend) et **world model prédictif** (état+action → résultat réel, la cible LeCun).

**Architecture:** Transformations **pures et testables** dans `packages/simulation/src/telemetry/datasetExport.ts` (zéro I/O, comme tout le moteur), plus une entrée Node séparée `src/dataset-cli.ts` (troisième build target, seule zone d'I/O avec `headless.ts`) qui scanne les dossiers de runs — aussi bien ceux du batch headless (`run-*/`) que ceux ingérés par le BFF (`trajectories/<runId>/`) — filtre, découpe train/valid de façon déterministe et écrit une arborescence prête à l'emploi.

**Tech Stack:** TypeScript strict, vitest, tsup (entrée `dataset-cli`, platform node), `node:fs`.

**Spec:** `docs/superpowers/specs/2026-08-15-simulation-engine-design.md` (sections 9.1, 9.3, 9.4)

## Global Constraints

- `datasetExport.ts` est **pur** : aucun `node:fs`, aucun `Date.now()`, aucun `Math.random()` — testable et déterministe (le découpage train/valid est un stride, pas un tirage).
- Par défaut, les enregistrements marqués `meta.source === 'player_text'` sont **exclus** des jeux exportés (spec §9.4) ; `--include-player` les réintègre explicitement.
- La cible assistant du jeu « politique » est **exactement** le JSON strict que `/agents/plan` parse (`{"steps":[…]}`, `{"lines":…}`, `{"insights":…}`, `{"reply":…}`) — sans les champs de routage (`requestId`, `reason`, `agentId`, `participantIds`).
- Format de sortie : une ligne JSON par exemple, clé `messages` (format « chat » de MLX-LM et de HF/TRL).
- Conventions inchangées : TDD, commits `feat(...)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Structure de fichiers cible

```
packages/simulation/src/
├── telemetry/datasetExport.ts   (nouveau) transformations pures SFT
├── dataset-cli.ts               (nouveau) entrée Node : scan runs → jeux SFT
└── index.ts                     (modifié) exports des transformations

packages/simulation/tsup.config.ts   (modifié) 3e entrée dataset-cli
packages/simulation/package.json     (modifié) export "./dataset"
packages/simulation/test/
└── dataset-export.test.ts       (nouveau)
```

Arborescence produite par le CLI :

```
<out>/
├── plans/          train.jsonl · valid.jsonl     → mlx_lm.lora --data <out>/plans
├── world-model/    train.jsonl · valid.jsonl     → mlx_lm.lora --data <out>/world-model
└── report.json     compteurs, taux de surprise, runs scannés
```

---

### Task 1 : Transformations pures (decisions/predictions → SFT)

**Files:**
- Create: `packages/simulation/src/telemetry/datasetExport.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/dataset-export.test.ts`

**Interfaces:**
- Consumes: rien (les enregistrements arrivent en `Record<string, unknown>` — même forme que ce qu'écrit `TrajectoryRecorder`).
- Produces:
  - `interface SftMessage { role: 'system' | 'user' | 'assistant'; content: string }`
  - `interface SftRecord { messages: SftMessage[] }`
  - `interface ExportOptions { includePlayerText?: boolean }`
  - `function toChatSft(decisions: Array<Record<string, unknown>>, options?: ExportOptions): SftRecord[]`
  - `function toWorldModelSft(predictions: Array<Record<string, unknown>>): SftRecord[]`
  - `function splitTrainValid<T>(records: T[], validRatio?: number): { train: T[]; valid: T[] }` (stride déterministe ; `validRatio` par défaut 0.1 ; ratio ≤ 0 ⇒ tout en train)
  - `interface DatasetSummary { decisions: number; decisionsByReason: Record<string, number>; playerTextExcluded: number; predictions: number; surprises: number; surpriseRate: number }`
  - `function datasetSummary(decisions: Array<Record<string, unknown>>, predictions: Array<Record<string, unknown>>, options?: ExportOptions): DatasetSummary`
  - `const WORLD_MODEL_SYSTEM_PROMPT: string`

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/dataset-export.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  toChatSft,
  toWorldModelSft,
  splitTrainValid,
  datasetSummary,
  WORLD_MODEL_SYSTEM_PROMPT,
} from '../src/telemetry/datasetExport';

function planDecision(): Record<string, unknown> {
  return {
    meta: { seed: 5, tick: 100, agentId: 'mira', reason: 'dawn', requestId: 'mira:100:dawn' },
    tools: [
      {
        type: 'function',
        function: { name: 'gather_berries', description: 'berry_bush', parameters: {} },
      },
    ],
    messages: [
      { role: 'system', content: 'Tu es Douce et prévoyante (Cueilleuse, tribu Aube).' },
      { role: 'user', content: '{"needs":{"hunger":20},"hour":6,"place":"camp_aube"}' },
      {
        role: 'assistant',
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'gather_berries',
              arguments: '{"objectId":"berry_bush_1","goal":"cueillir","predicted":"+2 baies"}',
            },
          },
        ],
      },
    ],
  };
}

function reflectionDecision(): Record<string, unknown> {
  return {
    meta: { seed: 5, tick: 2100, agentId: 'kan', reason: 'reflection', requestId: 'kan:2100:r' },
    tools: [],
    messages: [
      { role: 'system', content: 'Tu es Solitaire fier (Guerrier, tribu Rive).' },
      { role: 'user', content: '{"needs":{"hunger":60}}' },
      {
        role: 'assistant',
        // The recorder stores the whole payload, routing fields included.
        content: '{"requestId":"kan:2100:r","reason":"reflection","agentId":"kan","insights":["La rivière nord s\'épuise"]}',
      },
    ],
  };
}

function playerDecision(): Record<string, unknown> {
  return {
    meta: {
      seed: 5,
      tick: 300,
      agentId: 'mira',
      reason: 'player_dialogue',
      requestId: 'mira:300:p',
      source: 'player_text',
    },
    tools: [],
    messages: [
      { role: 'system', content: 'Tu es Douce et prévoyante (Cueilleuse, tribu Aube).' },
      { role: 'user', content: '{"playerText":"Bonjour !"}' },
      {
        role: 'assistant',
        content: '{"requestId":"mira:300:p","reason":"player_dialogue","agentId":"mira","reply":"Bienvenue, étranger."}',
      },
    ],
  };
}

function prediction(outcome: 'completed' | 'failed'): Record<string, unknown> {
  return {
    meta: { seed: 5, agentId: 'kan' },
    verb: 'gather_berries',
    objectId: 'berry_bush_8',
    predicted: 'réussite de gather_berries',
    startTick: 485,
    endTick: 603,
    outcome,
    needsDelta: { hunger: -3.24 },
    inventoryDelta: outcome === 'completed' ? { berries: 2 } : {},
    surprise: outcome === 'failed',
  };
}

describe('toChatSft', () => {
  it('turns tool_calls into the strict JSON the BFF parses', () => {
    const [record] = toChatSft([planDecision()]);
    expect(record?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(record?.messages[0]?.content).toContain('Douce et prévoyante');
    const target = JSON.parse(record!.messages[2]!.content) as {
      steps: Array<Record<string, unknown>>;
    };
    expect(target.steps).toEqual([
      {
        goal: 'cueillir',
        verb: 'gather_berries',
        objectId: 'berry_bush_1',
        predicted: '+2 baies',
      },
    ]);
  });

  it('strips routing fields from content-style answers', () => {
    const [record] = toChatSft([reflectionDecision()]);
    const target = JSON.parse(record!.messages[2]!.content) as Record<string, unknown>;
    expect(target).toEqual({ insights: ["La rivière nord s'épuise"] });
    expect(target).not.toHaveProperty('requestId');
  });

  it('excludes player-derived records by default and includes them on request', () => {
    const decisions = [planDecision(), playerDecision()];
    expect(toChatSft(decisions)).toHaveLength(1);
    expect(toChatSft(decisions, { includePlayerText: true })).toHaveLength(2);
  });

  it('drops malformed records instead of throwing', () => {
    expect(toChatSft([{}, { messages: 'nope' }, { messages: [] }])).toEqual([]);
  });
});

describe('toWorldModelSft', () => {
  it('maps state+action to the REAL outcome (LeCun target)', () => {
    const [record] = toWorldModelSft([prediction('completed')]);
    expect(record?.messages[0]?.content).toBe(WORLD_MODEL_SYSTEM_PROMPT);
    const input = JSON.parse(record!.messages[1]!.content) as Record<string, unknown>;
    expect(input).toEqual({
      verb: 'gather_berries',
      objectId: 'berry_bush_8',
      predicted: 'réussite de gather_berries',
    });
    const target = JSON.parse(record!.messages[2]!.content) as Record<string, unknown>;
    expect(target).toEqual({
      outcome: 'completed',
      needsDelta: { hunger: -3.24 },
      inventoryDelta: { berries: 2 },
    });
  });

  it('keeps failures — surprises are the most informative samples', () => {
    expect(toWorldModelSft([prediction('failed')])).toHaveLength(1);
  });

  it('drops malformed records instead of throwing', () => {
    expect(toWorldModelSft([{}, { verb: 42 }])).toEqual([]);
  });
});

describe('splitTrainValid', () => {
  it('is a deterministic stride split', () => {
    const records = Array.from({ length: 20 }, (_, i) => i);
    const { train, valid } = splitTrainValid(records, 0.1);
    expect(valid).toEqual([9, 19]);
    expect(train).toHaveLength(18);
    expect(splitTrainValid(records, 0.1)).toEqual({ train, valid });
  });

  it('puts everything in train when the ratio is zero', () => {
    expect(splitTrainValid([1, 2, 3], 0).valid).toEqual([]);
  });
});

describe('datasetSummary', () => {
  it('counts decisions by reason, exclusions and surprise rate', () => {
    const summary = datasetSummary(
      [planDecision(), reflectionDecision(), playerDecision()],
      [prediction('completed'), prediction('failed')]
    );
    expect(summary.decisions).toBe(2); // player_text excluded by default
    expect(summary.playerTextExcluded).toBe(1);
    expect(summary.decisionsByReason).toEqual({ dawn: 1, reflection: 1 });
    expect(summary.predictions).toBe(2);
    expect(summary.surprises).toBe(1);
    expect(summary.surpriseRate).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `cd packages/simulation && pnpm vitest run dataset-export`
Expected : FAIL — `Cannot find module '../src/telemetry/datasetExport'`.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/telemetry/datasetExport.ts` :

```ts
/**
 * Dataset export (spec §9.1): turns recorded trajectories into SFT chat
 * datasets. Two products, two purposes:
 *
 * - "plans": the ACTION POLICY — the assistant target is exactly the strict
 *   JSON /agents/plan parses, so a fine-tuned model drops straight into the
 *   running simulation.
 * - "world-model": the LeCun PREDICTOR — state + action -> the REAL outcome,
 *   failures included (a surprise is the most informative sample there is).
 *
 * Pure functions only: no I/O, no clock, no randomness (the train/valid split
 * is a stride). The CLI in ../dataset-cli.ts owns the disk.
 */
export interface SftMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SftRecord {
  messages: SftMessage[];
}

export interface ExportOptions {
  /** Include records derived from the player's own words (spec §9.4). */
  includePlayerText?: boolean;
}

export const WORLD_MODEL_SYSTEM_PROMPT =
  "Tu es le modèle du monde d'un agent incarné. À partir de l'action entreprise " +
  "et du résultat qu'il anticipait, prédis le résultat RÉEL. Réponds " +
  'UNIQUEMENT en JSON: {"outcome":"completed|failed","needsDelta":{},"inventoryDelta":{}}';

/** Routing envelope written by the recorder — never part of the LLM target. */
const ROUTING_FIELDS = new Set(['requestId', 'reason', 'agentId', 'participantIds']);

function isPlayerDerived(record: Record<string, unknown>): boolean {
  const meta = record.meta as Record<string, unknown> | undefined;
  return meta?.source === 'player_text';
}

function assistantTarget(message: Record<string, unknown>): string | null {
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls)) {
    const steps: Array<Record<string, unknown>> = [];
    for (const call of toolCalls) {
      const fn = (call as { function?: { name?: unknown; arguments?: unknown } }).function;
      if (typeof fn?.name !== 'string' || typeof fn.arguments !== 'string') continue;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(fn.arguments) as Record<string, unknown>;
      } catch {
        continue;
      }
      steps.push({
        goal: args.goal,
        verb: fn.name,
        ...(args.objectId !== undefined ? { objectId: args.objectId } : {}),
        predicted: args.predicted,
      });
    }
    return steps.length === 0 ? null : JSON.stringify({ steps });
  }

  if (typeof message.content !== 'string') return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(message.content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!ROUTING_FIELDS.has(key)) stripped[key] = value;
  }
  return Object.keys(stripped).length === 0 ? null : JSON.stringify(stripped);
}

export function toChatSft(
  decisions: Array<Record<string, unknown>>,
  options: ExportOptions = {}
): SftRecord[] {
  const out: SftRecord[] = [];
  for (const decision of decisions) {
    if (!options.includePlayerText && isPlayerDerived(decision)) continue;
    const messages = decision.messages;
    if (!Array.isArray(messages) || messages.length < 3) continue;
    const [system, user, assistant] = messages as Array<Record<string, unknown>>;
    if (typeof system?.content !== 'string' || typeof user?.content !== 'string') continue;
    if (assistant === undefined) continue;
    const target = assistantTarget(assistant);
    if (target === null) continue;
    out.push({
      messages: [
        { role: 'system', content: system.content },
        { role: 'user', content: user.content },
        { role: 'assistant', content: target },
      ],
    });
  }
  return out;
}

export function toWorldModelSft(predictions: Array<Record<string, unknown>>): SftRecord[] {
  const out: SftRecord[] = [];
  for (const prediction of predictions) {
    if (typeof prediction.verb !== 'string' || typeof prediction.outcome !== 'string') continue;
    const input: Record<string, unknown> = {
      verb: prediction.verb,
      ...(typeof prediction.objectId === 'string' ? { objectId: prediction.objectId } : {}),
      predicted: typeof prediction.predicted === 'string' ? prediction.predicted : '',
    };
    const target = {
      outcome: prediction.outcome,
      needsDelta: (prediction.needsDelta as Record<string, number>) ?? {},
      inventoryDelta: (prediction.inventoryDelta as Record<string, number>) ?? {},
    };
    out.push({
      messages: [
        { role: 'system', content: WORLD_MODEL_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(input) },
        { role: 'assistant', content: JSON.stringify(target) },
      ],
    });
  }
  return out;
}

export function splitTrainValid<T>(
  records: T[],
  validRatio = 0.1
): { train: T[]; valid: T[] } {
  if (validRatio <= 0) return { train: [...records], valid: [] };
  const stride = Math.max(2, Math.round(1 / validRatio));
  const train: T[] = [];
  const valid: T[] = [];
  records.forEach((record, index) => {
    if ((index + 1) % stride === 0) valid.push(record);
    else train.push(record);
  });
  return { train, valid };
}

export interface DatasetSummary {
  decisions: number;
  decisionsByReason: Record<string, number>;
  playerTextExcluded: number;
  predictions: number;
  surprises: number;
  surpriseRate: number;
}

export function datasetSummary(
  decisions: Array<Record<string, unknown>>,
  predictions: Array<Record<string, unknown>>,
  options: ExportOptions = {}
): DatasetSummary {
  const byReason: Record<string, number> = {};
  let kept = 0;
  let excluded = 0;
  for (const decision of decisions) {
    if (!options.includePlayerText && isPlayerDerived(decision)) {
      excluded++;
      continue;
    }
    kept++;
    const meta = decision.meta as Record<string, unknown> | undefined;
    const reason = typeof meta?.reason === 'string' ? meta.reason : 'unknown';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  const surprises = predictions.filter((p) => p.surprise === true).length;
  return {
    decisions: kept,
    decisionsByReason: byReason,
    playerTextExcluded: excluded,
    predictions: predictions.length,
    surprises,
    surpriseRate: predictions.length === 0 ? 0 : surprises / predictions.length,
  };
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export {
  toChatSft,
  toWorldModelSft,
  splitTrainValid,
  datasetSummary,
  WORLD_MODEL_SYSTEM_PROMPT,
  type SftRecord,
  type SftMessage,
  type ExportOptions,
  type DatasetSummary,
} from './telemetry/datasetExport';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm vitest run dataset-export` (11 passed) puis `pnpm vitest run` (toute la suite) et `pnpm typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/telemetry/datasetExport.ts packages/simulation/src/index.ts packages/simulation/test/dataset-export.test.ts
git commit -m "feat(simulation): pure sft dataset export (action policy + lecun world model)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : CLI `dataset-cli.ts` — scan des runs et écriture des jeux

**Files:**
- Create: `packages/simulation/src/dataset-cli.ts`
- Modify: `packages/simulation/tsup.config.ts`
- Modify: `packages/simulation/package.json`
- Verify: build + smoke réel de bout en bout (Task 3)

**Interfaces:**
- Consumes: `toChatSft`, `toWorldModelSft`, `splitTrainValid`, `datasetSummary`, `SftRecord` (Task 1).
- Produces:
  - `interface RunFiles { runId: string; decisions: Array<Record<string, unknown>>; predictions: Array<Record<string, unknown>> }`
  - `function readJsonl(path: string): Array<Record<string, unknown>>` (fichier absent ⇒ `[]`, ligne illisible ignorée)
  - `function scanRuns(root: string): RunFiles[]` — parcourt `root/*/` ET `root/trajectories/*/` (ingestion BFF), trié par `runId`
  - `function writeSftDir(dir: string, train: SftRecord[], valid: SftRecord[]): void`
  - `function exportDatasets(options: { in: string; out: string; validRatio: number; includePlayerText: boolean }): { report: Record<string, unknown> }`
  - CLI : `node dist/dataset-cli.js --in ./datasets --out ./datasets/sft [--valid-ratio 0.1] [--include-player]`

- [ ] **Step 1 : Implémenter le CLI**

`packages/simulation/src/dataset-cli.ts` :

```ts
/**
 * Dataset CLI (spec §9.1): scans recorded runs — headless batches (`run-*/`)
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
```

- [ ] **Step 2 : Ajouter l'entrée de build**

Dans `packages/simulation/tsup.config.ts`, ajouter un troisième objet au tableau (après l'entrée `headless`) :

```ts
  {
    entry: { 'dataset-cli': 'src/dataset-cli.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'node',
  },
```

Dans `packages/simulation/package.json`, ajouter après l'export `./headless` :

```json
    "./dataset": {
      "types": "./dist/dataset-cli.d.ts",
      "import": "./dist/dataset-cli.js"
    },
```

- [ ] **Step 3 : Vérifier**

Run : `pnpm --filter @iwsdk/cardinal-simulation typecheck && pnpm --filter @iwsdk/cardinal-simulation build`
Expected : 0 erreur ; `dist/dataset-cli.js` présent.

- [ ] **Step 4 : Commit**

```bash
git add packages/simulation/src/dataset-cli.ts packages/simulation/tsup.config.ts packages/simulation/package.json
git commit -m "feat(simulation): dataset cli exporting mlx-ready sft datasets from recorded runs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : Smoke de bout en bout + vérification finale

**Files:** aucun fichier de production modifié (sauf correctifs éventuels révélés par le smoke).

- [ ] **Step 1 : Générer des runs headless réels**

Run (depuis la racine du dépôt ; `$SCRATCH` = répertoire scratchpad de la session) :

```bash
node packages/simulation/dist/headless.js --seed 42 --days 1 --runs 2 --out "$SCRATCH/ds"
```

Expected : deux dossiers `run-42-d1/` et `run-43-d1/`, chacun avec `decisions.jsonl`, `predictions.jsonl`, `episodes.jsonl`, `metrics.json`, `snapshot.json`.

- [ ] **Step 2 : Exporter les jeux SFT**

Run :

```bash
node packages/simulation/dist/dataset-cli.js --in "$SCRATCH/ds" --out "$SCRATCH/ds/sft"
```

Expected : la sortie annonce 2 runs scannés, des compteurs non nuls pour la politique ET le world-model, et la commande `mlx_lm.lora`.

- [ ] **Step 3 : Inspecter la forme des exemples**

Run :

```bash
head -c 400 "$SCRATCH/ds/sft/plans/train.jsonl"; echo; head -c 400 "$SCRATCH/ds/sft/world-model/train.jsonl"; echo; cat "$SCRATCH/ds/sft/report.json"
```

Expected : chaque ligne est un objet `{"messages":[{"role":"system",…},{"role":"user",…},{"role":"assistant","content":"{\"steps\":[…]}"}]}` ; le world-model expose `{"outcome":…,"needsDelta":…,"inventoryDelta":…}` ; `report.json` liste les deux runs et le taux de surprise. Si un flux est vide alors que le run correspondant ne l'est pas, déboguer `scanRuns`/`toChatSft` AVANT de continuer.

- [ ] **Step 4 : Vérification complète du dépôt**

Run : `pnpm typecheck && pnpm test && pnpm build && pnpm demo:build`
Expected : tout vert (aucun changement démo/BFF attendu dans cette étape).

- [ ] **Step 5 : Commit final (si retouches) et nettoyage**

```bash
rm -rf "$SCRATCH/ds"
git add -A packages/simulation
git commit -m "test(simulation): end-to-end dataset export smoke fixes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Si le smoke n'a révélé aucun correctif, sauter le commit.)

---

## Couverture spec (auto-contrôle)

| Exigence spec | Tâche(s) |
| :--- | :--- |
| `decisions.jsonl` « directement consommable par un pipeline de fine-tuning » (§9.1) | 1 (`toChatSft`), 2 (écriture MLX-ready) |
| `predictions.jsonl` = cible d'entraînement du world model prédictif (§5, §9.1) | 1 (`toWorldModelSft`) |
| Exclusion possible des données issues du joueur (§9.4) | 1 (défaut exclu), 2 (`--include-player`) |
| Agrégation des runs VR (BFF) et headless (§9.2, §8.5) | 2 (`scanRuns` couvre `trajectories/`) |
| Statistiques de run exploitables (§9.3) | 1 (`datasetSummary`), 2 (`report.json`) |

Hors périmètre : l'entraînement lui-même (la spec §12 le pose explicitement comme pipeline séparé — le CLI imprime la commande `mlx_lm.lora` prête à coller), et l'évaluation post-fine-tuning du modèle dans la simulation (comparaison A/B possible dès aujourd'hui : deux runs même graine, `LLM_MODEL` différent).
