# Moteur de Simulation — Étape 2 : AgentRuntime + Mode-1 — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Des agents incarnés dans `@iwsdk/cardinal-simulation` : besoins continus, perception locale, croyances datées, inventaire, navigation réelle, exécution d'affordances dans l'espace, et politique utility Mode-1 (réflexes LeCun) — une civilisation autonome sans LLM, déterministe et observable en headless.

**Architecture:** Nouveau répertoire `src/agents/` dans le paquet moteur. Les agents ne lisent jamais la vérité terrain : la perception produit une `Observation`, qui met à jour un `BeliefState` daté ; Mode-1 score les affordances *crues* (avec chaînage fournisseur limité en profondeur) ; l'exécuteur d'action confronte ensuite le plan au monde réel (échec = surprise). Tout est sérialisable (snapshot v2) et piloté par les ticks du kernel existant.

**Tech Stack:** TypeScript strict, vitest 3 — mêmes conventions que l'étape 1.

**Spec:** `docs/superpowers/specs/2026-08-15-simulation-engine-design.md` (sections 5, 6, 7.1, 8.4, 13.2)

## Global Constraints

- Zéro dépendance externe, zéro `Math.random()`/`Date.now()` dans `src/` (le RNG du kernel est la seule stochasticité).
- Déterminisme : itération des agents **triée par id** ; toute égalité de score se départage lexicographiquement.
- Les agents n'accèdent à `GroundTruthWorld` que via la perception et l'exécution d'action (jamais dans Mode-1).
- Besoins bornés [0, 100] ; 100 = satisfait, sauf `stress` où 0 = calme.
- TypeScript strict (`noUncheckedIndexedAccess`), messages de commit `feat(...)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- À chaque tâche : `pnpm --filter @iwsdk/cardinal-simulation test` et `typecheck` verts avant commit.

---

## Structure de fichiers cible

```
packages/simulation/src/
├── agents/
│   ├── needs.ts           NeedId, AgentNeeds, décroissance, urgence, coût bien-être
│   ├── intrinsics.ts      actions intrinsèques (manger, sieste) + helpers inventaire
│   ├── Perception.ts      Observation, rayons jour/nuit, perceive()
│   ├── BeliefState.ts     croyances datées, divergence vs vérité terrain, (dé)sérialisation
│   ├── navigation.ts      stepToward, vitesse, gué de rivière
│   ├── AgentState.ts      AgentProfile, AgentState, CurrentAction, createAgent
│   ├── actions.ts         executeActionTick (goto → perform → apply), ActionEvent
│   ├── Mode1.ts           scoring utility + chaînage fournisseur, selectAction
│   └── AgentRuntime.ts    orchestration par tick, vues de restitution, événements
├── world/affordances.ts   (modifié) effets actorNeeds
├── world/GroundTruthWorld.ts (modifié) affordancesOf(type)
├── content/objects.ts     (modifié) actorNeeds sur rest_nearby / sleep_inside / drink
└── kernel/snapshot.ts     (modifié) snapshot v2 avec agents

packages/simulation/test/
├── needs.test.ts          intrinsics.test.ts   perception.test.ts
├── belief-state.test.ts   navigation.test.ts   agent-actions.test.ts
├── mode1.test.ts          agent-runtime.test.ts
└── village-e2e.test.ts    (+ determinism.test.ts adapté au snapshot v2)
```

---

### Task 1 : Besoins — décroissance, urgence, coût

**Files:**
- Create: `packages/simulation/src/agents/needs.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/needs.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type NeedId = 'hunger' | 'warmth' | 'energy' | 'affection' | 'stress'`
  - `interface AgentNeeds { hunger: number; warmth: number; energy: number; affection: number; stress: number }`
  - `function createDefaultNeeds(): AgentNeeds` (tout à 80, stress à 10)
  - `interface NeedContext { hour: number; isMoving: boolean; nearLitFire: boolean; isSleeping: boolean }`
  - `function isNightHour(hour: number): boolean` (nuit = hour < 6 ou ≥ 20)
  - `function decayNeeds(needs: AgentNeeds, ctx: NeedContext): void` (mutation, par tick)
  - `function urgency(needs: AgentNeeds, id: NeedId): number` (0..1)
  - `function wellbeingCost(needs: AgentNeeds): number` (Σ urgences — la fonction de coût intrinsèque LeCun)
  - `function clampNeed(v: number): number`

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/needs.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  createDefaultNeeds,
  decayNeeds,
  urgency,
  wellbeingCost,
  isNightHour,
  clampNeed,
} from '../src/agents/needs';

describe('needs', () => {
  it('night hours span 20h-6h', () => {
    expect(isNightHour(2)).toBe(true);
    expect(isNightHour(6)).toBe(false);
    expect(isNightHour(12)).toBe(false);
    expect(isNightHour(20)).toBe(true);
  });

  it('hunger decays faster while moving', () => {
    const still = createDefaultNeeds();
    const moving = createDefaultNeeds();
    const day = { hour: 12, isMoving: false, nearLitFire: false, isSleeping: false };
    decayNeeds(still, day);
    decayNeeds(moving, { ...day, isMoving: true });
    expect(still.hunger).toBeLessThan(80);
    expect(moving.hunger).toBeLessThan(still.hunger);
  });

  it('warmth drops at night but recovers near a lit fire', () => {
    const cold = createDefaultNeeds();
    const warm = createDefaultNeeds();
    const night = { hour: 23, isMoving: false, nearLitFire: false, isSleeping: false };
    decayNeeds(cold, night);
    decayNeeds(warm, { ...night, nearLitFire: true });
    expect(cold.warmth).toBeLessThan(80);
    expect(warm.warmth).toBeGreaterThan(80);
  });

  it('energy recovers only while sleeping', () => {
    const awake = createDefaultNeeds();
    const asleep = createDefaultNeeds();
    const day = { hour: 12, isMoving: false, nearLitFire: false, isSleeping: false };
    decayNeeds(awake, day);
    decayNeeds(asleep, { ...day, isSleeping: true });
    expect(awake.energy).toBeLessThan(80);
    expect(asleep.energy).toBeGreaterThan(80);
  });

  it('stress relaxes toward zero over time', () => {
    const needs = createDefaultNeeds();
    needs.stress = 50;
    decayNeeds(needs, { hour: 12, isMoving: false, nearLitFire: false, isSleeping: false });
    expect(needs.stress).toBeLessThan(50);
  });

  it('urgency is quadratic: a starving agent dwarfs a peckish one', () => {
    const needs = createDefaultNeeds();
    needs.hunger = 90;
    const low = urgency(needs, 'hunger');
    needs.hunger = 10;
    const high = urgency(needs, 'hunger');
    expect(high).toBeGreaterThan(low * 10);
    // Stress is inverted: high stress = high urgency.
    needs.stress = 90;
    expect(urgency(needs, 'stress')).toBeGreaterThan(0.5);
  });

  it('wellbeingCost sums urgencies and clampNeed bounds values', () => {
    const perfect = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    expect(wellbeingCost(perfect)).toBe(0);
    const bad = { hunger: 0, warmth: 0, energy: 0, affection: 0, stress: 100 };
    expect(wellbeingCost(bad)).toBe(5);
    expect(clampNeed(150)).toBe(100);
    expect(clampNeed(-5)).toBe(0);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation vitest run needs` (depuis la racine : `cd packages/simulation && pnpm vitest run needs`)
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/agents/needs.ts` :

```ts
/**
 * Agent needs = LeCun intrinsic cost (spec §5, §6.3). 100 = satisfied
 * (except stress: 0 = calm). Decay is per 100 ms tick; rates are tuned for
 * a 2400-tick day: ~2 meals/day, one night ruins warmth without a fire.
 */
export type NeedId = 'hunger' | 'warmth' | 'energy' | 'affection' | 'stress';

export interface AgentNeeds {
  hunger: number;
  warmth: number;
  energy: number;
  affection: number;
  stress: number;
}

export function createDefaultNeeds(): AgentNeeds {
  return { hunger: 80, warmth: 80, energy: 80, affection: 80, stress: 10 };
}

export interface NeedContext {
  hour: number;
  isMoving: boolean;
  nearLitFire: boolean;
  isSleeping: boolean;
}

export function isNightHour(hour: number): boolean {
  return hour < 6 || hour >= 20;
}

export function clampNeed(v: number): number {
  return Math.min(100, Math.max(0, v));
}

export function decayNeeds(needs: AgentNeeds, ctx: NeedContext): void {
  needs.hunger = clampNeed(needs.hunger - (ctx.isMoving ? 0.03 : 0.02));
  needs.energy = clampNeed(needs.energy + (ctx.isSleeping ? 0.05 : ctx.isMoving ? -0.02 : -0.01));
  const warmthDelta = ctx.nearLitFire ? 0.15 : isNightHour(ctx.hour) ? -0.05 : -0.01;
  needs.warmth = clampNeed(needs.warmth + warmthDelta);
  needs.affection = clampNeed(needs.affection - 0.005);
  needs.stress = clampNeed(needs.stress - 0.02);
}

/** Quadratic urgency in [0, 1]. Stress is inverted (high stress = urgent). */
export function urgency(needs: AgentNeeds, id: NeedId): number {
  const v = needs[id];
  const deficit = id === 'stress' ? v : 100 - v;
  return (deficit / 100) ** 2;
}

const ALL_NEEDS: NeedId[] = ['hunger', 'warmth', 'energy', 'affection', 'stress'];

