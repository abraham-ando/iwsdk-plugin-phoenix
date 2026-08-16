# Moteur de Simulation — Étape 4 : Mode-2 LLM + Mémoire + BFF — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les agents pensent : mémoire épisodique avec saillance et récupération pondérée, requêtes de planification Mode-2 construites depuis les croyances (jamais la vérité terrain), plans LLM injectés comme événements externes journalisés (replay exact conservé), dialogues agent↔agent qui propagent l'information dans les croyances, réflexion nocturne, endpoint BFF `/agents/plan` avec journalisation JSONL côté serveur et **mode mock déterministe** sans clé API.

**Architecture:** Le moteur reste 100 % headless et déterministe : il **émet** des `PlanRequest` (outbox) et **consomme** des réponses via `kernel.submitEvent` (event-log → replay exact, spec §8.3). Le transport est côté démo (`Mode2Client` → BFF → LLM cloud ou mock). L'arbitrage LeCun : un besoin urgent (Mode-1) interrompt le plan ; sinon le plan LLM guide l'agent. La mémoire est en-moteur, **lexicale et déterministe** (récence × importance × pertinence) — le RAG vectoriel de `packages/ai` reste une évolution ultérieure notée, pour ne pas introduire d'embeddings non déterministes dans le moteur.

**Tech Stack:** moteur : TypeScript pur + vitest. BFF : `node:http` existant (JWT, rate-limiter), `node:fs` pour le JSONL. Démo : fetch + `setInterval` (pompe découplée du frame loop).

**Spec:** `docs/superpowers/specs/2026-08-15-simulation-engine-design.md` (sections 7.2–7.5, 8.3, 9.2, 13.4)

## Global Constraints

- Le moteur n'appelle JAMAIS le réseau ; les réponses LLM n'entrent que par `kernel.submitEvent`/event-log (spec §8.3).
- Budget Mode-2 : ≤ 12 requêtes par agent et par jour simulé, remis à zéro à l'aube (spec §7.2) ; une seule requête en attente par agent.
- Zéro `Math.random()`/`Date.now()` dans `packages/simulation/src` ; le BFF peut horodater (il est hors moteur).
- Toutes les charges utiles d'événements externes sont du JSON sérialisable (le journal doit rejouer).
- Sans BFF joignable ou sans réponse valide : les agents continuent en Mode-1 pur — jamais de blocage.
- Conventions inchangées (commits `feat(...)` + trailer Claude, TDD moteur/BFF, typecheck démo).

---

## Structure de fichiers cible

```
packages/simulation/src/agents/
├── MemoryStream.ts        (nouveau) mémoire épisodique déterministe
├── Mode2.ts               (nouveau) PlanRequest, PlannedStep, parse/validation
├── AgentState.ts          (modifié) persona, memories, plan, mode2, speech
├── AgentRuntime.ts        (modifié) triggers, outbox, événements externes, arbitrage
└── needs.ts               (modifié) maxUrgency()

packages/simulation/src/kernel/snapshot.ts   (modifié) champs agents optionnels
packages/simulation/test/
├── memory-stream.test.ts  mode2.test.ts  runtime-mode2.test.ts
└── (village-e2e inchangé — Mode-1 seul reste vert)

apps/bff-server/src/server.ts        (modifié) route /agents/plan + mock + JSONL
apps/bff-server/test/bff-server.test.ts (étendu)

apps/demo/src/simulation/
├── Mode2Client.ts         (nouveau) pompe outbox → BFF → submitEvent
├── layout.ts              (modifié) persona par agent
├── CardinalSimulationSystem.ts (modifié) personas, événements 🧠/💬 au HUD
└── simulation-hud.ts      (modifié) rendu dialogues/plans
apps/demo/src/index.ts     (modifié) démarrage Mode2Client
```

---

### Task 1 : MemoryStream — mémoire épisodique déterministe

**Files:**
- Create: `packages/simulation/src/agents/MemoryStream.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/memory-stream.test.ts`

