# Moteur de Simulation — Étape 5 : Télémétrie & Headless Batch — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'usine à datasets (spec §9, §13.5) : les trois flux JSONL (`decisions` au format tool-calling, `predictions` au quadruplet LeCun prédit/réel, `episodes` narratif), les métriques d'évaluation continues (divergence des croyances, surprise, bien-être, efficacité des plans), le mode headless Node (`runHeadlessSim`) qui déroule des jours simulés en batch sans limite temps réel avec un planificateur mock déterministe, les endpoints BFF `/trajectories/batch` et `/trajectories/stats`, et l'upload périodique depuis la démo VR.

**Architecture:** Le moteur reste sans I/O : `TrajectoryRecorder` et `MetricsCollector` **observent** (nouvelles souscriptions non-destructives sur le runtime : les `drain*` existants restent la voie de consommation du transport/HUD) et accumulent en mémoire ; l'écriture disque vit dans `headless.ts` (entrée Node séparée, buildée à part) et dans le BFF. Le scénario du village remonte dans le moteur (`content/scenario.ts`) — la démo l'importe : une seule source pour le monde, VR et headless identiques (spec §3 principe 2).

**Tech Stack:** moteur : TypeScript pur + vitest (env node — `node:fs` autorisé dans les tests et `headless.ts` uniquement). BFF : `node:http`/`node:fs` existants. Démo : `setInterval` + fetch.

**Spec:** `docs/superpowers/specs/2026-08-15-simulation-engine-design.md` (sections 9.1–9.4, 8.5, 13.5)

## Global Constraints

- `packages/simulation/src/**` hors `headless.ts` : toujours zéro I/O, zéro `Date.now()`/`Math.random()`. `headless.ts` est la seule exception (entrée Node, jamais importée par `index.ts`).
- Les enregistreurs n'altèrent JAMAIS la simulation : mêmes graines ⇒ mêmes trajectoires, avec ou sans recorder (testé).
- Les flux JSONL sont sérialisables et déterministes à graine fixée (le seul horodatage réel est ajouté par le BFF/CLI, hors moteur).
- `runId` accepté par le BFF : `^[A-Za-z0-9_-]{1,64}$` (protection chemin).
- Conventions inchangées (TDD, commits `feat(...)` + trailer, typecheck démo).

---

## Structure de fichiers cible

```
packages/simulation/src/
├── content/scenario.ts            (nouveau) DEFAULT_VILLAGE + buildVillageSim(seed)
├── telemetry/
│   ├── MetricsCollector.ts        (nouveau) divergence, bien-être, compteurs plan/réflexe
│   ├── TrajectoryRecorder.ts      (nouveau) decisions/predictions/episodes
│   └── MockPlanner.ts             (nouveau) réponses mock déterministes (miroir du BFF)
├── agents/AgentRuntime.ts         (modifié) subscribeEvents/subscribePlanRequests,
│                                  ActionEvent.source/predicted/objectId sur les started
├── agents/actions.ts              (modifié) ActionEvent étendu (champs optionnels)
├── headless.ts                    (nouveau) runHeadlessSim + écriture disque + CLI
└── index.ts                       (modifié) exports (PAS headless)

packages/simulation/package.json   (modifié) export "./headless"
packages/simulation/tsup.config.ts (modifié) entrée headless (platform node)
packages/simulation/test/
├── scenario.test.ts  runtime-observers.test.ts  metrics.test.ts
├── trajectory-recorder.test.ts  headless.test.ts

apps/bff-server/src/server.ts      (modifié) /trajectories/batch + /trajectories/stats
apps/bff-server/test/bff-server.test.ts (étendu)

apps/demo/src/simulation/
├── layout.ts                      (modifié) importe DEFAULT_VILLAGE du moteur
├── TrajectoryUploader.ts          (nouveau) drain → POST périodique
├── CardinalSimulationSystem.ts    (modifié) recorder attaché + corrections SonarQube
└── index.ts (demo)                (modifié) uploader démarré
```

---

### Task 1 : Scénario village dans le moteur + refactor layout démo

**Files:**
- Create: `packages/simulation/src/content/scenario.ts`
- Modify: `packages/simulation/src/index.ts`
- Modify: `apps/demo/src/simulation/layout.ts`
- Test: `packages/simulation/test/scenario.test.ts`