/** LeCun intrinsic cost: what Mode-1 minimizes by reflex, Mode-2 by rollout. */
export function wellbeingCost(needs: AgentNeeds): number {
  return ALL_NEEDS.reduce((sum, id) => sum + urgency(needs, id), 0);
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export {
  createDefaultNeeds,
  decayNeeds,
  urgency,
  wellbeingCost,
  isNightHour,
  clampNeed,
  type NeedId,
  type AgentNeeds,
  type NeedContext,
} from './agents/needs';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm vitest run needs` (7 passed) puis `pnpm typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/agents/needs.ts packages/simulation/src/index.ts packages/simulation/test/needs.test.ts
git commit -m "feat(simulation): agent needs with per-tick decay and quadratic urgency cost

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : Effets `actorNeeds` dans les affordances + catalogue

**Files:**
- Modify: `packages/simulation/src/world/SmartObject.ts` (effects.actorNeeds)
- Modify: `packages/simulation/src/world/affordances.ts` (ActorContext.needs, applyAffordance)
- Modify: `packages/simulation/src/content/objects.ts` (rest_nearby, sleep_inside, drink)
- Test: `packages/simulation/test/affordances.test.ts` (ajout), `packages/simulation/test/content-catalog.test.ts` (ajout)

**Interfaces:**
- Consumes: `clampNeed` (Task 1).
- Produces: `AffordanceDef.effects.actorNeeds?: Record<string, number>` ; `ActorContext.needs?: Record<string, number>` ; `applyAffordance` applique aussi les deltas de besoins (bornés 0..100). Catalogue : `rest_nearby` → `{ warmth: 20, energy: 10 }` ; `sleep_inside` → `{ energy: 60, warmth: 15 }` ; `drink` → `{ stress: -5 }`.

- [ ] **Step 1 : Ajouter les tests qui échouent**

Dans `packages/simulation/test/affordances.test.ts`, ajouter en fin de fichier :

```ts
describe('actorNeeds effects', () => {
  it('applies need deltas clamped to [0, 100]', () => {
    const rest: AffordanceDef = {
      verb: 'rest_nearby',
      durationTicks: 100,
      effects: { actorNeeds: { warmth: 20, energy: 10 } },
    };
    const fire: SmartObjectInstance = { id: 'f1', type: 'campfire', x: 0, z: 0, state: { lit: 1 } };
    const actor: ActorContext = { x: 0, z: 0, inventory: {}, needs: { warmth: 95, energy: 50 } };
    applyAffordance(rest, fire, actor);
    expect(actor.needs?.warmth).toBe(100); // clamped
    expect(actor.needs?.energy).toBe(60);
  });

  it('ignores actorNeeds when the actor has no needs (étape 1 callers)', () => {
    const rest: AffordanceDef = {
      verb: 'rest_nearby',
      durationTicks: 100,
      effects: { actorNeeds: { warmth: 20 } },
    };
    const fire: SmartObjectInstance = { id: 'f1', type: 'campfire', x: 0, z: 0, state: { lit: 1 } };
    const actor: ActorContext = { x: 0, z: 0, inventory: {} };
    expect(() => applyAffordance(rest, fire, actor)).not.toThrow();
  });
});
```

Dans `packages/simulation/test/content-catalog.test.ts`, ajouter :

```ts
describe('need-restoring affordances', () => {
  it('rest_nearby, sleep_inside and drink restore needs', () => {
    const reg = freshRegistry();
    const rest = reg.get('campfire').affordances.find((a) => a.verb === 'rest_nearby');
    expect(rest?.effects.actorNeeds).toEqual({ warmth: 20, energy: 10 });
    const sleep = reg.get('shelter').affordances.find((a) => a.verb === 'sleep_inside');
    expect(sleep?.effects.actorNeeds).toEqual({ energy: 60, warmth: 15 });
    const drink = reg.get('river_bank').affordances.find((a) => a.verb === 'drink');
    expect(drink?.effects.actorNeeds).toEqual({ stress: -5 });
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run affordances content-catalog` → FAIL (actorNeeds inexistant / toEqual undefined).

- [ ] **Step 3 : Implémenter**

Dans `SmartObject.ts`, étendre `AffordanceDef.effects` :

```ts
  effects: {
    object?: Record<string, number>;
    actorInventory?: Record<string, number>;
    actorNeeds?: Record<string, number>;
  };
```

Dans `affordances.ts` : ajouter `needs?: Record<string, number>;` à `ActorContext`, importer `clampNeed` depuis `../agents/needs`, et ajouter à la fin d'`applyAffordance` :

```ts
  if (def.effects.actorNeeds !== undefined && actor.needs !== undefined) {
    for (const [need, delta] of Object.entries(def.effects.actorNeeds)) {
      actor.needs[need] = clampNeed((actor.needs[need] ?? 0) + delta);
    }
  }
```

Dans `content/objects.ts` : ajouter `actorNeeds` aux trois affordances (`rest_nearby` : `effects: { actorNeeds: { warmth: 20, energy: 10 } }` ; `sleep_inside` : `effects: { actorNeeds: { energy: 60, warmth: 15 } }` ; `drink` : `effects: { actorNeeds: { stress: -5 } }`).

- [ ] **Step 4 : Vérifier** — `pnpm vitest run` (toute la suite : les tests étape 1 restent verts) + `pnpm typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src packages/simulation/test/affordances.test.ts packages/simulation/test/content-catalog.test.ts
git commit -m "feat(simulation): actorNeeds affordance effects; fire/shelter/river restore needs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : Actions intrinsèques + helpers d'inventaire

**Files:**
- Create: `packages/simulation/src/agents/intrinsics.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/intrinsics.test.ts`

**Interfaces:**
- Consumes: `compare` (world/affordances), `clampNeed` (Task 1).
- Produces:
  - `const INVENTORY_CAPACITY = 10`
  - `function invTotal(inv: Record<string, number>): number`
  - `interface IntrinsicActionDef { verb: string; durationTicks: number; preconditions?: { actorInventory?: Record<string, Comparison> }; effects: { actorInventory?: Record<string, number>; actorNeeds?: Record<string, number> } }`
  - `function defaultIntrinsics(): IntrinsicActionDef[]` — `eat_berries` (berries≥1, 20 ticks, berries −1, hunger +30), `eat_fish` (fish≥1, 30 ticks, fish −1, hunger +40), `nap` (200 ticks, energy +15)
  - `function checkIntrinsic(def: IntrinsicActionDef, inventory: Record<string, number>): { ok: true } | { ok: false; reason: string }`
  - `function applyIntrinsic(def: IntrinsicActionDef, inventory: Record<string, number>, needs: Record<string, number>): void`

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/intrinsics.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  defaultIntrinsics,
  checkIntrinsic,
  applyIntrinsic,
  invTotal,
  INVENTORY_CAPACITY,
} from '../src/agents/intrinsics';

describe('intrinsic actions', () => {
  it('declares eat_berries, eat_fish and nap', () => {
    expect(defaultIntrinsics().map((i) => i.verb).sort()).toEqual(['eat_berries', 'eat_fish', 'nap']);
  });

  it('eat_berries requires berries and restores hunger', () => {
    const eat = defaultIntrinsics().find((i) => i.verb === 'eat_berries')!;
    expect(checkIntrinsic(eat, {}).ok).toBe(false);
    const inv = { berries: 2 };
    expect(checkIntrinsic(eat, inv).ok).toBe(true);
    const needs = { hunger: 50 };
    applyIntrinsic(eat, inv, needs);
    expect(inv.berries).toBe(1);
    expect(needs.hunger).toBe(80);
  });

  it('applyIntrinsic clamps needs at 100', () => {
    const eat = defaultIntrinsics().find((i) => i.verb === 'eat_berries')!;
    const needs = { hunger: 90 };
    applyIntrinsic(eat, { berries: 1 }, needs);
    expect(needs.hunger).toBe(100);
  });

  it('invTotal sums items and capacity is 10', () => {
    expect(invTotal({ berries: 3, wood: 2 })).toBe(5);
    expect(INVENTORY_CAPACITY).toBe(10);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run intrinsics` → FAIL.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/agents/intrinsics.ts` :

```ts
import { compare } from '../world/affordances';
import type { Comparison } from '../world/SmartObject';
import { clampNeed } from './needs';

/**
 * Intrinsic actions are the agent's own repertoire — no smart object involved
 * (eating from inventory, napping). Same shape as affordances so Mode-1
 * scores both uniformly (spec §6.4, §7.1).
 */
export const INVENTORY_CAPACITY = 10;

export function invTotal(inv: Record<string, number>): number {
  return Object.values(inv).reduce((a, b) => a + b, 0);
}

export interface IntrinsicActionDef {
  verb: string;
  durationTicks: number;
  preconditions?: { actorInventory?: Record<string, Comparison> };
  effects: {
    actorInventory?: Record<string, number>;
    actorNeeds?: Record<string, number>;
  };
}

export function defaultIntrinsics(): IntrinsicActionDef[] {
  return [
    {
      verb: 'eat_berries',
      durationTicks: 20,
      preconditions: { actorInventory: { berries: '>=1' } },
      effects: { actorInventory: { berries: -1 }, actorNeeds: { hunger: 30 } },
    },
    {
      verb: 'eat_fish',
      durationTicks: 30,
      preconditions: { actorInventory: { fish: '>=1' } },
      effects: { actorInventory: { fish: -1 }, actorNeeds: { hunger: 40 } },
    },
    {
      verb: 'nap',
      durationTicks: 200,
      effects: { actorNeeds: { energy: 15 } },
    },
  ];
}

export function checkIntrinsic(
  def: IntrinsicActionDef,
  inventory: Record<string, number>
): { ok: true } | { ok: false; reason: string } {
  for (const [item, expr] of Object.entries(def.preconditions?.actorInventory ?? {})) {
    const count = inventory[item] ?? 0;
    if (!compare(count, expr)) {
      return { ok: false, reason: `actorInventory.${item} (${count}) fails ${expr}` };
    }
  }
  return { ok: true };
}

export function applyIntrinsic(
  def: IntrinsicActionDef,
  inventory: Record<string, number>,
  needs: Record<string, number>
): void {
  for (const [item, delta] of Object.entries(def.effects.actorInventory ?? {})) {
    inventory[item] = Math.max(0, (inventory[item] ?? 0) + delta);
  }
  for (const [need, delta] of Object.entries(def.effects.actorNeeds ?? {})) {
    needs[need] = clampNeed((needs[need] ?? 0) + delta);
  }
}
```

Ajouter dans `src/index.ts` :

```ts
export {
  defaultIntrinsics,
  checkIntrinsic,
  applyIntrinsic,
  invTotal,
  INVENTORY_CAPACITY,
  type IntrinsicActionDef,
} from './agents/intrinsics';
```

- [ ] **Step 4 : Vérifier** — `pnpm vitest run intrinsics` (4 passed), `pnpm typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/agents/intrinsics.ts packages/simulation/src/index.ts packages/simulation/test/intrinsics.test.ts
git commit -m "feat(simulation): intrinsic agent actions (eat, nap) and inventory helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : Perception locale

**Files:**
- Create: `packages/simulation/src/agents/Perception.ts`
- Modify: `packages/simulation/src/world/GroundTruthWorld.ts` (méthode `affordancesOf`)
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/perception.test.ts`

**Interfaces:**
- Consumes: `GroundTruthWorld` (+ nouvelle méthode `affordancesOf(type: string): AffordanceDef[]`), `hourOfDay`, `isNightHour` (Task 1).
- Produces:
  - `const DAY_VISION = 12`, `const NIGHT_VISION = 8`, `const HEARING_RADIUS = 20`
  - `interface PerceivedAgent { id: string; x: number; z: number; verb: string | null; distance: number }`
  - `interface ObservedObject { id: string; type: string; x: number; z: number; distance: number; state: Record<string, number>; verbs: string[] }`
  - `interface Observation { tick: number; hour: number; night: boolean; place: string | null; visionRadius: number; objects: ObservedObject[]; agents: PerceivedAgent[]; heard: PerceivedAgent[] }`
  - `function perceive(world: GroundTruthWorld, self: { id: string; x: number; z: number }, others: PerceivedAgent[], tick: number): Observation` — `others` contient TOUS les autres agents (position + verbe d'action en cours) ; `perceive` filtre par distance : visibles ≤ rayon de vue, entendus ≤ 20 m mais hors vue.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/perception.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { perceive, DAY_VISION, NIGHT_VISION, HEARING_RADIUS } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';

function makeWorld(): GroundTruthWorld {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return new GroundTruthWorld(reg);
}

const NOON_TICK = TICKS_PER_DAY / 2;      // hour 12
const MIDNIGHT_TICK = TICKS_PER_DAY;      // hour 0

describe('perceive', () => {
  it('sees nearby objects with their state and verbs, sorted by id', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 3, 0);       // 3 m away
    world.spawn('oak_tree', 40, 40);       // far away
    const obs = perceive(world, { id: 'a1', x: 0, z: 0 }, [], NOON_TICK);
    expect(obs.visionRadius).toBe(DAY_VISION);
    expect(obs.objects).toHaveLength(1);
    expect(obs.objects[0]?.type).toBe('berry_bush');
    expect(obs.objects[0]?.state.berriesLeft).toBe(12);
    expect(obs.objects[0]?.verbs).toEqual(['gather_berries']);
    expect(obs.objects[0]?.distance).toBeCloseTo(3);
  });

  it('shrinks vision at night', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 10, 0);      // visible by day (12), not by night (8)
    const day = perceive(world, { id: 'a1', x: 0, z: 0 }, [], NOON_TICK);
    const night = perceive(world, { id: 'a1', x: 0, z: 0 }, [], MIDNIGHT_TICK);
    expect(night.night).toBe(true);
    expect(night.visionRadius).toBe(NIGHT_VISION);
    expect(day.objects).toHaveLength(1);
    expect(night.objects).toHaveLength(0);
  });

  it('splits other agents into seen and heard', () => {
    const world = makeWorld();
    const others = [
      { id: 'close', x: 5, z: 0, verb: 'gather_wood', distance: 0 },
      { id: 'audible', x: 15, z: 0, verb: null, distance: 0 },
      { id: 'gone', x: 30, z: 0, verb: null, distance: 0 },
    ];
    const obs = perceive(world, { id: 'me', x: 0, z: 0 }, others, NOON_TICK);
    expect(obs.agents.map((a) => a.id)).toEqual(['close']);
    expect(obs.heard.map((a) => a.id)).toEqual(['audible']);
    expect(HEARING_RADIUS).toBe(20);
  });

  it('reports the named place the agent stands in', () => {
    const world = makeWorld();
    world.definePlace('camp_aube', 0, 0, 6);
    const obs = perceive(world, { id: 'me', x: 1, z: 1 }, [], NOON_TICK);
    expect(obs.place).toBe('camp_aube');
  });

  it('state in observations is a copy, not a live reference', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 1, 0);
    const obs = perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON_TICK);
    bush.state.berriesLeft = 0;
    expect(obs.objects[0]?.state.berriesLeft).toBe(12);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run perception` → FAIL.

- [ ] **Step 3 : Implémenter**

Dans `GroundTruthWorld.ts`, ajouter :

```ts
  /** Content-declared affordances for a type (perception & Mode-1 read defs here). */
  affordancesOf(type: string): AffordanceDef[] {
    return this.registry.get(type).affordances;
  }
```

`packages/simulation/src/agents/Perception.ts` :

```ts
import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import { hourOfDay } from '../kernel/SimKernel';
import { isNightHour } from './needs';

/**
 * Perception is the ONLY door between an agent and ground truth (spec §6.1).
 * Limited radii (shrunk at night), copies not references, no omniscience.
 */
export const DAY_VISION = 12;
export const NIGHT_VISION = 8;
export const HEARING_RADIUS = 20;

export interface PerceivedAgent {
  id: string;
  x: number;
  z: number;
  verb: string | null;
  distance: number;
}

export interface ObservedObject {
  id: string;
  type: string;
  x: number;
  z: number;
  distance: number;
  state: Record<string, number>;
  verbs: string[];
}

export interface Observation {
  tick: number;
  hour: number;
  night: boolean;
  place: string | null;
  visionRadius: number;
  objects: ObservedObject[];
  agents: PerceivedAgent[];
  heard: PerceivedAgent[];
}

export function perceive(
  world: GroundTruthWorld,
  self: { id: string; x: number; z: number },
  others: PerceivedAgent[],
  tick: number
): Observation {
  const hour = hourOfDay(tick);
  const night = isNightHour(hour);
  const visionRadius = night ? NIGHT_VISION : DAY_VISION;

  const objects: ObservedObject[] = world.objectsNear(self.x, self.z, visionRadius).map((o) => ({
    id: o.id,
    type: o.type,
    x: o.x,
    z: o.z,
    distance: Math.hypot(o.x - self.x, o.z - self.z),
    state: { ...o.state },
    verbs: world.affordancesOf(o.type).map((a) => a.verb),
  }));

  const agents: PerceivedAgent[] = [];
  const heard: PerceivedAgent[] = [];
  for (const other of others) {
    if (other.id === self.id) continue;
    const distance = Math.hypot(other.x - self.x, other.z - self.z);
    const entry = { ...other, distance };
    if (distance <= visionRadius) agents.push(entry);
    else if (distance <= HEARING_RADIUS) heard.push(entry);
  }
  agents.sort((a, b) => a.id.localeCompare(b.id));
  heard.sort((a, b) => a.id.localeCompare(b.id));

  return {
    tick,
    hour,
    night,
    place: world.placeAt(self.x, self.z),
    visionRadius,
    objects,
    agents,
    heard,
  };
}
```

Ajouter dans `src/index.ts` :

```ts
export {
  perceive,
  DAY_VISION,
  NIGHT_VISION,
  HEARING_RADIUS,
  type Observation,
  type ObservedObject,
  type PerceivedAgent,
} from './agents/Perception';
```

- [ ] **Step 4 : Vérifier** — `pnpm vitest run perception` (5 passed), `pnpm typecheck` (l'import `AffordanceDef` doit déjà exister dans GroundTruthWorld.ts — c'est le cas depuis l'étape 1).

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/agents/Perception.ts packages/simulation/src/world/GroundTruthWorld.ts packages/simulation/src/index.ts packages/simulation/test/perception.test.ts
git commit -m "feat(simulation): local perception with day/night radii, seen/heard split

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 : BeliefState — croyances datées et divergence

**Files:**
- Create: `packages/simulation/src/agents/BeliefState.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/belief-state.test.ts`

**Interfaces:**
- Consumes: `Observation` (Task 4), `GroundTruthWorld`.
- Produces:
  - `interface Belief { objectId: string; type: string; x: number; z: number; state: Record<string, number>; lastSeenTick: number }`
  - `class BeliefState { update(obs: Observation): void; known(): Belief[] (trié par objectId); byType(type: string): Belief[]; get(objectId: string): Belief | undefined; forget(objectId: string): void; divergenceFrom(world: GroundTruthWorld): number (0 = croyances exactes, 1 = tout faux); toJSON(): Belief[]; static fromJSON(beliefs: Belief[]): BeliefState }`

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/belief-state.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { BeliefState } from '../src/agents/BeliefState';
import { perceive } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';

const NOON = TICKS_PER_DAY / 2;

function makeWorld(): GroundTruthWorld {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return new GroundTruthWorld(reg);
}

describe('BeliefState', () => {
  it('learns objects from observations and dates them', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    const known = beliefs.known();
    expect(known).toHaveLength(1);
    expect(known[0]?.type).toBe('berry_bush');
    expect(known[0]?.lastSeenTick).toBe(NOON);
    expect(beliefs.byType('berry_bush')).toHaveLength(1);
  });

  it('beliefs go stale: the world changes, the belief does not', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    bush.state.berriesLeft = 0; // someone else empties the bush
    expect(beliefs.get(bush.id)?.state.berriesLeft).toBe(12); // still believed full
  });

  it('re-observation refreshes the belief', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    bush.state.berriesLeft = 4;
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON + 100));
    expect(beliefs.get(bush.id)?.state.berriesLeft).toBe(4);
    expect(beliefs.get(bush.id)?.lastSeenTick).toBe(NOON + 100);
  });

  it('divergenceFrom measures belief accuracy (spec §6.2)', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    expect(beliefs.divergenceFrom(world)).toBe(0); // fresh = exact
    bush.state.berriesLeft = 0;                    // 1 field of 1 now wrong
    expect(beliefs.divergenceFrom(world)).toBe(1);
    expect(new BeliefState().divergenceFrom(world)).toBe(0); // no beliefs, no error
  });

  it('forget removes a belief (used when an expected object is gone)', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    beliefs.forget(bush.id);
    expect(beliefs.known()).toHaveLength(0);
  });

  it('JSON round-trips', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 2, 0);
    const beliefs = new BeliefState();
    beliefs.update(perceive(world, { id: 'me', x: 0, z: 0 }, [], NOON));
    const restored = BeliefState.fromJSON(JSON.parse(JSON.stringify(beliefs.toJSON())));
    expect(restored.known()).toEqual(beliefs.known());
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run belief-state` → FAIL.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/agents/BeliefState.ts` :