**Interfaces:**
- Consumes: `TICKS_PER_DAY`.
- Produces:
  - `type MemoryKind = 'event' | 'dialogue' | 'reflection'`
  - `interface MemoryEntry { tick: number; text: string; importance: number; kind: MemoryKind }` (importance 0–10)
  - `const MEMORY_CAPACITY = 200`
  - `class MemoryStream { add(entry: MemoryEntry): void; retrieve(query: string, nowTick: number, k?: number): MemoryEntry[]; all(): readonly MemoryEntry[]; toJSON(): MemoryEntry[]; static fromJSON(entries: MemoryEntry[]): MemoryStream }`
  - Score de récupération (Smallville, spec §7.3) : `(importance / 10) × exp(−(now − tick) / TICKS_PER_DAY) × (1 + recouvrement de tokens minuscules entre query et text)` ; tri décroissant, égalité départagée par tick décroissant puis texte. Au-delà de `MEMORY_CAPACITY`, éviction de l'entrée au plus faible `importance × récence`.

- [ ] **Step 1 : Tests qui échouent** — `packages/simulation/test/memory-stream.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { MemoryStream, MEMORY_CAPACITY } from '../src/agents/MemoryStream';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';

describe('MemoryStream', () => {
  it('retrieves by combined recency, importance and relevance', () => {
    const mem = new MemoryStream();
    mem.add({ tick: 100, text: 'le buisson nord est vide', importance: 4, kind: 'event' });
    mem.add({ tick: 5000, text: 'Mira m’a donné des baies', importance: 6, kind: 'dialogue' });
    mem.add({ tick: 5200, text: 'le loup rôde près de la rivière', importance: 9, kind: 'event' });
    const now = 5400;
    const aboutBerries = mem.retrieve('baies buisson', now, 2);
    expect(aboutBerries[0]?.text).toContain('baies');
    const top = mem.retrieve('', now, 1);
    expect(top[0]?.text).toContain('loup'); // importance+récence dominent sans requête
  });

  it('relevance boosts old but on-topic memories over fresh noise', () => {
    const mem = new MemoryStream();
    mem.add({ tick: 0, text: 'grand gisement de silex à la crête', importance: 5, kind: 'event' });
    mem.add({ tick: 2000, text: 'belle sieste au soleil', importance: 5, kind: 'event' });
    const res = mem.retrieve('silex gisement crête', 2400, 1);
    expect(res[0]?.text).toContain('silex');
  });

  it('caps at MEMORY_CAPACITY by evicting weakest entries', () => {
    const mem = new MemoryStream();
    for (let i = 0; i < MEMORY_CAPACITY + 50; i++) {
      mem.add({ tick: i, text: `souvenir ${i}`, importance: i % 10, kind: 'event' });
    }
    expect(mem.all()).toHaveLength(MEMORY_CAPACITY);
  });

  it('JSON round-trips', () => {
    const mem = new MemoryStream();
    mem.add({ tick: 1, text: 'premier feu allumé', importance: 7, kind: 'event' });
    const restored = MemoryStream.fromJSON(JSON.parse(JSON.stringify(mem.toJSON())));
    expect(restored.all()).toEqual(mem.all());
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `cd packages/simulation && pnpm vitest run memory-stream` → FAIL.

- [ ] **Step 3 : Implémenter**

```ts
import { TICKS_PER_DAY } from '../kernel/SimKernel';

/**
 * Deterministic episodic memory (spec §7.3, Smallville scoring). Retrieval is
 * lexical (token overlap), not vector-based: the engine stays deterministic
 * and dependency-free. Vector RAG via packages/ai is a later, renderer-side
 * enrichment.
 */
export type MemoryKind = 'event' | 'dialogue' | 'reflection';

export interface MemoryEntry {
  tick: number;
  text: string;
  importance: number; // 0-10
  kind: MemoryKind;
}

export const MEMORY_CAPACITY = 200;

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2)
  );
}

export class MemoryStream {
  private entries: MemoryEntry[] = [];