**Interfaces:**
- Produces (scenario.ts) :
  - `interface ScenarioObject { type: string; x: number; z: number }`
  - `interface ScenarioAgent { id: string; name: string; persona: string; tribe: string; role: string; gender: 'masculine' | 'feminine'; x: number; z: number }`
  - `interface ScenarioPlace { name: string; x: number; z: number; radius: number }`
  - `const DEFAULT_VILLAGE: { objects: ScenarioObject[]; agents: ScenarioAgent[]; places: ScenarioPlace[] }` — **transfert à l'identique** des données de `apps/demo/src/simulation/layout.ts` (les 21 objets — 5 par campement ×3 + 4 chênes + 2 berges — les 11 agents avec personas, les 4 lieux). Les positions de campement (Aube 0/−4.5, Rive 5.5/−3, Pic −5.5/−3) et les offsets d'objets sont recopiés tels quels.
  - `interface VillageSim { kernel: SimKernel; world: GroundTruthWorld; runtime: AgentRuntime; weather: WeatherMachine; registry: SmartObjectRegistry }`
  - `function buildVillageSim(seed: number): VillageSim` — registre + contenu par défaut, kernel seedé, monde attaché, météo attachée, runtime attaché, lieux/objets/agents spawnés depuis `DEFAULT_VILLAGE`, feux allumés (`lit = 1`) comme la démo.
- Modify (layout démo) : `layout.ts` importe `DEFAULT_VILLAGE` et `type ScenarioAgent` du moteur ; supprime ses propres constantes `AGENTS`/objets/places ; `export type LayoutAgent = ScenarioAgent;` ; `VILLAGE_LAYOUT = { settlements: SETTLEMENTS, objects: DEFAULT_VILLAGE.objects, agents: DEFAULT_VILLAGE.agents, places: DEFAULT_VILLAGE.places }` (seuls les `SETTLEMENTS` — couleurs visuelles — restent côté démo ; le type du champ `tribe` passe à `string`, ce qui reste compatible avec `colorByTribe.get(...) ?? défaut` et `addAgent`).

- [ ] **Step 1 : Test qui échoue** — `packages/simulation/test/scenario.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_VILLAGE, buildVillageSim } from '../src/content/scenario';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';
import { snapshotSim } from '../src/kernel/snapshot';

describe('default village scenario', () => {
  it('declares 11 agents with personas, 21 objects and 4 places', () => {
    expect(DEFAULT_VILLAGE.agents).toHaveLength(11);
    expect(DEFAULT_VILLAGE.agents.every((a) => a.persona.length > 0)).toBe(true);
    expect(DEFAULT_VILLAGE.objects).toHaveLength(21);
    expect(DEFAULT_VILLAGE.objects.filter((o) => o.type === 'campfire')).toHaveLength(3);
    expect(DEFAULT_VILLAGE.places.map((p) => p.name)).toContain('camp_aube');
  });

  it('buildVillageSim wires a living deterministic village', () => {
    const a = buildVillageSim(42);
    const b = buildVillageSim(42);
    expect(a.runtime.agents.size).toBe(11);
    // Fires start lit, like the demo.
    const fires = a.world.objectsNear(0, 0, 1000).filter((o) => o.type === 'campfire');
    expect(fires.every((f) => f.state.lit === 1)).toBe(true);
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      a.kernel.step();
      b.kernel.step();
    }
    expect(snapshotSim(a.kernel, a.world, a.runtime, a.weather)).toEqual(
      snapshotSim(b.kernel, b.world, b.runtime, b.weather)
    );
  });
});
```

- [ ] **Step 2 : Échec vérifié.** **Step 3 : Implémenter** (transfert des données, assemblage identique à `CardinalSimulationSystem.init`). Exporter depuis `index.ts` : `DEFAULT_VILLAGE, buildVillageSim` + types. **Step 4 :** suite moteur verte, build moteur, puis refactor layout démo + `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck`. **Step 5 : Commit** `feat(simulation): default village scenario shared by vr demo and headless`.

---

### Task 2 : Observabilité du runtime — souscriptions + provenance des actions