```ts
import type { Observation } from './Perception';
import type { GroundTruthWorld } from '../world/GroundTruthWorld';

/**
 * The agent's short-term world model in LeCun's sense (spec §5, §6.2):
 * dated, fallible beliefs built only from perception. Divergence from ground
 * truth is a measurable engine metric — impossible in the real world, free
 * in simulation.
 */
export interface Belief {
  objectId: string;
  type: string;
  x: number;
  z: number;
  state: Record<string, number>;
  lastSeenTick: number;
}

export class BeliefState {
  private beliefs = new Map<string, Belief>();

  update(obs: Observation): void {
    for (const o of obs.objects) {
      this.beliefs.set(o.id, {
        objectId: o.id,
        type: o.type,
        x: o.x,
        z: o.z,
        state: { ...o.state },
        lastSeenTick: obs.tick,
      });
    }
  }

  known(): Belief[] {
    return [...this.beliefs.values()].sort((a, b) => a.objectId.localeCompare(b.objectId));
  }

  byType(type: string): Belief[] {
    return this.known().filter((b) => b.type === type);
  }

  get(objectId: string): Belief | undefined {
    return this.beliefs.get(objectId);
  }

  forget(objectId: string): void {
    this.beliefs.delete(objectId);
  }

  /** Fraction of believed state fields that disagree with ground truth. */
  divergenceFrom(world: GroundTruthWorld): number {
    let fields = 0;
    let wrong = 0;
    for (const belief of this.beliefs.values()) {
      const real = world.get(belief.objectId);
      const entries = Object.entries(belief.state);
      if (real === undefined) {
        fields += Math.max(1, entries.length);
        wrong += Math.max(1, entries.length);
        continue;
      }
      for (const [field, value] of entries) {
        fields++;
        if ((real.state[field] ?? 0) !== value) wrong++;
      }
    }
    return fields === 0 ? 0 : wrong / fields;
  }

  toJSON(): Belief[] {
    return this.known().map((b) => ({ ...b, state: { ...b.state } }));
  }

  static fromJSON(beliefs: Belief[]): BeliefState {
    const bs = new BeliefState();
    for (const b of beliefs) bs.beliefs.set(b.objectId, { ...b, state: { ...b.state } });
    return bs;
  }
}
```