  add(entry: MemoryEntry): void {
    this.entries.push({ ...entry });
    if (this.entries.length > MEMORY_CAPACITY) {
      // Evict the weakest by importance × recency (relative to newest tick).
      const now = entry.tick;
      let weakest = 0;
      let weakestScore = Infinity;
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i]!;
        const score = (e.importance / 10) * Math.exp(-(now - e.tick) / TICKS_PER_DAY);
        if (score < weakestScore) {
          weakestScore = score;
          weakest = i;
        }
      }
      this.entries.splice(weakest, 1);
    }
  }

  retrieve(query: string, nowTick: number, k = 6): MemoryEntry[] {
    const queryTokens = tokens(query);
    const scored = this.entries.map((e) => {
      const recency = Math.exp(-(nowTick - e.tick) / TICKS_PER_DAY);
      let overlap = 0;
      if (queryTokens.size > 0) {
        for (const t of tokens(e.text)) if (queryTokens.has(t)) overlap++;
      }
      return { entry: e, score: (e.importance / 10) * recency * (1 + overlap) };
    });
    scored.sort(
      (a, b) =>
        b.score - a.score || b.entry.tick - a.entry.tick || a.entry.text.localeCompare(b.entry.text)
    );
    return scored.slice(0, k).map((s) => ({ ...s.entry }));
  }

  all(): readonly MemoryEntry[] {
    return this.entries;
  }

  toJSON(): MemoryEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  static fromJSON(entries: MemoryEntry[]): MemoryStream {
    const stream = new MemoryStream();
    for (const e of entries) stream.entries.push({ ...e });
    return stream;
  }
}
```

Export dans `src/index.ts` : `export { MemoryStream, MEMORY_CAPACITY, type MemoryEntry, type MemoryKind } from './agents/MemoryStream';`

- [ ] **Step 4 : Vérifier** — 4 passed + typecheck. **Step 5 : Commit** `feat(simulation): deterministic episodic memory stream with salience retrieval`.

---

### Task 2 : État Mode-2 sur l'agent + maxUrgency

**Files:**
- Modify: `packages/simulation/src/agents/needs.ts` (`maxUrgency`)
- Modify: `packages/simulation/src/agents/AgentState.ts`
- Modify: `packages/simulation/src/kernel/snapshot.ts`
- Test: ajouts dans `packages/simulation/test/needs.test.ts` et `village-e2e.test.ts` (round-trip)

**Interfaces:**
- Produces (needs.ts) : `function maxUrgency(needs: AgentNeeds): number` (max des 5 urgences).
- Produces (AgentState.ts) :
  - `AgentProfile.persona?: string`
  - `interface Mode2State { budgetUsed: number; pendingRequestId: string | null; lastDawnDay: number; lastReflectionDay: number; dialogueCooldownUntilTick: number }`
  - `AgentState` gagne : `memories: MemoryStream`, `plan: PlannedStep[]` (vide par défaut), `mode2: Mode2State`, `speech: { text: string; untilTick: number } | null`.
  - `createAgent` initialise : `memories: new MemoryStream()`, `plan: []`, `mode2: { budgetUsed: 0, pendingRequestId: null, lastDawnDay: -1, lastReflectionDay: -1, dialogueCooldownUntilTick: 0 }`, `speech: null`.
  - Import type `PlannedStep` depuis `./Mode2` (créé en tâche 3 — pour ordonner les commits sans dépendance circulaire, définir `PlannedStep` DANS `AgentState.ts` et le ré-exporter depuis `Mode2.ts`) : `interface PlannedStep { goal: string; verb: string; objectId?: string; predicted: string }`.
- Produces (snapshot.ts) : `SerializedAgent` gagne les champs **optionnels** `persona?: string; memories?: MemoryEntry[]; plan?: PlannedStep[]; mode2?: Mode2State` ; `snapshotSim` les écrit toujours ; `restoreSim` les restaure si présents (défauts de `createAgent` sinon). `AgentView` (AgentRuntime) gagne `dialogue: string | null` — rempli en tâche 5, initialisé à `null` dans `view()` dès cette tâche (`agent.speech !== null && tick <= untilTick` sera branché plus tard ; ici retourner `agent.speech?.text ?? null`).

- [ ] **Step 1 : Tests** — dans `needs.test.ts` ajouter :

```ts
  it('maxUrgency returns the dominant drive', () => {
    const needs = createDefaultNeeds();
    needs.warmth = 10;
    expect(maxUrgency(needs)).toBeCloseTo(urgency(needs, 'warmth'));
  });