**Files:**
- Modify: `packages/simulation/src/agents/actions.ts` (champs optionnels d'ActionEvent)
- Modify: `packages/simulation/src/agents/AgentRuntime.ts`
- Test: `packages/simulation/test/runtime-observers.test.ts`

**Interfaces:**
- `ActionEvent` gagne les champs optionnels `source?: 'plan' | 'reflex'; predicted?: string; objectId?: string` (l'exécuteur ne les remplit pas ; le runtime les pose sur ses événements `started` : `source: 'plan'` + `predicted` + `objectId` pour un pas de plan, `source: 'reflex'` pour Mode-1).
- `AgentRuntime` : `subscribeEvents(cb: (e: ActionEvent) => void): () => void` et `subscribePlanRequests(cb: (r: PlanRequest) => void): () => void` — notifiés à CHAQUE émission, sans consommer (`drainEvents`/`drainPlanRequests` inchangés). Implémentation : méthodes privées `pushEvent(e)` / `pushPlanRequest(r)` remplaçant les `push` directs.

- [ ] **Step 1 : Tests** — `runtime-observers.test.ts` :

```ts
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
    const bushId = mira.beliefs.byType('berry_bush')[0]?.objectId;
    if (bushId !== undefined) {
      sim.kernel.submitEvent('llm_plan', {
        requestId: 'x',
        agentId: 'mira',
        steps: [{ goal: 'g', verb: 'gather_berries', objectId: bushId, predicted: '+2 baies' }],
      });
    }
    for (let t = 0; t < 300; t++) sim.kernel.step();
    expect(started.some((e) => e.source === 'reflex')).toBe(true);
    const planStart = started.find((e) => e.source === 'plan');
    expect(planStart?.predicted).toBe('+2 baies');
    expect(planStart?.objectId).toBe(bushId);
  });
});
```

- [ ] **Steps 2–4 : échec → implémentation → toute la suite verte.** **Step 5 : Commit** `feat(simulation): non-destructive runtime observers and action provenance`.

---

### Task 3 : MetricsCollector

**Files:**
- Create: `packages/simulation/src/telemetry/MetricsCollector.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/metrics.test.ts`

**Interfaces:**
- `const METRICS_SAMPLE_PERIOD = 50`
- `interface AgentMetrics { wellbeingCostIntegral: number; beliefDivergenceSum: number; beliefDivergenceSamples: number; planStepsCompleted: number; planStepsFailed: number; reflexActionsStarted: number; surprises: number }`
- `interface RunMetrics { ticks: number; samples: number; perAgent: Record<string, AgentMetrics & { avgBeliefDivergence: number }> }`
- `class MetricsCollector { constructor(world: GroundTruthWorld, runtime: AgentRuntime); attachTo(kernel: SimKernel): () => void; metrics(): RunMetrics }` — par échantillon (tous les 50 ticks) : `wellbeingCostIntegral += wellbeingCost(needs) × 50` et divergence (`beliefs.divergenceFrom(world)`) sommée ; via `subscribeEvents` : `started`+`reflex` → `reflexActionsStarted++` ; `completed` dont le `started` apparié était `plan` → `planStepsCompleted++` (apparier par agent : mémoriser la provenance du dernier `started` par agent) ; `failed` → `surprises++` et `planStepsFailed++` si provenance plan. Spec §9.3 (a)–(d).

- [ ] **Step 1 : Tests** — `metrics.test.ts` :

```ts
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
```

- [ ] **Steps 2–4 : échec → implémentation → suite verte.** Export index : `MetricsCollector, METRICS_SAMPLE_PERIOD, type RunMetrics, type AgentMetrics`. **Step 5 : Commit** `feat(simulation): run metrics collector (wellbeing, divergence, plan efficiency)`.

---

### Task 4 : TrajectoryRecorder — les trois flux

**Files:**
- Create: `packages/simulation/src/telemetry/TrajectoryRecorder.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/trajectory-recorder.test.ts`

**Interfaces:**
- `const EPISODE_SNAPSHOT_PERIOD = 50`
- `interface TrajectoryBatch { decisions: Array<Record<string, unknown>>; predictions: Array<Record<string, unknown>>; episodes: Array<Record<string, unknown>> }`
- `class TrajectoryRecorder { constructor(runtime: AgentRuntime, seed: number, weather?: WeatherMachine); attachTo(kernel: SimKernel): () => void; drain(): TrajectoryBatch; static toJsonl(records: Array<Record<string, unknown>>): string }`
- **decisions** (spec §9.1) : apparier requête (via `subscribePlanRequests`, map `requestId → PlanRequest`) et réponse (événements `llm_*` observés dans `kernel.onTick`) ; enregistrement au format messages tool-calling :
  - `meta: { seed, tick, agentId, reason, requestId }`
  - `tools`: `request.tools.map(t => ({ type: 'function', function: { name: t.verb, description: t.type ?? 'intrinsic', parameters: { type: 'object', properties: { objectId: { type: 'string' } } } } }))`
  - `messages`: `[ { role: 'system', content: \`Tu es ${persona} (${role}, tribu ${tribe}).\` }, { role: 'user', content: JSON.stringify({ needs, hour, place, beliefs, memories, currentPlan }) }, { role: 'assistant', ... } ]` — l'assistant : pour `llm_plan` → `tool_calls: steps.map(s => ({ type: 'function', function: { name: s.verb, arguments: JSON.stringify({ objectId: s.objectId, goal: s.goal, predicted: s.predicted }) } }))` ; pour dialogue/réflexion → `content: JSON.stringify({ lines?/insights? })`.
- **predictions** (quadruplet LeCun, spec §5, §9.1) : sur `started` avec `source === 'plan'` → ouvrir un enregistrement par agent (`startTick, verb, objectId, predicted, needsBefore: {...}, inventoryBefore: {...}` copiés depuis l'état de l'agent) ; sur le `completed`/`failed` suivant du même agent et même verbe → émettre `{ meta: { seed, agentId }, verb, objectId, predicted, startTick, endTick, outcome: 'completed' | 'failed', reason?, needsDelta, inventoryDelta, surprise: outcome === 'failed' }` (deltas = état après − avant, seuls champs non nuls).
- **episodes** (spec §9.1) : tous les 50 ticks, `{ tick, hour, weather?, kind: 'snapshot', agents: [{ id, x (arrondi 0.01), z, needs (arrondis à l'entier), verb }] }` ; plus chaque `ActionEvent` → `{ tick, kind: 'event', agentId, type, verb, reason? }` ; plus chaque `llm_dialogue` → `{ tick, kind: 'dialogue', lines }`.
- `toJsonl` : `records.map(r => JSON.stringify(r)).join('\n') + '\n'` (vide → `''`).

- [ ] **Step 1 : Tests** — `trajectory-recorder.test.ts` :

```ts
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
        request.reason === 'dialogue' ? 'llm_dialogue' : request.reason === 'reflection' ? 'llm_reflection' : 'llm_plan',
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
```

Ce test importe `MockPlanner` — créer dans CETTE tâche `packages/simulation/src/telemetry/MockPlanner.ts` (miroir déterministe du mock BFF) :

```ts
import type { PlanRequest } from '../agents/Mode2';

const MOCK_PLAN_VERB_PREFERENCE = ['gather_berries', 'gather_wood', 'gather_flint', 'light_fire'];

/** Deterministic offline planner mirroring the BFF mock — lets headless runs
 * produce full trajectories with zero network. */
export function mockPlanResponse(request: PlanRequest): Record<string, unknown> {
  const base = {
    requestId: request.requestId,
    reason: request.reason,
    agentId: request.agentId,
    ...(request.participantIds ? { participantIds: request.participantIds } : {}),
  };
  if (request.reason === 'dialogue') {
    const [a, b] = request.participantIds ?? [request.agentId, 'inconnu'];
    const firstBelief = request.beliefs[0];
    const topic = firstBelief ? firstBelief.type.replace('_', ' ') : 'la journée';
    return {
      ...base,
      lines: [
        { speaker: a, text: `As-tu vu ? Près d'ici, ${topic} nous attend.` },
        { speaker: b, text: 'Bien vu — la tribu en profitera.' },
      ],
      sharedFacts: firstBelief
        ? [{ objectId: firstBelief.objectId, type: firstBelief.type, x: 0, z: 0, state: firstBelief.state }]
        : [],
    };
  }
  if (request.reason === 'reflection') {
    return { ...base, insights: ['Jour vécu: besoins gérés, tribu soudée.'] };
  }
  const withObject = request.tools
    .filter((t) => t.objectId !== undefined)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  const steps: Array<{ goal: string; verb: string; objectId?: string; predicted: string }> = [];
  for (const preferred of MOCK_PLAN_VERB_PREFERENCE) {
    if (steps.length >= 3) break;
    const tool = withObject.find((t) => t.verb === preferred);
    if (tool) {
      steps.push({
        goal: `faire ${tool.verb}`,
        verb: tool.verb,
        objectId: tool.objectId,
        predicted: `réussite de ${tool.verb}`,
      });
    }
  }
  if (request.tools.some((t) => t.verb === 'eat_berries')) {
    steps.push({ goal: 'me nourrir', verb: 'eat_berries', predicted: 'faim restaurée' });
  }
  return { ...base, steps };
}
```

- [ ] **Steps 2–4 : échec → implémentation (Recorder + MockPlanner) → suite verte.** Exports index : `TrajectoryRecorder, EPISODE_SNAPSHOT_PERIOD, type TrajectoryBatch, mockPlanResponse`. **Step 5 : Commit** `feat(simulation): trajectory recorder (tool-calling decisions, lecun predictions, episodes)`.

---

### Task 5 : headless.ts — batch Node + CLI

**Files:**
- Create: `packages/simulation/src/headless.ts`
- Modify: `packages/simulation/tsup.config.ts` (entrée `headless`, platform node)
- Modify: `packages/simulation/package.json` (export `./headless`)
- Test: `packages/simulation/test/headless.test.ts`

**Interfaces:**
- `interface HeadlessOptions { seed: number; days: number; planner?: 'mock' | 'none'; onDay?: (day: number) => void }`
- `interface HeadlessResult { seed: number; days: number; metrics: RunMetrics; batch: TrajectoryBatch; snapshot: SimSnapshot }`
- `function runHeadlessSim(options: HeadlessOptions): HeadlessResult` — `buildVillageSim(seed)` + recorder + metrics ; boucle `days × TICKS_PER_DAY` de `kernel.step()` ; si `planner === 'mock'` (défaut), après chaque tick les requêtes drainées reçoivent `mockPlanResponse` via `submitEvent` ; `onDay` appelé à chaque frontière de jour.
- `function writeHeadlessRun(outDir: string, runId: string, result: HeadlessResult): void` — crée `outDir/runId/`, écrit `decisions.jsonl`, `predictions.jsonl`, `episodes.jsonl` (via `TrajectoryRecorder.toJsonl`), `metrics.json`, `snapshot.json` (Node `fs` synchrone — seule zone d'I/O du paquet).
- CLI (fin de fichier, exécuté si lancé directement) : `node dist/headless.js --seed 42 --days 2 --runs 1 --out ./datasets` — pour `runs > 1`, graines `seed, seed+1, …`, `runId = run-<seed>-d<days>` ; affiche par run une ligne de progression par jour et le résumé métriques. Garde d'exécution directe : `process.argv[1]` se termine par `headless.js`/`headless.ts`.

- [ ] **Step 1 : Tests** — `headless.test.ts` :

```ts
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
```

- [ ] **Steps 2–4 : échec → implémentation → suite verte + build** (vérifier que `dist/headless.js` existe et que `node dist/headless.js --seed 5 --days 1 --out <tmp>` produit le dossier — smoke CLI manuel dans le Step 4). tsup : deuxième objet de config `{ entry: { headless: 'src/headless.ts' }, format: ['esm'], platform: 'node', dts: true, clean: false, target: 'es2022', sourcemap: true }` ; package.json exports : `"./headless": { "types": "./dist/headless.d.ts", "import": "./dist/headless.js" }`. **Step 5 : Commit** `feat(simulation): headless batch runner with mock planner, dataset writer and cli`.

---

### Task 6 : BFF /trajectories

**Files:**
- Modify: `apps/bff-server/src/server.ts`
- Test: `apps/bff-server/test/bff-server.test.ts` (nouveau describe, réutilise le serveur port 3098)

**Interfaces:**
- `POST /trajectories/batch` (JWT + rate-limit) : corps `{ runId: string, decisions?: unknown[], predictions?: unknown[], episodes?: unknown[] }` ; `runId` validé `^[A-Za-z0-9_-]{1,64}$` (sinon 400) ; chaque flux non vide est appendu ligne par ligne à `datasetDir/trajectories/<runId>/<stream>.jsonl` ; réponse `{ ok: true, appended: { decisions: n, predictions: n, episodes: n } }` ; `datasetDir === null` → `{ ok: true, appended: … }` sans écriture.
- `GET /trajectories/stats` (JWT) : `{ runs: [{ runId, decisions, predictions, episodes }] }` — lignes comptées par lecture des fichiers ; dossier absent → `{ runs: [] }`.

- [ ] **Step 1 : Tests** (dans le describe `/agents/plan` existant ou un nouveau partageant serveur/dossier tmp) :

```ts
  it('trajectories/batch appends jsonl per run and stats counts them', async () => {
    const token = await getToken();
    const post = await fetch(`${baseUrl}/trajectories/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        runId: 'vr-test-1',
        decisions: [{ a: 1 }],
        episodes: [{ tick: 1 }, { tick: 2 }],
      }),
    });
    expect(post.status).toBe(200);
    const posted = (await post.json()) as { appended: Record<string, number> };
    expect(posted.appended).toEqual({ decisions: 1, predictions: 0, episodes: 2 });

    const stats = await fetch(`${baseUrl}/trajectories/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await stats.json()) as { runs: Array<Record<string, unknown>> };
    const run = body.runs.find((r) => r.runId === 'vr-test-1');
    expect(run).toMatchObject({ decisions: 1, predictions: 0, episodes: 2 });
  });

  it('rejects malicious runIds', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/trajectories/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ runId: '../../etc', episodes: [{}] }),
    });
    expect(res.status).toBe(400);
  });