Ajouter dans `src/index.ts` :

```ts
export { BeliefState, type Belief } from './agents/BeliefState';
```

- [ ] **Step 4 : Vérifier** — `pnpm vitest run belief-state` (6 passed), `pnpm typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/agents/BeliefState.ts packages/simulation/src/index.ts packages/simulation/test/belief-state.test.ts
git commit -m "feat(simulation): dated belief state with ground-truth divergence metric

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6 : Navigation

**Files:**
- Create: `packages/simulation/src/agents/navigation.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/navigation.test.ts`

**Interfaces:**
- Consumes: `isRiverAt`, `WORLD_SIZE` (world/terrain).
- Produces:
  - `const WALK_SPEED = 1.4` (m/s), `const ARRIVE_RADIUS = 0.3`
  - `function stepToward(pos: { x: number; z: number }, target: { x: number; z: number }, dtSeconds?: number): boolean` — mute `pos` d'un pas (vitesse ÷ 2 dans la rivière — gué), borne aux ±WORLD_SIZE/2, renvoie `true` si arrivé (≤ 0.3 m).

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/navigation.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { stepToward, WALK_SPEED, ARRIVE_RADIUS } from '../src/agents/navigation';

describe('stepToward', () => {
  it('moves at walk speed toward the target and arrives', () => {
    const pos = { x: -10, z: -10 };            // plateau area, far from river
    const target = { x: -10, z: -8 };          // 2 m away
    let steps = 0;
    while (!stepToward(pos, target) && steps < 300) steps++;
    // 2 m at 1.4 m/s with 0.1 s ticks ≈ 15 ticks.
    expect(steps).toBeGreaterThan(5);
    expect(steps).toBeLessThan(30);
    expect(Math.hypot(pos.x - target.x, pos.z - target.z)).toBeLessThanOrEqual(ARRIVE_RADIUS);
  });

  it('is immediately arrived when already close', () => {
    const pos = { x: 0, z: 0 };
    expect(stepToward(pos, { x: 0.1, z: 0 })).toBe(true);
  });

  it('wades slower through the river', () => {
    // River center at z=0 is x=4. Start in the riverbed.
    const inRiver = { x: 4, z: 0 };
    const onLand = { x: -10, z: -10 };
    stepToward(inRiver, { x: 4, z: 10 });
    stepToward(onLand, { x: -10, z: 0 });
    const riverStep = Math.abs(inRiver.z - 0);
    const landStep = Math.abs(onLand.z - -10);
    expect(riverStep).toBeCloseTo(landStep / 2, 5);
    expect(WALK_SPEED).toBe(1.4);
  });

  it('clamps to world bounds', () => {
    const pos = { x: 31.9, z: -15 };           // heading out of the 64 m map
    for (let i = 0; i < 100; i++) stepToward(pos, { x: 50, z: -15 });
    expect(pos.x).toBeLessThanOrEqual(32);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run navigation` → FAIL.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/agents/navigation.ts` :

```ts
import { isRiverAt, WORLD_SIZE } from '../world/terrain';

/**
 * Step-based navigation on the analytic terrain (spec §6.4). Straight-line
 * steps at walk speed, half speed wading through the river, clamped to the
 * map. One call per 100 ms tick.
 */
export const WALK_SPEED = 1.4; // m/s
export const ARRIVE_RADIUS = 0.3;

const HALF_WORLD = WORLD_SIZE / 2;

export function stepToward(
  pos: { x: number; z: number },
  target: { x: number; z: number },
  dtSeconds = 0.1
): boolean {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= ARRIVE_RADIUS) return true;

  const speed = isRiverAt(pos.x, pos.z) ? WALK_SPEED / 2 : WALK_SPEED;
  const step = Math.min(dist, speed * dtSeconds);
  pos.x += (dx / dist) * step;
  pos.z += (dz / dist) * step;
  pos.x = Math.min(HALF_WORLD, Math.max(-HALF_WORLD, pos.x));
  pos.z = Math.min(HALF_WORLD, Math.max(-HALF_WORLD, pos.z));
  return Math.hypot(target.x - pos.x, target.z - pos.z) <= ARRIVE_RADIUS;
}
```

Ajouter dans `src/index.ts` :

```ts
export { stepToward, WALK_SPEED, ARRIVE_RADIUS } from './agents/navigation';
```

- [ ] **Step 4 : Vérifier** — `pnpm vitest run navigation` (4 passed), `pnpm typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/agents/navigation.ts packages/simulation/src/index.ts packages/simulation/test/navigation.test.ts
git commit -m "feat(simulation): step-based navigation with river wading and world bounds

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7 : AgentState + exécuteur d'actions

**Files:**
- Create: `packages/simulation/src/agents/AgentState.ts`
- Create: `packages/simulation/src/agents/actions.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/agent-actions.test.ts`

**Interfaces:**
- Consumes: `AgentNeeds`/`createDefaultNeeds` (T1), `BeliefState` (T5), `stepToward` (T6), `checkAffordance`/`applyAffordance` (world), `checkIntrinsic`/`applyIntrinsic`/`IntrinsicActionDef` (T3), `GroundTruthWorld`.
- Produces (AgentState.ts) :
  - `interface AgentProfile { id: string; name: string; tribe: string; role: string }`
  - `type CurrentAction = { kind: 'world'; objectId: string; verb: string; phase: 'goto' | 'perform'; targetX: number; targetZ: number; remainingTicks: number } | { kind: 'intrinsic'; verb: string; remainingTicks: number }`
  - `interface AgentState { profile: AgentProfile; x: number; z: number; heading: number; needs: AgentNeeds; inventory: Record<string, number>; beliefs: BeliefState; currentAction: CurrentAction | null; sleeping: boolean }`
  - `function createAgent(profile: AgentProfile, x: number, z: number): AgentState`
- Produces (actions.ts) :
  - `interface ActionEvent { tick: number; agentId: string; type: 'started' | 'completed' | 'failed'; verb: string; reason?: string }`
  - `function executeActionTick(agent: AgentState, world: GroundTruthWorld, intrinsics: IntrinsicActionDef[], tick: number): ActionEvent | null` — fait avancer d'un tick l'action courante ; `null` si rien à signaler. Sémantique : phase `goto` → `stepToward` la cible crue (met à jour `heading`) ; à l'arrivée, si l'objet réel n'existe plus → `failed` + `beliefs.forget` + action effacée (surprise) ; sinon phase `perform` avec `remainingTicks = durationTicks`. Phase `perform` → décrément ; à 0, re-`checkAffordance` sur le monde réel avec `{x, z, inventory, needs}` : ok → `applyAffordance` + `completed` ; sinon `failed(reason)`. Intrinsèque : décrément puis `checkIntrinsic`/`applyIntrinsic`. `sleeping` = vrai pendant `perform` de `sleep_inside`/`nap`/`rest_nearby`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/agent-actions.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { createAgent, type CurrentAction } from '../src/agents/AgentState';
import { executeActionTick } from '../src/agents/actions';
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
  const agent = createAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'Cueilleuse' }, 0, 0);
  return { world, agent };
}

function worldAction(objectId: string, verb: string, x: number, z: number): CurrentAction {
  return { kind: 'world', objectId, verb, phase: 'goto', targetX: x, targetZ: z, remainingTicks: 0 };
}

describe('executeActionTick — world actions', () => {
  it('walks to a bush, gathers, and completes with loot', () => {
    const { world, agent } = setup();
    const bush = world.spawn('berry_bush', 3, 0);
    agent.beliefs.update(perceive(world, { id: 'mira', x: 0, z: 0 }, [], NOON));
    agent.currentAction = worldAction(bush.id, 'gather_berries', bush.x, bush.z);

    let completed = false;
    for (let t = 0; t < 300 && !completed; t++) {
      const ev = executeActionTick(agent, world, INTRINSICS, NOON + t);
      if (ev?.type === 'completed') completed = true;
      expect(ev?.type).not.toBe('failed');
    }
    expect(completed).toBe(true);
    expect(agent.inventory.berries).toBe(2);
    expect(bush.state.berriesLeft).toBe(10);
    expect(agent.currentAction).toBeNull();
    expect(Math.hypot(agent.x - bush.x, agent.z - bush.z)).toBeLessThan(1.5);
  });

  it('fails with surprise when the believed object is empty in reality', () => {
    const { world, agent } = setup();
    const bush = world.spawn('berry_bush', 2, 0);
    agent.beliefs.update(perceive(world, { id: 'mira', x: 0, z: 0 }, [], NOON));
    bush.state.berriesLeft = 0; // emptied behind the agent's back
    agent.currentAction = worldAction(bush.id, 'gather_berries', bush.x, bush.z);

    let failed: string | undefined;
    for (let t = 0; t < 300 && failed === undefined; t++) {
      const ev = executeActionTick(agent, world, INTRINSICS, NOON + t);
      if (ev?.type === 'failed') failed = ev.reason;
    }
    expect(failed).toContain('berriesLeft');
    expect(agent.currentAction).toBeNull();
  });

  it('sleeping is set during rest/sleep performs', () => {
    const { world, agent } = setup();
    const fire = world.spawn('campfire', 0.5, 0);
    fire.state.lit = 1;
    agent.currentAction = worldAction(fire.id, 'rest_nearby', fire.x, fire.z);
    executeActionTick(agent, world, INTRINSICS, NOON);      // arrive -> perform
    executeActionTick(agent, world, INTRINSICS, NOON + 1);  // performing
    expect(agent.sleeping).toBe(true);
  });
});