```

(+ import `maxUrgency`). Dans `village-e2e.test.ts`, test 3 (round-trip) : après restore ajouter `expect(runtime.agents.get('mira')!.memories.all()).toEqual(run.runtime.agents.get('mira')!.memories.all());`.

- [ ] **Step 2 : Vérifier l'échec**, **Step 3 : Implémenter** (voir Interfaces — code direct : `maxUrgency` = boucle sur les 5 ids ; extensions d'état et de sérialisation par recopie `{ ...) }` comme les champs existants ; `memories: a.memories.toJSON()`, restore via `MemoryStream.fromJSON`).

- [ ] **Step 4 : Vérifier** — toute la suite moteur verte. **Step 5 : Commit** `feat(simulation): mode-2 agent state, personas, memory serialization`.

---

### Task 3 : Mode2.ts — PlanRequest et validation des plans

**Files:**
- Create: `packages/simulation/src/agents/Mode2.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/mode2.test.ts`

**Interfaces:**
- Consumes: `AgentState` (+ `PlannedStep` ré-exporté), `SmartObjectRegistry`, `IntrinsicActionDef`, `hourOfDay`.
- Produces:
  - `type PlanRequestReason = 'dawn' | 'surprise' | 'dialogue' | 'reflection'`
  - `interface PlanToolCandidate { verb: string; objectId?: string; type?: string; distance?: number }`
  - `interface PlanRequest { requestId: string; reason: PlanRequestReason; agentId: string; participantIds?: string[]; tick: number; hour: number; persona: string; role: string; tribe: string; needs: Record<string, number>; place: string | null; beliefs: Array<{ objectId: string; type: string; distance: number; state: Record<string, number> }>; memories: string[]; tools: PlanToolCandidate[]; currentPlan: string[] }`
  - `function buildPlanRequest(agent: AgentState, registry: SmartObjectRegistry, intrinsics: IntrinsicActionDef[], tick: number, reason: PlanRequestReason, place: string | null, participantIds?: string[]): PlanRequest` — **ne lit que l'état de l'agent** (croyances, souvenirs, besoins) ; `requestId = \`${agent.profile.id}:${tick}:${reason}\`` ; beliefs = 12 plus proches ; memories = `memories.retrieve('', tick, 6).map(e => e.text)` (pour dawn) ou requête = raison ; tools = pour chaque croyance, les verbes d'affordance du type (candidats `{verb, objectId, type, distance}` arrondis au dixième) + les intrinsèques `{verb}`.
  - `function parsePlanSteps(payload: unknown, registry: SmartObjectRegistry, intrinsics: IntrinsicActionDef[], agent: AgentState): PlannedStep[]` — accepte `{ steps: [{goal, verb, objectId?, predicted}] }` ; filtre : verbe connu (intrinsèque OU affordance d'un type du registre), `objectId` requis et présent dans les croyances pour les verbes-monde ; max 5 pas ; champs manquants → pas ignoré. Jamais d'exception sur payload malformé (retourne `[]`).

- [ ] **Step 1 : Tests** — `packages/simulation/test/mode2.test.ts` :

```ts
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
```

- [ ] **Step 2 : Échec vérifié.** **Step 3 : Implémenter** selon Interfaces (les verbes-monde valides = union des verbes de tous les types du registre, précalculée ; l'existence de l'objectId vérifiée via `agent.beliefs.get`). **Step 4 : Vérifier + typecheck.** **Step 5 : Commit** `feat(simulation): mode-2 plan requests from beliefs and strict plan validation`.

---

### Task 4 : Runtime — triggers, outbox, exécution de plan, arbitrage

**Files:**
- Modify: `packages/simulation/src/agents/AgentRuntime.ts`
- Test: `packages/simulation/test/runtime-mode2.test.ts`

**Interfaces (ajouts AgentRuntime) :**
- `drainPlanRequests(): PlanRequest[]` (outbox vidée).
- Constantes : `DAWN_HOUR = 6`, `REFLECTION_HOUR = 21`, `MODE2_DAILY_BUDGET = 12`, `URGENCY_OVERRIDE = 0.55`.
- Triggers (dans `tickAgent`, après perception) :
  - **dawn** : quand `hour >= 6` et `mode2.lastDawnDay < dayIndex` → requête `'dawn'`, `lastDawnDay = dayIndex`, budget remis à 0 **avant** consommation.
  - **surprise** : sur `ActionEvent` `failed` → requête `'surprise'` (mémoire importance 4 ajoutée : `« Échec: {verb} — {reason} »`).
  - **reflection** : `hour >= 21` et `lastReflectionDay < dayIndex` → requête `'reflection'` (ne consomme pas le budget).
  - Garde-fous communs : pas de requête si `pendingRequestId !== null` ou budget épuisé (sauf reflection) ; à l'émission `pendingRequestId = requestId`, `budgetUsed++`.
- Événements externes (début de `tickAll`, avant les agents, itération sur `ctx.events`) :
  - `'llm_plan'` payload `{ requestId, agentId, steps }` : si `agent.mode2.pendingRequestId === requestId` → `pendingRequestId = null` ; `agent.plan = parsePlanSteps(...)` ; mémoire (`« J'ai un nouveau plan: {goals} »`, importance 3) ; événement `started`-like non requis.
  - `'llm_reflection'` payload `{ requestId, agentId, insights: string[] }` : `pendingRequestId = null` ; chaque insight → mémoire `kind: 'reflection'`, importance 8.
  - Payload inconnu/agent inconnu : ignoré sans erreur.
- Exécution de plan (dans la phase de sélection) :
  - Si `currentAction === null` : si `maxUrgency(agent.needs) <= URGENCY_OVERRIDE` et `agent.plan.length > 0` → dépiler des pas jusqu'à en trouver un exécutable : intrinsèque → action intrinsèque ; monde → croyance `objectId` requise (sinon pas abandonné + mémoire importance 2 `« Pas de plan abandonné: {verb} »`) ; installer l'action (événement `started`). Sinon (urgence ou plan vide) → Mode-1 comme aujourd'hui.
  - Mémoires automatiques : action `completed` → importance 1 (`« {verb} accompli »`) ; `failed` → importance 4 (déjà couvert par surprise).

- [ ] **Step 1 : Tests** — `packages/simulation/test/runtime-mode2.test.ts` :

```ts
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
    const oak = world.spawn('oak_tree', 12, 12);
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
```

- [ ] **Step 2 : Échec vérifié.** **Step 3 : Implémenter** selon Interfaces. Points de structure : `tickAll` traite `ctx.events` AVANT la boucle agents ; l'outbox est `private planRequests: PlanRequest[]` ; le trigger surprise se déclenche là où l'événement `failed` est déjà poussé ; l'exécution de plan est une méthode `private tryPlanStep(agent): boolean` appelée avant `selectAction`. Exporter `MODE2_DAILY_BUDGET` et `URGENCY_OVERRIDE`. Le calcul du jour : `Math.floor(ctx.tick / TICKS_PER_DAY)`.

- [ ] **Step 4 : Vérifier** — nouvelle suite + TOUTE la suite moteur (le village e2e Mode-1 doit rester vert : sans réponses LLM, les requêtes s'accumulent dans l'outbox sans effet). **Step 5 : Commit** `feat(simulation): mode-2 triggers, plan execution and reflex arbitration in runtime`.

---

### Task 5 : Dialogues agent↔agent — rumeur et croyances

**Files:**
- Modify: `packages/simulation/src/agents/AgentRuntime.ts`
- Test: ajouts dans `packages/simulation/test/runtime-mode2.test.ts`

**Interfaces:**
- Constantes : `DIALOGUE_RADIUS = 3`, `DIALOGUE_COOLDOWN_TICKS = 1200` (2 min sim), `SPEECH_DISPLAY_TICKS = 50`.
- Trigger (dans `tickAgent`, id initiateur < id partenaire pour l'unicité) : deux agents à ≤ 3 m, tous deux `currentAction === null` ou en `perform` reposant, cooldowns écoulés, budget initiateur disponible → requête `'dialogue'` avec `participantIds: [a, b]` ; les DEUX `dialogueCooldownUntilTick` sont posés à l'émission.
- Événement `'llm_dialogue'` payload `{ requestId, agentId, participantIds: [string, string], lines: Array<{ speaker: string; text: string }>, sharedFacts?: Array<{ objectId: string; type: string; x: number; z: number; state: Record<string, number> }> }` :
  - `pendingRequestId` de l'initiateur libéré ;
  - chaque ligne → mémoire `kind: 'dialogue'` importance 3 chez les deux participants (`« {speaker}: {text} »`) ;
  - `sharedFacts` → **upsert dans les croyances du non-locuteur de la majorité des lignes** — simplifier : upsert chez LES DEUX participants (`beliefs` : construire un `Belief` avec `lastSeenTick = tick` — la rumeur date d'aujourd'hui même si le fait est vieux, c'est voulu : spec §7.4) via une nouvelle méthode `BeliefState.learn(belief: Belief): void` (alias public de l'upsert interne — 3 lignes dans BeliefState.ts) ;
  - `agent.speech = { text: dernière ligne du locuteur, untilTick: tick + SPEECH_DISPLAY_TICKS }` pour chaque participant (sa dernière ligne à lui) ;
  - `AgentView.dialogue` renvoie `speech.text` si `tick` courant ≤ `untilTick` (le runtime garde le tick courant en champ privé mis à jour à chaque `tickAll`).

- [ ] **Step 1 : Tests** (ajout au fichier runtime-mode2) :

```ts
describe('dialogues', () => {
  it('two idle neighbors trigger one dialogue request with cooldown', () => {
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
});
```

- [ ] **Step 2–4 : Échec → implémentation → toute la suite verte + typecheck.** **Step 5 : Commit** `feat(simulation): agent dialogues with rumor-to-belief transfer and speech views`.

---

### Task 6 : BFF `/agents/plan` — LLM réel, mock déterministe, JSONL serveur

**Files:**
- Modify: `apps/bff-server/src/server.ts`
- Test: `apps/bff-server/test/bff-server.test.ts` (nouveau `describe`)

**Interfaces:**
- `BFFServerConfig` gagne `datasetDir?: string | null` (défaut `'./datasets/agents'` ; `null` = journalisation coupée).
- Route `POST /agents/plan` (JWT requis comme `/api/v1/cardinal/chat`, rate-limitée) ; corps = `{ request: PlanRequest }` (le type est structurel — pas d'import du moteur dans le BFF : déclarer un type local minimal `{ requestId; reason; agentId; participantIds?; persona; role; needs; beliefs; memories; tools; hour }`).
- **Mode réel** (clé Groq/OpenAI configurée ou en env) : messages construits par raison — system = contrat de sortie JSON STRICT :
  - `dawn`/`surprise` : « Tu es {persona}, {role}. Besoins: {...}. Souvenirs: {...}. Outils (verbe+objectId): {...}. Réponds UNIQUEMENT en JSON: {"steps":[{"goal","verb","objectId","predicted"}]} (≤4 pas, verbes de la liste seulement, predicted = résultat concret attendu). »
  - `dialogue` : « Écris 2 à 4 répliques naturelles en français entre {a} et {b}... JSON: {"lines":[{"speaker","text"}],"sharedFacts":[…croyances citées…]} »
  - `reflection` : « Synthétise la journée en 1 à 3 enseignements durables. JSON: {"insights":["…"]} »
  - Appel upstream identique au proxy chat (`temperature: 0.6`, `response_format: { type: 'json_object' }` si OpenAI) ; réponse : extraire `choices[0].message.content`, `JSON.parse` ; échec de parsing → 502 `{ error: 'invalid llm output' }`.
- **Mode mock** (aucune clé) — déterministe, pour dev/tests/offline :
  - `dawn`/`surprise` : jusqu'à 3 pas choisis dans `request.tools` porteurs d'`objectId`, ordonnés par `distance`, verbes préférés dans l'ordre `['gather_berries','gather_wood','gather_flint','light_fire']`, complétés par `eat_berries` si présent dans tools ; `predicted: 'réussite de {verb}'`.
  - `dialogue` : deux lignes fixes citant le premier belief (`sharedFacts = [premier belief de request.beliefs]` reformaté), speakers = participantIds.
  - `reflection` : `insights: ['Jour vécu: besoins gérés, tribu soudée.']`.
- **Journalisation** (les deux modes, spec §9.2) : si `datasetDir` non-null, `fs.appendFile(datasetDir + '/decisions-' + YYYYMMDD + '.jsonl', JSON.stringify({ at: Date.now(), request, response }) + '\n')` (mkdir récursif au premier appel, erreurs de log avalées silencieusement — la réponse ne doit jamais échouer à cause du disque).
- Réponse : `{ requestId, reason, agentId, participantIds?, ...payloadSpécifique }` — exactement la forme que `Mode2Client` soumettra au kernel.

- [ ] **Step 1 : Lire le harnais de test existant** (`apps/bff-server/test/bff-server.test.ts`) et ajouter dans le même style un `describe('/agents/plan')` : serveur démarré avec `{ jwtSecret: 'test', datasetDir: <dossier tmp du test>, rateLimitMax: 100 }` et AUCUNE clé (mode mock ; veiller à ce que le test neutralise `process.env.GROQ_API_KEY`/`OPENAI_API_KEY` s'ils fuient : les sauver/effacer en `beforeAll`, restaurer en `afterAll`) :

```ts
  it('401 without token', async () => { /* POST sans Authorization -> 401 */ });
  it('mock mode returns a valid dawn plan and logs jsonl', async () => {
    // token via /api/auth/session, POST { request: { requestId:'mira:100:dawn', reason:'dawn',
    // agentId:'mira', persona:'p', role:'r', needs:{hunger:20}, hour:6, memories:[],
    // beliefs:[{objectId:'berry_bush_1',type:'berry_bush',distance:2,state:{berriesLeft:8}}],
    // tools:[{verb:'gather_berries',objectId:'berry_bush_1',distance:2},{verb:'eat_berries'}] } }
    // -> 200, body.steps: [{verb:'gather_berries',objectId:'berry_bush_1',...}, {verb:'eat_berries',...}]
    // -> le fichier decisions-*.jsonl existe et contient requestId
  });
  it('mock dialogue returns lines and sharedFacts', async () => { /* reason:'dialogue', participantIds -> lines.length in [2..4], sharedFacts[0].objectId === premier belief */ });
```

(Écrire les corps complets en suivant les helpers du fichier existant — même port, même façon d'appeler `fetch`.)

- [ ] **Step 2 : Échec vérifié** (`pnpm --filter @iwsdk/cardinal-bff-server test`). **Step 3 : Implémenter** la route (une méthode privée `handleAgentsPlan`, helpers `buildMessages(request)`, `mockPlan(request)`, `appendDatasetLine(obj)`). **Step 4 : Suite BFF verte + typecheck.** **Step 5 : Commit** `feat(bff): /agents/plan endpoint with llm, deterministic mock and server-side jsonl logging`.

---

### Task 7 : Démo — personas, Mode2Client, HUD dialogues

**Files:**
- Modify: `apps/demo/src/simulation/layout.ts` (persona par agent)
- Create: `apps/demo/src/simulation/Mode2Client.ts`
- Modify: `apps/demo/src/simulation/CardinalSimulationSystem.ts`
- Modify: `apps/demo/src/simulation/simulation-hud.ts`
- Modify: `apps/demo/src/index.ts`
- Verify: typecheck démo + suite complète + builds

**Interfaces / contenu :**
- `layout.ts` : `LayoutAgent.persona: string` — une phrase par agent (ex. Haran : `'Protecteur pragmatique, pense d'abord à la sécurité des siens'` ; Mira : `'Douce et prévoyante, partage toujours'` ; Kan : `'Solitaire fier, préfère agir seul'`, etc. — une persona distincte et cohérente avec le rôle pour chacun des 11). `CardinalSimulationSystem.init` la passe dans `addAgent({ ..., persona: agent.persona }, …)`.
- `Mode2Client.ts` :

```ts
/**
 * Pumps the engine's plan-request outbox to the BFF and feeds responses back
 * as journaled external events (spec §8.3). Fire-and-forget: any failure
 * leaves the agents running on Mode-1 reflexes.
 */
import type { CardinalSimulationSystem } from './CardinalSimulationSystem';
import type { PlanRequest } from '@iwsdk/cardinal-simulation';

const EVENT_BY_REASON: Record<string, string> = {
  dawn: 'llm_plan',
  surprise: 'llm_plan',
  dialogue: 'llm_dialogue',
  reflection: 'llm_reflection',
};

export class Mode2Client {
  private queue: PlanRequest[] = [];
  private inFlight = 0;
  private token: string | null = null;
  private warnedOffline = false;
  private timer: number;

  constructor(
    private system: CardinalSimulationSystem,
    private baseUrl: string = (import.meta.env?.VITE_BFF_URL as string | undefined) ?? 'http://localhost:3001'
  ) {
    this.timer = window.setInterval(() => void this.pump(), 250);
  }

  private async ensureToken(): Promise<string> { /* POST /api/auth/session {deviceId:'cardinal-sim'} ; cache */ }

  private async pump(): Promise<void> {
    this.queue.push(...this.system.runtime.drainPlanRequests());
    while (this.inFlight < 3 && this.queue.length > 0) {
      const request = this.queue.shift()!;
      this.inFlight++;
      void this.send(request).finally(() => { this.inFlight--; });
    }
  }

  private async send(request: PlanRequest): Promise<void> {
    try {
      const token = await this.ensureToken();
      const res = await fetch(`${this.baseUrl}/agents/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request }),
      });
      if (!res.ok) throw new Error(`bff ${res.status}`);
      const payload = await res.json();
      this.system.kernel.submitEvent(EVENT_BY_REASON[request.reason] ?? 'llm_plan', payload);
    } catch (err) {
      if (!this.warnedOffline) {
        this.warnedOffline = true;
        console.warn('[Mode2Client] BFF unreachable — agents continue on Mode-1 reflexes.', err);
      }
      // Dropped request: the engine's pending flag must be released so the
      // agent can ask again later.
      this.system.runtime.releasePendingRequest(request.agentId, request.requestId);
    }
  }

  dispose(): void { window.clearInterval(this.timer); }
}
```

  Cette méthode `releasePendingRequest(agentId, requestId)` (3 lignes : si `mode2.pendingRequestId === requestId` → `null`) est à AJOUTER à `AgentRuntime` (petit retour tâche 4 — l'ajouter directement ici avec un test unitaire d'une ligne dans runtime-mode2).
- `CardinalSimulationSystem` : narration enrichie — sur événement externe reçu, émettre au HUD : plan installé → `🧠 {name} médite un nouveau plan.` (détectable : exposer un compteur ou, plus simple, narrer côté runtime n'existe pas — approche retenue : dans `update()`, comparer `agent.plan.length` avant/après n'est pas fiable ; PLUS SIMPLE : le HUD n'a pas besoin de cet événement précis — n'ajouter au HUD que les dialogues : à chaque frame, pour chaque `view.dialogue` non-nul ET différent du dernier affiché (cache `Map<string,string>`), émettre `{ kind: 'action', text: '💬 {name}: «{dialogue}»' }`). Implémenter ce cache `lastSpeech` dans le système.
- `simulation-hud.ts` : les événements dont le texte commence par 💬 prennent la bordure bleue dialogue (`rgba(59,130,246,0.4)`).
- `index.ts` : après `new SimulationHud(...)` → `new Mode2Client(simSystem);`.

- [ ] **Step 1 : Implémenter le tout** (layout personas, releasePendingRequest + son test, Mode2Client, câblages).
- [ ] **Step 2 : Vérification finale complète**

Run : `pnpm --filter @iwsdk/cardinal-simulation test && pnpm --filter @iwsdk/cardinal-bff-server test && pnpm typecheck && pnpm test && pnpm build && pnpm demo:build`
Expected : tout vert.

- [ ] **Step 3 : Commit** `feat(demo): mode-2 client pumping plan requests to bff, personas and dialogue hud`.

---

## Couverture spec (auto-contrôle)

| Exigence spec | Tâche(s) |
| :--- | :--- |
| Mémoire épisodique, saillance, récupération récence×importance×pertinence (§7.3) | 1 |
| Persona/configurateur sur l'agent (§7.5) | 2, 7 |
| Prompt Mode-2 : identité, besoins, croyances, souvenirs, plan courant (§7.2) | 3 |
| Tool-calling sur le schéma des affordances, `predicted` exigé (§7.2, §5) | 3, 6 |
| Budget ≤12/jour, déclencheurs aube/surprise (§7.2) | 4 |
| Réponses LLM = événements externes journalisés, replay exact (§8.3) | 4 (test replay) |
| Arbitrage réflexe/plan (Mode-1 prime en urgence) (§7.1) | 4 |
| Réflexion nocturne → enseignements durables (§7.3) | 4 (événement), 6 (génération) |
| Dialogues 2-4 répliques, l'information circule vers les croyances (§7.4) | 5, 6 |
| `/agents/plan` journalisé côté serveur (§9.2) | 6 |
| Le moteur ne bloque jamais sur le LLM ; dégradation en Mode-1 (§3, §7.1) | 4, 7 |

Notes assumées : récupération mémorielle **lexicale** déterministe (le RAG vectoriel de `packages/ai` viendra en enrichissement côté client, hors moteur) ; TTS spatial des dialogues et rigs RPM complets → différés (le HUD affiche les répliques ; `AgentView.dialogue` est prêt pour les bulles/TTS) ; la capture JSONL complète (3 flux, batch) reste l'étape 5 — la journalisation `/agents/plan` en est la première brique.