```

- [ ] **Steps 2–4 : échec → implémentation (méthodes `handleTrajectoriesBatch`/`handleTrajectoriesStats`, helper JWT+rate-limit factorisé avec `/agents/plan`) → suite BFF verte + typecheck.** **Step 5 : Commit** `feat(bff): trajectory ingestion and stats endpoints`.

---

### Task 7 : Démo — recorder + uploader + nettoyage SonarQube

**Files:**
- Create: `apps/demo/src/simulation/TrajectoryUploader.ts`
- Modify: `apps/demo/src/simulation/CardinalSimulationSystem.ts`
- Modify: `apps/demo/src/index.ts`
- Verify: typecheck démo + vérification finale complète

**Interfaces / contenu :**
- `CardinalSimulationSystem` : champ public `recorder!: TrajectoryRecorder` créé et attaché dans `init()` (`new TrajectoryRecorder(this.runtime, SIM_SEED, this.weather)`). Corrections SonarQube au passage : `listeners`, `lastSpeech`, `campfireBindings` → `readonly` (réassignation de `listeners` remplacée par `splice`/filtre en place ou conserver la réassignation et marquer readonly uniquement les jamais-réassignés) ; extraire de `update()` une méthode privée `projectScene(delta)` (réduit la complexité cognitive sous 15) ; `for (const listener of [...this.listeners])` → itération directe si la liste n'est plus réassignée pendant l'émission (sinon copie conservée UNIQUEMENT dans `emit`).
- `TrajectoryUploader.ts` : classe compacte — `constructor(system, baseUrl?)` ; `runId = 'vr-' + SIM_SEED + '-' + Date.now().toString(36)` ; toutes les 10 s : `batch = system.recorder.drain()` ; si un flux non vide → token (même logique que Mode2Client) puis `POST /trajectories/batch { runId, ...batch }` ; échec → avertissement unique + **rebufferiser le batch** (le re-fusionner en tête pour ne pas perdre de données) ; `dispose()`.
- `index.ts` : `new TrajectoryUploader(simSystem);` après le Mode2Client.

- [ ] **Step 1 : Implémenter.**
- [ ] **Step 2 : Vérification finale complète**

Run : `pnpm typecheck && pnpm test && pnpm build && pnpm demo:build`, plus un smoke headless : `node packages/simulation/dist/headless.js --seed 3 --days 1 --out /tmp/cardinal-smoke && ls /tmp/cardinal-smoke/*/`.
Expected : tout vert ; le dossier smoke contient les 5 fichiers.

- [ ] **Step 3 : Commit** `feat(demo): trajectory recorder wiring with periodic bff upload`.

---

## Couverture spec (auto-contrôle)

| Exigence spec | Tâche(s) |
| :--- | :--- |
| decisions.jsonl au format messages tool-calling + meta seed/tick (§9.1) | 4 |
| predictions.jsonl : quadruplet perçu/action/prédit/réel + surprise (§5, §9.1) | 2 (provenance), 4 |
| episodes.jsonl : journal narratif par tick (§9.1) | 4 |
| Recorder actif en VR ET headless, sans perturber la sim (§9.1) | 2, 3 (test), 4, 7 |
| Métriques (a) croyances (b) surprise (c) bien-être (d) plans (§9.3) | 3 |
| `/trajectories/batch` + stats côté BFF (§9.2) | 6 |
| Mode headless : ticks aussi vite que possible, batch N graines × M jours (§8.5) | 5 |
| Même code/scénario VR et headless (§3, §8.5) | 1 |
| Comparaison de politiques : deux runs même graine ⇒ flux identiques (§9.3) | 4, 5 (tests déterminisme) |

Notes assumées : la comparaison A/B de « deux modèles LLM » (spec §9.3) s'exerce dès maintenant entre `mock` et LLM réel via le BFF — le branchement d'un vrai planner LLM dans le headless Node (fetch vers le BFF) est un ajout trivial différé ; le marquage `source: 'player_voice'` (§9.4) arrive avec le joueur (étape 6).