describe('executeActionTick — intrinsic actions', () => {
  it('eats berries from inventory and restores hunger', () => {
    const { world, agent } = setup();
    agent.inventory.berries = 1;
    agent.needs.hunger = 40;
    agent.currentAction = { kind: 'intrinsic', verb: 'eat_berries', remainingTicks: 20 };
    let completed = false;
    for (let t = 0; t < 25 && !completed; t++) {
      if (executeActionTick(agent, world, INTRINSICS, NOON + t)?.type === 'completed') completed = true;
    }
    expect(completed).toBe(true);
    expect(agent.inventory.berries).toBe(0);
    expect(agent.needs.hunger).toBe(70);
    expect(agent.sleeping).toBe(false);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run agent-actions` → FAIL.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/agents/AgentState.ts` :

```ts
import { createDefaultNeeds, type AgentNeeds } from './needs';
import { BeliefState } from './BeliefState';

export interface AgentProfile {
  id: string;
  name: string;
  tribe: string;
  role: string;
}

export type CurrentAction =
  | {
      kind: 'world';
      objectId: string;
      verb: string;
      phase: 'goto' | 'perform';
      targetX: number;
      targetZ: number;
      remainingTicks: number;
    }
  | { kind: 'intrinsic'; verb: string; remainingTicks: number };

export interface AgentState {
  profile: AgentProfile;
  x: number;
  z: number;
  heading: number;
  needs: AgentNeeds;
  inventory: Record<string, number>;
  beliefs: BeliefState;
  currentAction: CurrentAction | null;
  sleeping: boolean;
}

export function createAgent(profile: AgentProfile, x: number, z: number): AgentState {
  return {
    profile,
    x,
    z,
    heading: 0,
    needs: createDefaultNeeds(),
    inventory: {},
    beliefs: new BeliefState(),
    currentAction: null,
    sleeping: false,
  };
}
```

`packages/simulation/src/agents/actions.ts` :

```ts
import type { AgentState } from './AgentState';
import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import { checkAffordance, applyAffordance } from '../world/affordances';
import { checkIntrinsic, applyIntrinsic, type IntrinsicActionDef } from './intrinsics';
import { stepToward } from './navigation';

export interface ActionEvent {
  tick: number;
  agentId: string;
  type: 'started' | 'completed' | 'failed';
  verb: string;
  reason?: string;
}

const RESTFUL_VERBS = new Set(['rest_nearby', 'sleep_inside', 'nap']);

/**
 * Advances the agent's current action by one tick (spec §6.4). Plans are made
 * on beliefs; execution confronts ground truth — a mismatch is a surprise:
 * the action fails and the stale belief is dropped.
 */
export function executeActionTick(
  agent: AgentState,
  world: GroundTruthWorld,
  intrinsics: IntrinsicActionDef[],
  tick: number
): ActionEvent | null {
  const action = agent.currentAction;
  agent.sleeping = false;
  if (action === null) return null;
  const agentId = agent.profile.id;

  if (action.kind === 'intrinsic') {
    agent.sleeping = RESTFUL_VERBS.has(action.verb);
    action.remainingTicks--;
    if (action.remainingTicks > 0) return null;
    agent.currentAction = null;
    const def = intrinsics.find((i) => i.verb === action.verb);
    if (def === undefined) {
      return { tick, agentId, type: 'failed', verb: action.verb, reason: 'unknown intrinsic' };
    }
    const check = checkIntrinsic(def, agent.inventory);
    if (!check.ok) {
      return { tick, agentId, type: 'failed', verb: action.verb, reason: check.reason };
    }
    applyIntrinsic(def, agent.inventory, agent.needs as unknown as Record<string, number>);
    agent.sleeping = false;
    return { tick, agentId, type: 'completed', verb: action.verb };
  }

  if (action.phase === 'goto') {
    const before = { x: agent.x, z: agent.z };
    const arrived = stepToward(agent, { x: action.targetX, z: action.targetZ });
    if (agent.x !== before.x || agent.z !== before.z) {
      agent.heading = Math.atan2(agent.x - before.x, agent.z - before.z);
    }
    if (!arrived) return null;
    const real = world.get(action.objectId);
    if (real === undefined) {
      agent.beliefs.forget(action.objectId);
      agent.currentAction = null;
      return { tick, agentId, type: 'failed', verb: action.verb, reason: 'object gone' };
    }
    const def = world.affordancesOf(real.type).find((a) => a.verb === action.verb);
    if (def === undefined) {
      agent.currentAction = null;
      return { tick, agentId, type: 'failed', verb: action.verb, reason: 'unknown affordance' };
    }
    action.phase = 'perform';
    action.remainingTicks = def.durationTicks;
    agent.sleeping = RESTFUL_VERBS.has(action.verb);
    return null;
  }

  // phase === 'perform'
  agent.sleeping = RESTFUL_VERBS.has(action.verb);
  action.remainingTicks--;
  if (action.remainingTicks > 0) return null;
  agent.currentAction = null;
  agent.sleeping = false;
  const real = world.get(action.objectId);
  if (real === undefined) {
    agent.beliefs.forget(action.objectId);
    return { tick, agentId, type: 'failed', verb: action.verb, reason: 'object gone' };
  }
  const def = world.affordancesOf(real.type).find((a) => a.verb === action.verb);
  if (def === undefined) {
    return { tick, agentId, type: 'failed', verb: action.verb, reason: 'unknown affordance' };
  }
  const actor = {
    x: agent.x,
    z: agent.z,
    inventory: agent.inventory,
    needs: agent.needs as unknown as Record<string, number>,
  };
  const check = checkAffordance(def, real, actor);
  if (!check.ok) {
    // Reality disagreed with the plan: drop the stale belief (surprise).
    agent.beliefs.forget(action.objectId);
    return { tick, agentId, type: 'failed', verb: action.verb, reason: check.reason };
  }
  applyAffordance(def, real, actor);
  return { tick, agentId, type: 'completed', verb: action.verb };
}
```

Ajouter dans `src/index.ts` :

```ts
export {
  createAgent,
  type AgentProfile,
  type AgentState,
  type CurrentAction,
} from './agents/AgentState';
export { executeActionTick, type ActionEvent } from './agents/actions';
```

- [ ] **Step 4 : Vérifier** — `pnpm vitest run agent-actions` (5 passed), `pnpm typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/agents/AgentState.ts packages/simulation/src/agents/actions.ts packages/simulation/src/index.ts packages/simulation/test/agent-actions.test.ts
git commit -m "feat(simulation): agent state and spatial action executor with belief surprises

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8 : Mode-1 — politique utility avec chaînage fournisseur

**Files:**
- Create: `packages/simulation/src/agents/Mode1.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/mode1.test.ts`

**Interfaces:**
- Consumes: `AgentState`/`CurrentAction` (T7), `Belief`/`BeliefState` (T5), `urgency`/`AgentNeeds` (T1), `IntrinsicActionDef`/`checkIntrinsic` (T3), `compare` (world), `SmartObjectRegistry`, `WALK_SPEED` (T6).
- Produces: `function selectAction(agent: AgentState, registry: SmartObjectRegistry, intrinsics: IntrinsicActionDef[]): CurrentAction | null` — score chaque candidat (intrinsèques + affordances *crues*) par `gain de besoins / (1 + (trajet + durée)/100)` ; un candidat bloqué est remplacé par son **fournisseur** (profondeur ≤ 3, amortissement ×0.7 par niveau) : précondition d'inventaire manquante → affordance/intrinsèque crue qui produit l'objet ; précondition `objectState` insuffisante → affordance du même objet qui augmente le champ. Renvoie `null` si aucun score > 0.001. Départage déterministe : score décroissant puis clé `verb|objectId` croissante.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/mode1.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { selectAction } from '../src/agents/Mode1';
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
  const agent = createAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, 0, 0);
  const see = () => agent.beliefs.update(perceive(world, { id: 'a', x: agent.x, z: agent.z }, [], NOON));
  return { reg, world, agent, see };
}

describe('selectAction', () => {
  it('hungry with berries in inventory -> eat them (intrinsic beats travel)', () => {
    const { reg, world, agent, see } = setup();
    world.spawn('berry_bush', 8, 0);
    see();
    agent.needs.hunger = 20;
    agent.inventory.berries = 2;
    const action = selectAction(agent, reg, INTRINSICS);
    expect(action).toEqual({ kind: 'intrinsic', verb: 'eat_berries', remainingTicks: 20 });
  });

  it('hungry without food -> go gather the believed bush (provider chain)', () => {
    const { reg, world, agent, see } = setup();
    const bush = world.spawn('berry_bush', 8, 0);
    see();
    agent.needs.hunger = 20;
    const action = selectAction(agent, reg, INTRINSICS);
    expect(action).toMatchObject({ kind: 'world', objectId: bush.id, verb: 'gather_berries' });
  });

  it('cold at an unlit fire with empty hands -> gather wood or flint (depth-3 chain)', () => {
    const { reg, world, agent, see } = setup();
    world.spawn('campfire', 1, 0);          // lit=0: rest_nearby blocked
    world.spawn('oak_tree', 5, 0);
    world.spawn('flint_deposit', 6, 0);
    see();
    agent.needs.warmth = 10;
    agent.needs.hunger = 90;                // hunger not urgent
    const action = selectAction(agent, reg, INTRINSICS);
    expect(action?.kind).toBe('world');
    if (action?.kind === 'world') {
      expect(['gather_wood', 'gather_flint']).toContain(action.verb);
    }
  });

  it('cold with wood and flint at an unlit fire -> light it', () => {
    const { reg, world, agent, see } = setup();
    const fire = world.spawn('campfire', 1, 0);
    see();
    agent.needs.warmth = 10;
    agent.needs.hunger = 90;
    agent.inventory.wood = 2;
    agent.inventory.flint = 1;
    const action = selectAction(agent, reg, INTRINSICS);
    expect(action).toMatchObject({ kind: 'world', objectId: fire.id, verb: 'light_fire' });
  });

  it('fully satisfied -> no action (idle)', () => {
    const { reg, world, agent, see } = setup();
    world.spawn('berry_bush', 3, 0);
    see();
    agent.needs = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    expect(selectAction(agent, reg, INTRINSICS)).toBeNull();
  });

  it('is deterministic on ties', () => {
    const { reg, world, agent, see } = setup();
    world.spawn('berry_bush', 4, 0);
    world.spawn('berry_bush', -4, 0);       // symmetric alternatives
    see();
    agent.needs.hunger = 20;
    const first = selectAction(agent, reg, INTRINSICS);
    for (let i = 0; i < 5; i++) {
      expect(selectAction(agent, reg, INTRINSICS)).toEqual(first);
    }
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run mode1` → FAIL.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/agents/Mode1.ts` :

```ts
import type { AgentState, CurrentAction } from './AgentState';
import type { Belief } from './BeliefState';
import { urgency, type AgentNeeds, type NeedId } from './needs';
import { checkIntrinsic, type IntrinsicActionDef } from './intrinsics';
import { compare } from '../world/affordances';
import type { AffordanceDef, SmartObjectRegistry } from '../world/SmartObject';
import { WALK_SPEED } from './navigation';

/**
 * Mode-1 reactive policy (spec §7.1): utility scoring over BELIEVED
 * affordances + intrinsic actions. A blocked candidate is replaced by its
 * provider (missing inventory item -> gathering affordance that yields it;
 * insufficient object state -> affordance on the same object raising it),
 * damped 0.7 per level, depth <= 3 — enough to chain
 * cold -> rest_nearby -> light_fire -> gather_wood without any LLM.
 */
const DAMPING = 0.7;
const MAX_DEPTH = 3;
const MIN_SCORE = 0.001;
const TICKS_PER_METER = 1 / (WALK_SPEED * 0.1);

interface Candidate {
  action: CurrentAction;
  score: number;
  key: string;
}

function needGain(effects: Record<string, number> | undefined, needs: AgentNeeds): number {
  if (effects === undefined) return 0;
  let gain = 0;
  for (const [need, delta] of Object.entries(effects)) {
    const id = need as NeedId;
    if (!(id in needs)) continue;
    const u = urgency(needs, id);
    if (id === 'stress') {
      if (delta < 0) gain += (-delta / 100) * u;
    } else if (delta > 0) {
      gain += (delta / 100) * u;
    }
  }
  return gain;
}

function timePenalty(travelTicks: number, durationTicks: number): number {
  return 1 + (travelTicks + durationTicks) / 100;
}

export function selectAction(
  agent: AgentState,
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[]
): CurrentAction | null {
  const beliefs = agent.beliefs.known();
  const candidates: Candidate[] = [];

  for (const def of intrinsics) {
    scoreIntrinsic(def, agent, beliefs, registry, intrinsics, 0, new Set(), candidates);
  }
  for (const belief of beliefs) {
    for (const def of affordancesFor(registry, belief.type)) {
      scoreWorld(def, belief, agent, beliefs, registry, intrinsics, 0, new Set(), candidates);
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const best = candidates[0];
  return best !== undefined && best.score > MIN_SCORE ? best.action : null;
}

function affordancesFor(registry: SmartObjectRegistry, type: string): AffordanceDef[] {
  return registry.has(type) ? registry.get(type).affordances : [];
}

function scoreIntrinsic(
  def: IntrinsicActionDef,
  agent: AgentState,
  beliefs: Belief[],
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[],
  depth: number,
  visited: Set<string>,
  out: Candidate[]
): void {
  const key = `intrinsic|${def.verb}`;
  if (visited.has(key) || depth > MAX_DEPTH) return;
  visited.add(key);

  const gain = needGain(def.effects.actorNeeds, agent.needs) * DAMPING ** depth;
  if (gain <= 0) return;
  const score = gain / timePenalty(0, def.durationTicks);

  const check = checkIntrinsic(def, agent.inventory);
  if (check.ok) {
    out.push({
      action: { kind: 'intrinsic', verb: def.verb, remainingTicks: def.durationTicks },
      score,
      key,
    });
    return;
  }
  // Blocked on inventory: chain to providers of the missing items.
  chainInventoryProviders(def.preconditions?.actorInventory, score, agent, beliefs, registry, intrinsics, depth, visited, out);
}

function scoreWorld(
  def: AffordanceDef,
  belief: Belief,
  agent: AgentState,
  beliefs: Belief[],
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[],
  depth: number,
  visited: Set<string>,
  out: Candidate[],
  inheritedGain = 0
): void {
  const key = `world|${def.verb}|${belief.objectId}`;
  if (visited.has(key) || depth > MAX_DEPTH) return;
  visited.add(key);

  const ownGain = needGain(def.effects.actorNeeds, agent.needs);
  const gain = (ownGain + inheritedGain) * DAMPING ** depth;
  if (gain <= 0) return;
  const travel = Math.hypot(belief.x - agent.x, belief.z - agent.z) * TICKS_PER_METER;
  const score = gain / timePenalty(travel, def.durationTicks);

  // Object-state preconditions checked against BELIEFS.
  for (const [field, expr] of Object.entries(def.preconditions?.objectState ?? {})) {
    if (!compare(belief.state[field] ?? 0, expr)) {
      // Blocked: chain to an affordance on the same object that raises the field.
      for (const other of affordancesFor(registry, belief.type)) {
        if (other.verb !== def.verb && (other.effects.object?.[field] ?? 0) > 0) {
          scoreWorld(other, belief, agent, beliefs, registry, intrinsics, depth + 1, visited, out, gain);
        }
      }
      return;
    }
  }

  // Inventory preconditions checked against the REAL inventory.
  for (const [item, expr] of Object.entries(def.preconditions?.actorInventory ?? {})) {
    if (!compare(agent.inventory[item] ?? 0, expr)) {
      chainInventoryProviders({ [item]: expr }, score, agent, beliefs, registry, intrinsics, depth, visited, out);
      return;
    }
  }

  out.push({
    action: {
      kind: 'world',
      objectId: belief.objectId,
      verb: def.verb,
      phase: 'goto',
      targetX: belief.x,
      targetZ: belief.z,
      remainingTicks: 0,
    },
    score,
    key,
  });
}

function chainInventoryProviders(
  missing: Record<string, string> | undefined,
  blockedScore: number,
  agent: AgentState,
  beliefs: Belief[],
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[],
  depth: number,
  visited: Set<string>,
  out: Candidate[]
): void {
  if (missing === undefined) return;
  for (const [item, expr] of Object.entries(missing)) {
    if (compare(agent.inventory[item] ?? 0, expr)) continue;
    for (const belief of beliefs) {
      for (const provider of affordancesFor(registry, belief.type)) {
        if ((provider.effects.actorInventory?.[item] ?? 0) > 0) {
          // The provider inherits the blocked candidate's motivation.
          const key = `world|${provider.verb}|${belief.objectId}`;
          if (visited.has(key) || depth + 1 > MAX_DEPTH) continue;
          visited.add(key);
          let ok = true;
          for (const [field, fieldExpr] of Object.entries(provider.preconditions?.objectState ?? {})) {
            if (!compare(belief.state[field] ?? 0, fieldExpr)) ok = false;
          }
          for (const [invItem, invExpr] of Object.entries(provider.preconditions?.actorInventory ?? {})) {
            if (!compare(agent.inventory[invItem] ?? 0, invExpr)) ok = false;
          }
          if (!ok) continue;
          const travel = Math.hypot(belief.x - agent.x, belief.z - agent.z) * TICKS_PER_METER;
          out.push({
            action: {
              kind: 'world',
              objectId: belief.objectId,
              verb: provider.verb,
              phase: 'goto',
              targetX: belief.x,
              targetZ: belief.z,
              remainingTicks: 0,
            },
            score: (blockedScore * DAMPING) / timePenalty(travel, provider.durationTicks),
            key,
          });
        }
      }
    }
  }
}
```

Ajouter dans `src/index.ts` :

```ts
export { selectAction } from './agents/Mode1';
```

- [ ] **Step 4 : Vérifier** — `pnpm vitest run mode1` (6 passed), `pnpm typecheck`. Si le test 3 (chaîne profondeur 3) échoue sur le choix (`null` ou mauvais verbe), déboguer en loggant les candidats — la chaîne attendue est `rest_nearby` (bloqué `lit==0`) → `light_fire` (élève `lit`, bloqué inventaire) → `gather_wood`/`gather_flint` (fournisseurs) ; vérifier que `visited` ne coupe pas la branche avant les fournisseurs.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/agents/Mode1.ts packages/simulation/src/index.ts packages/simulation/test/mode1.test.ts
git commit -m "feat(simulation): mode-1 utility policy with depth-limited provider chaining

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9 : AgentRuntime — orchestration et restitution

**Files:**
- Create: `packages/simulation/src/agents/AgentRuntime.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/agent-runtime.test.ts`

**Interfaces:**
- Consumes: tout T1–T8, `SimKernel`/`TickContext`, `GroundTruthWorld`, `getTerrainHeight`.
- Produces:
  - `interface AgentView { id: string; name: string; x: number; y: number; z: number; heading: number; animation: 'idle' | 'walk' | 'gather' | 'craft' | 'rest' | 'sleep'; verb: string | null }`
  - `class AgentRuntime { constructor(world: GroundTruthWorld, registry: SmartObjectRegistry, intrinsics?: IntrinsicActionDef[]); readonly agents: Map<string, AgentState>; addAgent(profile: AgentProfile, x: number, z: number): AgentState; attachTo(kernel: SimKernel): () => void; view(id: string): AgentView | undefined; views(): AgentView[]; drainEvents(): ActionEvent[] }`
  - Ordre par tick et par agent (**ids triés**) : (1) contexte de besoins (`isMoving` = phase goto, `nearLitFire` = feu allumé ≤ 3 m via `world.objectsNear`, `isSleeping`) et `decayNeeds` ; (2) perception + mise à jour des croyances si `tick % 10 === 0` ; (3) `executeActionTick` (événements accumulés) ; (4) si aucune action → `selectAction`, événement `started` si une action démarre.
  - Restitution (spec §6.5) : `y = getTerrainHeight(x, z)` ; animation : goto → `walk` ; perform `gather_*`/`fish`/`eat_*` → `gather` ; `light_fire`/`add_wood`/`build`/`knap_flint`/`deposit_*`/`take_*` → `craft` ; `rest_nearby` → `rest` ; `sleep_inside`/`nap` → `sleep` ; sinon `idle`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/agent-runtime.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { AgentRuntime } from '../src/agents/AgentRuntime';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { SimKernel } from '../src/kernel/SimKernel';
import { getTerrainHeight } from '../src/world/terrain';

function setup() {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  const world = new GroundTruthWorld(reg);
  const runtime = new AgentRuntime(world, reg);
  const kernel = new SimKernel({ seed: 3 });
  world.attachTo(kernel);
  runtime.attachTo(kernel);
  return { reg, world, runtime, kernel };
}

describe('AgentRuntime', () => {
  it('a hungry agent autonomously walks to a bush, gathers and eats', () => {
    const { world, runtime, kernel } = setup();
    world.spawn('berry_bush', 5, 0);
    const agent = runtime.addAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'C' }, 0, 0);
    agent.needs.hunger = 15;

    for (let t = 0; t < 600; t++) kernel.step(); // 60 s simulées
    const events = runtime.drainEvents();
    const completed = events.filter((e) => e.type === 'completed').map((e) => e.verb);
    expect(completed).toContain('gather_berries');
    expect(completed).toContain('eat_berries');
    expect(agent.needs.hunger).toBeGreaterThan(15);
  });

  it('needs decay over time when idle', () => {
    const { runtime, kernel } = setup();
    const agent = runtime.addAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, -10, -10);
    const initialHunger = agent.needs.hunger;
    for (let t = 0; t < 100; t++) kernel.step();
    expect(agent.needs.hunger).toBeLessThan(initialHunger);
  });

  it('views project terrain height and semantic animation', () => {
    const { world, runtime, kernel } = setup();
    world.spawn('berry_bush', 5, 0);
    const agent = runtime.addAgent({ id: 'a', name: 'A', tribe: 'T', role: 'R' }, 0, 0);
    agent.needs.hunger = 15;
    for (let t = 0; t < 15; t++) kernel.step(); // perception au tick 10, puis départ
    const view = runtime.view('a')!;
    expect(view.y).toBe(getTerrainHeight(view.x, view.z));
    expect(view.animation).toBe('walk');
    expect(runtime.views()).toHaveLength(1);
  });

  it('agents are processed in sorted id order (determinism)', () => {
    const { runtime } = setup();
    runtime.addAgent({ id: 'zoe', name: 'Z', tribe: 'T', role: 'R' }, 0, 0);
    runtime.addAgent({ id: 'ana', name: 'A', tribe: 'T', role: 'R' }, 1, 0);
    expect(runtime.views().map((v) => v.id)).toEqual(['ana', 'zoe']);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run agent-runtime` → FAIL.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/agents/AgentRuntime.ts` :

```ts
import { SimKernel, type TickContext } from '../kernel/SimKernel';
import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import type { SmartObjectRegistry } from '../world/SmartObject';
import { getTerrainHeight } from '../world/terrain';
import { createAgent, type AgentProfile, type AgentState } from './AgentState';
import { decayNeeds } from './needs';
import { perceive, type PerceivedAgent } from './Perception';
import { executeActionTick, type ActionEvent } from './actions';
import { selectAction } from './Mode1';
import { defaultIntrinsics, type IntrinsicActionDef } from './intrinsics';

export interface AgentView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  animation: 'idle' | 'walk' | 'gather' | 'craft' | 'rest' | 'sleep';
  verb: string | null;
}

const PERCEPTION_PERIOD = 10; // ticks (1 s simulated, spec §6.1)
const FIRE_WARMTH_RADIUS = 3;

const GATHER_VERBS = /^(gather_|eat_|fish$)/;
const CRAFT_VERBS = /^(light_fire|add_wood|build|knap_flint|deposit_|take_)/;

/**
 * Orchestrates embodied agents on kernel ticks (spec §6, §7.1): decay ->
 * perceive -> execute -> select. Deterministic: agents iterate in sorted id
 * order; Mode-1 is pure; the only randomness is the kernel's seeded rng
 * (unused here, reserved for étape 3+).
 */
export class AgentRuntime {
  readonly agents = new Map<string, AgentState>();
  private events: ActionEvent[] = [];
  private intrinsics: IntrinsicActionDef[];

  constructor(
    private world: GroundTruthWorld,
    private registry: SmartObjectRegistry,
    intrinsics?: IntrinsicActionDef[]
  ) {
    this.intrinsics = intrinsics ?? defaultIntrinsics();
  }

  addAgent(profile: AgentProfile, x: number, z: number): AgentState {
    if (this.agents.has(profile.id)) {
      throw new Error(`AgentRuntime.addAgent: duplicate id ${profile.id}`);
    }
    const agent = createAgent(profile, x, z);
    this.agents.set(profile.id, agent);
    return agent;
  }

  attachTo(kernel: SimKernel): () => void {
    return kernel.onTick((ctx) => this.tickAll(ctx));
  }

  private sortedAgents(): AgentState[] {
    return [...this.agents.values()].sort((a, b) => a.profile.id.localeCompare(b.profile.id));
  }

  private tickAll(ctx: TickContext): void {
    const roster = this.sortedAgents();
    for (const agent of roster) {
      this.tickAgent(agent, ctx, roster);
    }
  }

  private tickAgent(agent: AgentState, ctx: TickContext, roster: AgentState[]): void {
    const nearLitFire = this.world
      .objectsNear(agent.x, agent.z, FIRE_WARMTH_RADIUS)
      .some((o) => o.type === 'campfire' && (o.state.lit ?? 0) === 1);
    decayNeeds(agent.needs, {
      hour: ctx.hour,
      isMoving: agent.currentAction?.kind === 'world' && agent.currentAction.phase === 'goto',
      nearLitFire,
      isSleeping: agent.sleeping,
    });

    if (ctx.tick % PERCEPTION_PERIOD === 0) {
      const others: PerceivedAgent[] = roster
        .filter((o) => o !== agent)
        .map((o) => ({
          id: o.profile.id,
          x: o.x,
          z: o.z,
          verb: o.currentAction === null ? null : verbOf(o),
          distance: 0,
        }));
      agent.beliefs.update(
        perceive(this.world, { id: agent.profile.id, x: agent.x, z: agent.z }, others, ctx.tick)
      );
    }

    const event = executeActionTick(agent, this.world, this.intrinsics, ctx.tick);
    if (event !== null) this.events.push(event);

    if (agent.currentAction === null) {
      const next = selectAction(agent, this.registry, this.intrinsics);
      if (next !== null) {
        agent.currentAction = next;
        this.events.push({
          tick: ctx.tick,
          agentId: agent.profile.id,
          type: 'started',
          verb: next.verb,
        });
      }
    }
  }

  view(id: string): AgentView | undefined {
    const agent = this.agents.get(id);
    if (agent === undefined) return undefined;
    return {
      id,
      name: agent.profile.name,
      x: agent.x,
      y: getTerrainHeight(agent.x, agent.z),
      z: agent.z,
      heading: agent.heading,
      animation: animationOf(agent),
      verb: agent.currentAction === null ? null : verbOf(agent),
    };
  }

  views(): AgentView[] {
    return this.sortedAgents().map((a) => this.view(a.profile.id)!);
  }

  drainEvents(): ActionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}

function verbOf(agent: AgentState): string {
  return agent.currentAction === null ? '' : agent.currentAction.verb;
}

function animationOf(agent: AgentState): AgentView['animation'] {
  const action = agent.currentAction;
  if (action === null) return 'idle';
  if (action.kind === 'world' && action.phase === 'goto') return 'walk';
  const verb = action.verb;
  if (verb === 'rest_nearby') return 'rest';
  if (verb === 'sleep_inside' || verb === 'nap') return 'sleep';
  if (GATHER_VERBS.test(verb)) return 'gather';
  if (CRAFT_VERBS.test(verb)) return 'craft';
  return 'idle';
}
```

Ajouter dans `src/index.ts` :

```ts
export { AgentRuntime, type AgentView } from './agents/AgentRuntime';
```

- [ ] **Step 4 : Vérifier** — `pnpm vitest run agent-runtime` (4 passed), puis `pnpm vitest run` (toute la suite du paquet), `pnpm typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/agents/AgentRuntime.ts packages/simulation/src/index.ts packages/simulation/test/agent-runtime.test.ts
git commit -m "feat(simulation): agent runtime orchestration with views and event stream

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10 : Snapshot v2 + scénario village de bout en bout

**Files:**
- Modify: `packages/simulation/src/kernel/snapshot.ts` (version 2, agents optionnels)
- Modify: `packages/simulation/src/index.ts` (types exportés)
- Modify: `packages/simulation/test/determinism.test.ts` (accepter version 2)
- Test: `packages/simulation/test/village-e2e.test.ts`

**Interfaces:**
- Consumes: `AgentRuntime`/`AgentState` (T9), `BeliefState.toJSON/fromJSON` (T5), tout l'existant.
- Produces:
  - `interface SerializedAgent { profile: AgentProfile; x: number; z: number; heading: number; needs: AgentNeeds; inventory: Record<string, number>; beliefs: Belief[]; currentAction: CurrentAction | null; sleeping: boolean }`
  - `SimSnapshot` passe à `{ version: 2; tick; rngState; events; world; agents: SerializedAgent[] }`
  - `snapshotSim(kernel, world, runtime?)` — `agents: []` sans runtime.
  - `restoreSim(snapshot, registry)` accepte les versions 1 **et** 2 et renvoie `{ kernel, world, runtime }` (runtime re-peuplé et **ré-attaché au kernel** après le monde, dans cet ordre : régénération d'abord, agents ensuite).

- [ ] **Step 1 : Adapter le test de déterminisme existant**

Dans `test/determinism.test.ts`, remplacer uniquement les appels 2-arguments — la signature reste compatible (3ᵉ argument optionnel), aucun changement n'est requis SAUF le test de round-trip qui sérialise : vérifier qu'il passe toujours (le champ `version` passe de 1 à 2 et `agents: []` s'ajoute — les comparaisons `toEqual` entre snapshots restent vraies). Lancer `pnpm vitest run determinism` après l'implémentation ; si le test `restoreSim: unsupported snapshot version` n'existe pas, ne rien ajouter ici.

- [ ] **Step 2 : Écrire le test e2e qui échoue**

`packages/simulation/test/village-e2e.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { SimKernel, TICKS_PER_DAY } from '../src/kernel/SimKernel';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { AgentRuntime } from '../src/agents/AgentRuntime';
import { snapshotSim, restoreSim } from '../src/kernel/snapshot';
import type { ActionEvent } from '../src/agents/actions';

function makeRegistry(): SmartObjectRegistry {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return reg;
}

/** A small self-sufficient camp: food, wood, flint, fire, storage, shelter. */
function buildVillage(seed: number) {
  const reg = makeRegistry();
  const kernel = new SimKernel({ seed });
  const world = new GroundTruthWorld(reg);
  world.attachTo(kernel);
  world.definePlace('camp_aube', 0, 0, 8);
  world.spawn('berry_bush', 4, 2);
  world.spawn('berry_bush', -4, 3);
  world.spawn('berry_bush', 2, -4);
  world.spawn('oak_tree', 6, -2);
  world.spawn('oak_tree', -6, -3);
  world.spawn('flint_deposit', 5, 4);
  world.spawn('campfire', 0, 0);
  world.spawn('camp_storage', 1, 1);
  world.spawn('shelter', -2, -2);

  const runtime = new AgentRuntime(world, reg);
  runtime.attachTo(kernel);
  runtime.addAgent({ id: 'eldrin', name: 'Eldrin', tribe: 'Aube', role: 'Chef' }, 0, 1);
  runtime.addAgent({ id: 'mira', name: 'Mira', tribe: 'Aube', role: 'Cueilleuse' }, 1, 0);
  runtime.addAgent({ id: 'sylvia', name: 'Sylvia', tribe: 'Aube', role: 'Chasseresse' }, -1, 0);
  return { reg, kernel, world, runtime };
}

describe('village end-to-end (spec §13.2: autonomous civilization without LLM)', () => {
  it('three agents survive two simulated days by acting on their needs', () => {
    const { kernel, runtime } = buildVillage(11);
    const events: ActionEvent[] = [];
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
      kernel.step();
      events.push(...runtime.drainEvents());
    }

    const completed = events.filter((e) => e.type === 'completed');
    expect(completed.length).toBeGreaterThan(10);
    // Everyone ate at least once, from gathering to eating (grounded loop).
    for (const id of ['eldrin', 'mira', 'sylvia']) {
      const mine = completed.filter((e) => e.agentId === id).map((e) => e.verb);
      expect(mine).toContain('eat_berries');
      const agent = runtime.agents.get(id)!;
      expect(agent.needs.hunger).toBeGreaterThan(10);
    }
    // The cold chain fired: someone lit the fire or at least gathered fuel.
    const verbs = completed.map((e) => e.verb);
    expect(
      verbs.includes('light_fire') || verbs.includes('gather_wood') || verbs.includes('gather_flint')
    ).toBe(true);
  });

  it('two identical runs are bit-identical (agents included)', () => {
    const a = buildVillage(42);
    const b = buildVillage(42);
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      a.kernel.step();
      b.kernel.step();
    }
    expect(snapshotSim(a.kernel, a.world, a.runtime)).toEqual(
      snapshotSim(b.kernel, b.world, b.runtime)
    );
  });

  it('snapshot v2 round-trips agents and the restored village keeps living', () => {
    const run = buildVillage(7);
    for (let t = 0; t < 1200; t++) run.kernel.step();
    const snap = JSON.parse(JSON.stringify(snapshotSim(run.kernel, run.world, run.runtime)));
    expect(snap.version).toBe(2);
    expect(snap.agents).toHaveLength(3);

    const { kernel, runtime } = restoreSim(snap, makeRegistry());
    expect(runtime.agents.size).toBe(3);
    const hungerBefore = runtime.agents.get('mira')!.needs.hunger;
    for (let t = 0; t < 600; t++) kernel.step();
    const mira = runtime.agents.get('mira')!;
    // The restored agent kept acting (needs changed, actions ran).
    expect(mira.needs.hunger).not.toBe(hungerBefore);
  });

  it('restoreSim still accepts version 1 snapshots (no agents)', () => {
    const reg = makeRegistry();
    const kernel = new SimKernel({ seed: 1 });
    const world = new GroundTruthWorld(reg);
    world.spawn('berry_bush', 1, 1);
    const v1 = JSON.parse(JSON.stringify(snapshotSim(kernel, world)));
    v1.version = 1;
    delete v1.agents;
    const restored = restoreSim(v1, makeRegistry());
    expect(restored.world.get('berry_bush_1')).toBeDefined();
    expect(restored.runtime.agents.size).toBe(0);
  });
});
```

- [ ] **Step 3 : Vérifier l'échec** — `pnpm vitest run village-e2e` → FAIL (`snapshotSim` n'accepte pas de 3ᵉ argument / version 1).

- [ ] **Step 4 : Implémenter**

Réécrire `packages/simulation/src/kernel/snapshot.ts` :

```ts
import { SimKernel } from './SimKernel';
import type { ExternalEvent } from './EventLog';
import type { RngState } from './Rng';
import { GroundTruthWorld, type WorldSnapshot } from '../world/GroundTruthWorld';
import type { SmartObjectRegistry } from '../world/SmartObject';
import { AgentRuntime } from '../agents/AgentRuntime';
import { BeliefState, type Belief } from '../agents/BeliefState';
import type { AgentProfile, CurrentAction } from '../agents/AgentState';
import type { AgentNeeds } from '../agents/needs';

/**
 * Full serializable simulation state (spec §8.4). v1 = kernel + world
 * (étape 1); v2 adds embodied agents. restoreSim accepts both.
 */
export interface SerializedAgent {
  profile: AgentProfile;
  x: number;
  z: number;
  heading: number;
  needs: AgentNeeds;
  inventory: Record<string, number>;
  beliefs: Belief[];
  currentAction: CurrentAction | null;
  sleeping: boolean;
}

export interface SimSnapshot {
  version: 2;
  tick: number;
  rngState: RngState;
  events: ExternalEvent[];
  world: WorldSnapshot;
  agents: SerializedAgent[];
}

export function snapshotSim(
  kernel: SimKernel,
  world: GroundTruthWorld,
  runtime?: AgentRuntime
): SimSnapshot {
  const agents: SerializedAgent[] = runtime
    ? [...runtime.agents.values()]
        .sort((a, b) => a.profile.id.localeCompare(b.profile.id))
        .map((a) => ({
          profile: { ...a.profile },
          x: a.x,
          z: a.z,
          heading: a.heading,
          needs: { ...a.needs },
          inventory: { ...a.inventory },
          beliefs: a.beliefs.toJSON(),
          currentAction: a.currentAction === null ? null : { ...a.currentAction },
          sleeping: a.sleeping,
        }))
    : [];
  return {
    version: 2,
    tick: kernel.tick,
    rngState: kernel.rng.getState(),
    events: kernel.log.toJSON(),
    world: world.toJSON(),
    agents,
  };
}

export function restoreSim(
  snapshot: SimSnapshot | (Omit<SimSnapshot, 'version' | 'agents'> & { version: 1 }),
  registry: SmartObjectRegistry
): { kernel: SimKernel; world: GroundTruthWorld; runtime: AgentRuntime } {
  if (snapshot.version !== 1 && snapshot.version !== 2) {
    throw new Error(`restoreSim: unsupported snapshot version ${String(snapshot.version)}`);
  }
  const kernel = new SimKernel({ seed: 0 });
  kernel.tick = snapshot.tick;
  kernel.rng.setState(snapshot.rngState);
  for (const e of snapshot.events) kernel.log.record(e);
  const world = GroundTruthWorld.fromJSON(snapshot.world, registry);
  world.attachTo(kernel);
  const runtime = new AgentRuntime(world, registry);
  const agents = snapshot.version === 2 ? snapshot.agents : [];
  for (const s of agents) {
    const agent = runtime.addAgent({ ...s.profile }, s.x, s.z);
    agent.heading = s.heading;
    agent.needs = { ...s.needs };
    agent.inventory = { ...s.inventory };
    agent.beliefs = BeliefState.fromJSON(s.beliefs);
    agent.currentAction = s.currentAction === null ? null : { ...s.currentAction };
    agent.sleeping = s.sleeping;
  }
  runtime.attachTo(kernel);
  return { kernel, world, runtime };
}
```

Note : `AgentState.needs` et `inventory` doivent être réassignables — c'est le cas (propriétés d'interface, pas readonly). Le call-site historique `restoreSim(snap, reg)` destructurait `{ kernel, world }` : toujours valide.

Mettre à jour l'export dans `src/index.ts` :

```ts
export { snapshotSim, restoreSim, type SimSnapshot, type SerializedAgent } from './kernel/snapshot';
```

- [ ] **Step 5 : Vérifier le tout**

Run : `pnpm vitest run` (toute la suite du paquet — y compris `determinism.test.ts` inchangé, qui doit rester vert avec version 2), `pnpm typecheck`.
Puis à la racine : `pnpm typecheck && pnpm test && pnpm build`.
Expected : tout vert. Si le test e2e « survie » échoue sur une assertion comportementale (pas de `eat_berries` pour un agent), inspecter les événements drainés — le réglage en cause est en général `MIN_SCORE` (Mode-1) ou les taux de décroissance (Task 1) ; ajuster UNIQUEMENT si l'échec est reproductible, en gardant les tests unitaires verts.

- [ ] **Step 6 : Commit**

```bash
git add packages/simulation/src/kernel/snapshot.ts packages/simulation/src/index.ts packages/simulation/test/village-e2e.test.ts packages/simulation/test/determinism.test.ts
git commit -m "feat(simulation): snapshot v2 with agents and autonomous village e2e determinism

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Couverture spec (auto-contrôle)

| Exigence spec | Tâche(s) |
| :--- | :--- |
| Besoins = coût intrinsèque continu (§5, §6.3) | 1 |
| Effets d'affordance sur les besoins (§6.3, note étape 1) | 2 |
| Inventaire à capacité limitée (§6.4) | 3 (helpers), 7 (état) |
| Perception locale 10 Hz, rayons jour/nuit, vus/entendus (§6.1) | 4, 9 (cadence) |
| BeliefState daté, périmable, divergence mesurable (§5, §6.2) | 5 |
| Navigation réelle par pas sur le terrain (§6.4) | 6 |
| Exécution spatiale des affordances, échec = surprise (§6.4, §5) | 7 |
| Mode-1 utility : gain/coût ÷ (distance+durée) (§7.1) | 8 |
| Arbitrage : l'agent agit sans jamais bloquer (§7.1) | 8, 9 |
| Restitution {position, orientation, animation} (§6.5) | 9 |
| Snapshot étendu aux agents (§8.4) | 10 |
| Civilisation autonome sans LLM, déterministe (§13.2, §11) | 10 (e2e) |

Hors périmètre étape 2 (viennent aux étapes 3–6) : adaptateur VR, Mode-2 LLM, mémoire longue/réflexion, dialogues, météo, loup/faune, joueur, télémétrie JSONL, headless batch. L'interruption d'action par urgence (§7.1) est volontairement réduite ici : Mode-1 ne re-sélectionne qu'à l'action terminée — l'interruption fine arrive avec Mode-2 (étape 4), où elle départage réflexe vs plan.
