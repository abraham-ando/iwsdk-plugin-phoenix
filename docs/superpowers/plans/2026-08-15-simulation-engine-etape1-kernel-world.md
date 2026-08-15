# Moteur de Simulation — Étape 1 : Kernel + GroundTruthWorld — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer le paquet headless `packages/simulation` (`@iwsdk/cardinal-simulation`) avec la boucle à pas fixe, le RNG seedé, l'event-log rejouable, l'index spatial, le terrain analytique, les smart objects/affordances, le catalogue v1, les lieux nommés, la régénération des ressources, les snapshots et les tests de déterminisme.

**Architecture:** Moteur pur (zéro dépendance — ni `three`, ni `@iwsdk/core`, ni `elics`), boucle à ticks de 100 ms simulées, toute stochasticité via un unique RNG xorshift128 seedé, entrées externes journalisées pour replay exact. La démo VR déléguera sa fonction de hauteur de terrain au moteur (source unique).

**Tech Stack:** TypeScript strict (tsconfig.base.json du monorepo), vitest 3, tsup 8, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-15-simulation-engine-design.md` (sections 3, 4, 8 et 13.1)

## Global Constraints

- Le paquet moteur n'importe **jamais** `three`, `@iwsdk/core` ni `elics` (spec §3 principe 1).
- Pas fixe : `TICK_MS = 100` ; `TICKS_PER_DAY = 2400` (spec §8.1).
- Toute stochasticité passe par le RNG seedé du kernel — aucun `Math.random()`, `Date.now()` ni `new Date()` dans `packages/simulation/src` (spec §8.2).
- Déterminisme observable : même graine + même event-log ⇒ même état final (spec §11).
- TypeScript strict via `tsconfig.base.json` (`noUncheckedIndexedAccess` actif — indexations à garder sûres).
- Node ≥ 20.19.0, ESM (`"type": "module"`).
- Messages de commit : convention existante `feat(...)`/`test(...)`/`docs(...)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Structure de fichiers cible

```
packages/simulation/
├── package.json                  @iwsdk/cardinal-simulation, scripts build/test/typecheck
├── tsconfig.json                 extends ../../tsconfig.base.json
├── tsup.config.ts                entrée unique src/index.ts, ESM, platform neutral
├── vitest.config.ts              env node, test/**/*.test.ts
├── src/
│   ├── index.ts                  ré-exports publics
│   ├── kernel/
│   │   ├── Rng.ts                xorshift128 seedé, get/setState
│   │   ├── EventLog.ts           journal d'entrées externes horodatées
│   │   ├── SimKernel.ts          pas fixe, timeScale, onTick, replay
│   │   └── snapshot.ts           sérialisation kernel+monde
│   ├── world/
│   │   ├── terrain.ts            getTerrainHeight/isRiverAt/isShoreAt purs
│   │   ├── SpatialGrid.ts        grille de hachage 2D, cases 4 m
│   │   ├── affordances.ts        Comparison, ActorContext, check/apply
│   │   ├── SmartObject.ts        types + SmartObjectRegistry
│   │   └── GroundTruthWorld.ts   objets, lieux nommés, régénération
│   └── content/
│       └── objects.ts            catalogue v1 (spec §4.1)
└── test/
    ├── rng.test.ts
    ├── event-log.test.ts
    ├── kernel.test.ts
    ├── spatial-grid.test.ts
    ├── terrain.test.ts
    ├── affordances.test.ts
    ├── content-catalog.test.ts
    ├── world.test.ts
    └── determinism.test.ts

Modifiés :
├── package.json (racine)                          filtres build/test/typecheck
├── apps/demo/package.json                          + dépendance workspace
└── apps/demo/src/simulation/ProceduralTerrain.ts   délégation getHeight/isRiver/isShore
```

---

### Task 1 : Squelette du paquet `@iwsdk/cardinal-simulation`

**Files:**
- Create: `packages/simulation/package.json`
- Create: `packages/simulation/tsconfig.json`
- Create: `packages/simulation/tsup.config.ts`
- Create: `packages/simulation/vitest.config.ts`
- Create: `packages/simulation/src/index.ts`
- Modify: `package.json` (racine — scripts `build`, `test`, `typecheck`)
- Test: `packages/simulation/test/smoke.test.ts`

**Interfaces:**
- Consumes: rien (première tâche).
- Produces: le paquet installable ; `ENGINE_NAME: string` exporté de `src/index.ts` ; les commandes `pnpm --filter @iwsdk/cardinal-simulation test|typecheck|build`.

- [ ] **Step 1 : Créer les fichiers de configuration du paquet**

`packages/simulation/package.json` :

```json
{
  "name": "@iwsdk/cardinal-simulation",
  "version": "0.1.0",
  "description": "Headless deterministic civilization simulation engine (LeCun-style world model substrate) for the Cardinal stack",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.20.1",
    "tsup": "^8.5.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  },
  "engines": {
    "node": ">=20.19.0"
  }
}
```

`packages/simulation/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/simulation/tsup.config.ts` :

```ts
import { defineConfig } from 'tsup';

// Single pure-ESM library entry. No externals needed: the engine has zero
// runtime dependencies by design (spec §3 — headless, no renderer imports).
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
});
```

`packages/simulation/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
```

`packages/simulation/src/index.ts` :

```ts
export const ENGINE_NAME = '@iwsdk/cardinal-simulation';
```

- [ ] **Step 2 : Écrire le test de fumée (échec attendu avant `pnpm install`)**

`packages/simulation/test/smoke.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { ENGINE_NAME } from '../src/index';

describe('package smoke', () => {
  it('exposes the engine name', () => {
    expect(ENGINE_NAME).toBe('@iwsdk/cardinal-simulation');
  });
});
```

- [ ] **Step 3 : Installer et vérifier que le test passe**

Run : `pnpm install && pnpm --filter @iwsdk/cardinal-simulation test`
Expected : `1 passed`.

Run : `pnpm --filter @iwsdk/cardinal-simulation typecheck && pnpm --filter @iwsdk/cardinal-simulation build`
Expected : 0 erreur, `dist/index.js` + `dist/index.d.ts` générés.

- [ ] **Step 4 : Brancher le paquet dans les scripts racine**

Dans `package.json` (racine), modifier trois scripts (le moteur se construit en premier — la démo en dépendra) :

- `"build"` : préfixer par `pnpm --filter @iwsdk/cardinal-simulation build && ` (avant le filtre plugin-phoenix).
- `"test"` : insérer `pnpm --filter @iwsdk/cardinal-simulation test && ` juste avant `pnpm --filter @iwsdk/plugin-phoenix test`.
- `"typecheck"` : préfixer par `pnpm --filter @iwsdk/cardinal-simulation typecheck && `.

Run : `pnpm test`
Expected : les suites existantes (303 tests) + le smoke test passent.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation package.json pnpm-lock.yaml
git commit -m "feat(simulation): scaffold @iwsdk/cardinal-simulation headless engine package

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : RNG déterministe seedé

**Files:**
- Create: `packages/simulation/src/kernel/Rng.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/rng.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `class Rng { constructor(seed: number); next(): number; int(minIncl: number, maxExcl: number): number; pick<T>(items: readonly T[]): T; getState(): RngState; setState(state: RngState): void }` et `type RngState = [number, number, number, number]`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/rng.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/kernel/Rng';

describe('Rng', () => {
  it('produces an identical sequence for an identical seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays within [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(min, max) stays within [min, max) and covers the range', () => {
    const rng = new Rng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1_000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  it('pick() throws on an empty array', () => {
    expect(() => new Rng(1).pick([])).toThrow('Rng.pick: empty array');
  });

  it('state round-trip resumes the exact sequence', () => {
    const rng = new Rng(1234);
    for (let i = 0; i < 50; i++) rng.next();
    const state = rng.getState();
    const expected = Array.from({ length: 20 }, () => rng.next());

    const resumed = new Rng(0);
    resumed.setState(state);
    const actual = Array.from({ length: 20 }, () => resumed.next());
    expect(actual).toEqual(expected);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- rng`
Expected : FAIL — `Cannot find module '../src/kernel/Rng'`.

- [ ] **Step 3 : Implémenter le RNG**

`packages/simulation/src/kernel/Rng.ts` :

```ts
export type RngState = [number, number, number, number];

/**
 * Deterministic xorshift128 PRNG. All engine stochasticity flows through one
 * instance owned by the kernel — never Math.random() (spec §8.2). State is
 * serializable so snapshots resume the exact sequence.
 */
export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    // splitmix32 expands one 32-bit seed into the 128-bit xorshift state.
    let h = seed >>> 0;
    const splitmix = (): number => {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = splitmix();
    this.s1 = splitmix();
    this.s2 = splitmix();
    this.s3 = splitmix();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    const t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = s;
    let x = (t ^ (t << 11)) >>> 0;
    x = (x ^ (x >>> 8)) >>> 0;
    this.s0 = (x ^ s ^ (s >>> 19)) >>> 0;
    return this.s0 / 0x1_0000_0000;
  }

  /** Uniform integer in [minIncl, maxExcl). */
  int(minIncl: number, maxExcl: number): number {
    return minIncl + Math.floor(this.next() * (maxExcl - minIncl));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length)] as T;
  }

  getState(): RngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  setState(state: RngState): void {
    this.s0 = state[0];
    this.s1 = state[1];
    this.s2 = state[2];
    this.s3 = state[3];
  }
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export { Rng, type RngState } from './kernel/Rng';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- rng` puis `pnpm --filter @iwsdk/cardinal-simulation typecheck`
Expected : 6 passed, 0 erreur de type.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/kernel/Rng.ts packages/simulation/src/index.ts packages/simulation/test/rng.test.ts
git commit -m "feat(simulation): seeded xorshift128 rng with serializable state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : EventLog — journal d'entrées externes

**Files:**
- Create: `packages/simulation/src/kernel/EventLog.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/event-log.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `interface ExternalEvent { tick: number; type: string; payload: unknown }` ; `class EventLog { record(event: ExternalEvent): void; forTick(tick: number): ExternalEvent[]; all(): readonly ExternalEvent[]; toJSON(): ExternalEvent[]; static fromJSON(events: ExternalEvent[]): EventLog }`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/event-log.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { EventLog, type ExternalEvent } from '../src/kernel/EventLog';

describe('EventLog', () => {
  it('records events and returns them per tick in insertion order', () => {
    const log = new EventLog();
    log.record({ tick: 5, type: 'llm_plan', payload: { agent: 'mira' } });
    log.record({ tick: 5, type: 'player_action', payload: { verb: 'wave' } });
    log.record({ tick: 9, type: 'llm_plan', payload: { agent: 'haran' } });

    expect(log.forTick(5).map((e) => e.type)).toEqual(['llm_plan', 'player_action']);
    expect(log.forTick(9)).toHaveLength(1);
    expect(log.forTick(6)).toEqual([]);
    expect(log.all()).toHaveLength(3);
  });

  it('rejects events recorded out of tick order', () => {
    const log = new EventLog();
    log.record({ tick: 10, type: 'a', payload: null });
    expect(() => log.record({ tick: 9, type: 'b', payload: null })).toThrow(
      'EventLog.record: tick 9 is earlier than last recorded tick 10'
    );
  });

  it('JSON round-trips', () => {
    const log = new EventLog();
    log.record({ tick: 1, type: 'x', payload: { n: 1 } });
    log.record({ tick: 2, type: 'y', payload: 'str' });
    const restored = EventLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())) as ExternalEvent[]);
    expect(restored.all()).toEqual(log.all());
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- event-log`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/kernel/EventLog.ts` :

```ts
/**
 * External inputs (LLM plans, player actions) are the only non-deterministic
 * inputs to the engine. They are journaled with their delivery tick so a run
 * can be replayed exactly by re-injecting the log (spec §8.3).
 */
export interface ExternalEvent {
  tick: number;
  type: string;
  payload: unknown;
}

export class EventLog {
  private events: ExternalEvent[] = [];

  record(event: ExternalEvent): void {
    const last = this.events[this.events.length - 1];
    if (last !== undefined && event.tick < last.tick) {
      throw new Error(
        `EventLog.record: tick ${event.tick} is earlier than last recorded tick ${last.tick}`
      );
    }
    this.events.push(event);
  }

  forTick(tick: number): ExternalEvent[] {
    return this.events.filter((e) => e.tick === tick);
  }

  all(): readonly ExternalEvent[] {
    return this.events;
  }

  toJSON(): ExternalEvent[] {
    return [...this.events];
  }

  static fromJSON(events: ExternalEvent[]): EventLog {
    const log = new EventLog();
    for (const e of events) log.record(e);
    return log;
  }
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export { EventLog, type ExternalEvent } from './kernel/EventLog';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- event-log`
Expected : 3 passed.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/kernel/EventLog.ts packages/simulation/src/index.ts packages/simulation/test/event-log.test.ts
git commit -m "feat(simulation): tick-ordered external event log for exact replay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : SimKernel — pas fixe, timeScale, replay

**Files:**
- Create: `packages/simulation/src/kernel/SimKernel.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/kernel.test.ts`

**Interfaces:**
- Consumes: `Rng` (Task 2), `EventLog`/`ExternalEvent` (Task 3).
- Produces:
  - `const TICK_MS = 100`, `const TICKS_PER_DAY = 2400`, `function hourOfDay(tick: number): number` (0–24).
  - `interface TickContext { tick: number; hour: number; isDayStart: boolean; rng: Rng; events: ExternalEvent[] }`
  - `type TickHandler = (ctx: TickContext) => void`
  - `class SimKernel { constructor(opts: { seed: number; replayLog?: EventLog }); readonly rng: Rng; readonly log: EventLog; tick: number; timeScale: number; onTick(handler: TickHandler): () => void; submitEvent(type: string, payload: unknown): void; step(): void; advance(realDeltaSeconds: number): number }`

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/kernel.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { SimKernel, TICK_MS, TICKS_PER_DAY, hourOfDay } from '../src/kernel/SimKernel';
import { EventLog } from '../src/kernel/EventLog';

describe('clock constants', () => {
  it('fixes the timestep at 100 ms and the day at 2400 ticks', () => {
    expect(TICK_MS).toBe(100);
    expect(TICKS_PER_DAY).toBe(2400);
  });

  it('maps ticks to a 0-24 hour of day', () => {
    expect(hourOfDay(0)).toBe(0);
    expect(hourOfDay(TICKS_PER_DAY / 2)).toBe(12);
    expect(hourOfDay(TICKS_PER_DAY)).toBe(0);
    expect(hourOfDay(TICKS_PER_DAY + TICKS_PER_DAY / 4)).toBe(6);
  });
});

describe('SimKernel.advance', () => {
  it('accumulates real time into whole fixed ticks without drift', () => {
    const kernel = new SimKernel({ seed: 1 });
    expect(kernel.advance(0.05)).toBe(0);   // 50 ms buffered
    expect(kernel.advance(0.05)).toBe(1);   // 100 ms total -> 1 tick
    expect(kernel.advance(0.35)).toBe(3);   // 350 ms -> 3 ticks, 50 ms left
    expect(kernel.tick).toBe(4);
  });

  it('respects timeScale, including pause', () => {
    const kernel = new SimKernel({ seed: 1 });
    kernel.timeScale = 0;
    expect(kernel.advance(10)).toBe(0);
    kernel.timeScale = 10;
    expect(kernel.advance(0.1)).toBe(10);   // 100 ms réels × 10 = 10 ticks
  });

  it('caps a single advance() to 1000 ticks to avoid a death spiral', () => {
    const kernel = new SimKernel({ seed: 1 });
    expect(kernel.advance(1_000_000)).toBe(1000);
  });
});

describe('SimKernel ticks and events', () => {
  it('invokes handlers with tick context and flags day starts', () => {
    const kernel = new SimKernel({ seed: 1 });
    const dayStarts: number[] = [];
    kernel.onTick((ctx) => {
      if (ctx.isDayStart) dayStarts.push(ctx.tick);
    });
    for (let i = 0; i < TICKS_PER_DAY * 2 + 1; i++) kernel.step();
    expect(dayStarts).toEqual([TICKS_PER_DAY, TICKS_PER_DAY * 2]);
  });

  it('delivers submitted events on the next tick and journals them', () => {
    const kernel = new SimKernel({ seed: 1 });
    const seen: Array<{ tick: number; type: string }> = [];
    kernel.onTick((ctx) => {
      for (const e of ctx.events) seen.push({ tick: ctx.tick, type: e.type });
    });
    kernel.step(); // tick 1, no events
    kernel.submitEvent('llm_plan', { agent: 'mira' });
    kernel.step(); // tick 2, delivers the event
    kernel.step(); // tick 3, nothing
    expect(seen).toEqual([{ tick: 2, type: 'llm_plan' }]);
    expect(kernel.log.all()).toEqual([{ tick: 2, type: 'llm_plan', payload: { agent: 'mira' } }]);
  });

  it('unsubscribe stops a handler', () => {
    const kernel = new SimKernel({ seed: 1 });
    let calls = 0;
    const off = kernel.onTick(() => {
      calls++;
    });
    kernel.step();
    off();
    kernel.step();
    expect(calls).toBe(1);
  });

  it('replay mode re-injects a journal instead of live submissions', () => {
    // Live run: submit an event before tick 3.
    const live = new SimKernel({ seed: 5 });
    const liveDraws: number[] = [];
    live.onTick((ctx) => {
      if (ctx.events.length > 0) liveDraws.push(ctx.rng.int(0, 1000));
    });
    live.step();
    live.step();
    live.submitEvent('poke', { n: 1 });
    live.step();

    // Replay run: same seed, journal injected, no submissions.
    const replay = new SimKernel({ seed: 5, replayLog: EventLog.fromJSON(live.log.toJSON()) });
    const replayDraws: number[] = [];
    replay.onTick((ctx) => {
      if (ctx.events.length > 0) replayDraws.push(ctx.rng.int(0, 1000));
    });
    replay.step();
    replay.step();
    replay.step();

    expect(replayDraws).toEqual(liveDraws);
    expect(replay.tick).toBe(live.tick);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- kernel`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/kernel/SimKernel.ts` :

```ts
import { Rng } from './Rng';
import { EventLog, type ExternalEvent } from './EventLog';

export const TICK_MS = 100;
export const TICKS_PER_DAY = 2400;

/** Simulated hour of day in [0, 24). Tick 0 is midnight of day 0. */
export function hourOfDay(tick: number): number {
  return ((tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 24;
}

export interface TickContext {
  tick: number;
  hour: number;
  isDayStart: boolean;
  rng: Rng;
  events: ExternalEvent[];
}

export type TickHandler = (ctx: TickContext) => void;

const MAX_TICKS_PER_ADVANCE = 1000;

/**
 * Fixed-timestep simulation kernel (spec §8). Clients call advance(realDelta);
 * headless mode calls step() in a tight loop. External inputs (LLM plans,
 * player actions) are queued via submitEvent, delivered on the next tick and
 * journaled; passing a replayLog re-injects a previous journal instead.
 */
export class SimKernel {
  readonly rng: Rng;
  readonly log = new EventLog();
  tick = 0;
  timeScale = 1;

  private accumulatorMs = 0;
  private handlers: TickHandler[] = [];
  private pending: Array<{ type: string; payload: unknown }> = [];
  private replayLog: EventLog | null;

  constructor(opts: { seed: number; replayLog?: EventLog }) {
    this.rng = new Rng(opts.seed);
    this.replayLog = opts.replayLog ?? null;
  }

  onTick(handler: TickHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  submitEvent(type: string, payload: unknown): void {
    if (this.replayLog !== null) {
      throw new Error('SimKernel.submitEvent: kernel is in replay mode');
    }
    this.pending.push({ type, payload });
  }

  step(): void {
    this.tick++;
    let events: ExternalEvent[];
    if (this.replayLog !== null) {
      events = this.replayLog.forTick(this.tick);
    } else {
      events = this.pending.map((p) => ({ tick: this.tick, type: p.type, payload: p.payload }));
      this.pending = [];
      for (const e of events) this.log.record(e);
    }
    const ctx: TickContext = {
      tick: this.tick,
      hour: hourOfDay(this.tick),
      isDayStart: this.tick % TICKS_PER_DAY === 0,
      rng: this.rng,
      events,
    };
    for (const handler of [...this.handlers]) handler(ctx);
  }

  /** Returns the number of ticks actually run. */
  advance(realDeltaSeconds: number): number {
    if (this.timeScale <= 0) return 0;
    this.accumulatorMs += realDeltaSeconds * 1000 * this.timeScale;
    let ran = 0;
    while (this.accumulatorMs >= TICK_MS && ran < MAX_TICKS_PER_ADVANCE) {
      this.accumulatorMs -= TICK_MS;
      this.step();
      ran++;
    }
    if (ran === MAX_TICKS_PER_ADVANCE) this.accumulatorMs = 0;
    return ran;
  }
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export {
  SimKernel,
  TICK_MS,
  TICKS_PER_DAY,
  hourOfDay,
  type TickContext,
  type TickHandler,
} from './kernel/SimKernel';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- kernel` puis `pnpm --filter @iwsdk/cardinal-simulation typecheck`
Expected : 9 passed, 0 erreur.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/kernel/SimKernel.ts packages/simulation/src/index.ts packages/simulation/test/kernel.test.ts
git commit -m "feat(simulation): fixed-timestep kernel with timescale, day boundaries and replay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 : SpatialGrid — index spatial O(1)

**Files:**
- Create: `packages/simulation/src/world/SpatialGrid.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/spatial-grid.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `class SpatialGrid { constructor(cellSize?: number); insert(id: string, x: number, z: number): void; move(id: string, x: number, z: number): void; remove(id: string): void; positionOf(id: string): { x: number; z: number } | undefined; queryRadius(x: number, z: number, radius: number): string[] }` — `queryRadius` filtre par distance euclidienne réelle et renvoie les ids **triés** (déterminisme).

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/spatial-grid.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { SpatialGrid } from '../src/world/SpatialGrid';

describe('SpatialGrid', () => {
  it('finds only entities within the radius, sorted by id', () => {
    const grid = new SpatialGrid(4);
    grid.insert('bush_b', 1, 0);
    grid.insert('bush_a', 2, 0);
    grid.insert('far_tree', 30, 30);
    expect(grid.queryRadius(0, 0, 5)).toEqual(['bush_a', 'bush_b']);
    expect(grid.queryRadius(0, 0, 1.5)).toEqual(['bush_b']);
    expect(grid.queryRadius(30, 30, 1)).toEqual(['far_tree']);
  });

  it('finds entities across cell boundaries', () => {
    const grid = new SpatialGrid(4);
    grid.insert('edge', 3.9, 0);      // cell (0,0)
    expect(grid.queryRadius(4.1, 0, 1)).toEqual(['edge']); // query from cell (1,0)
  });

  it('supports negative coordinates', () => {
    const grid = new SpatialGrid(4);
    grid.insert('west', -10, -10);
    expect(grid.queryRadius(-9, -9, 2)).toEqual(['west']);
  });

  it('move relocates an entity', () => {
    const grid = new SpatialGrid(4);
    grid.insert('walker', 0, 0);
    grid.move('walker', 20, 20);
    expect(grid.queryRadius(0, 0, 5)).toEqual([]);
    expect(grid.queryRadius(20, 20, 1)).toEqual(['walker']);
    expect(grid.positionOf('walker')).toEqual({ x: 20, z: 20 });
  });

  it('remove deletes an entity; duplicate insert throws', () => {
    const grid = new SpatialGrid(4);
    grid.insert('tmp', 0, 0);
    grid.remove('tmp');
    expect(grid.queryRadius(0, 0, 5)).toEqual([]);
    expect(grid.positionOf('tmp')).toBeUndefined();
    grid.insert('dup', 0, 0);
    expect(() => grid.insert('dup', 1, 1)).toThrow('SpatialGrid.insert: duplicate id dup');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- spatial-grid`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/world/SpatialGrid.ts` :

```ts
/**
 * 2D hash grid over the ground plane (spec §4.2). Cells are 4 m by default;
 * queryRadius scans only the covered cells then filters by true euclidean
 * distance. Results are sorted by id so iteration order is deterministic.
 */
export class SpatialGrid {
  private cells = new Map<string, Set<string>>();
  private positions = new Map<string, { x: number; z: number }>();

  constructor(private cellSize: number = 4) {}

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  insert(id: string, x: number, z: number): void {
    if (this.positions.has(id)) {
      throw new Error(`SpatialGrid.insert: duplicate id ${id}`);
    }
    this.positions.set(id, { x, z });
    const key = this.cellKey(x, z);
    let cell = this.cells.get(key);
    if (cell === undefined) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(id);
  }

  move(id: string, x: number, z: number): void {
    this.remove(id);
    this.insert(id, x, z);
  }

  remove(id: string): void {
    const pos = this.positions.get(id);
    if (pos === undefined) return;
    this.positions.delete(id);
    const key = this.cellKey(pos.x, pos.z);
    const cell = this.cells.get(key);
    if (cell !== undefined) {
      cell.delete(id);
      if (cell.size === 0) this.cells.delete(key);
    }
  }

  positionOf(id: string): { x: number; z: number } | undefined {
    const pos = this.positions.get(id);
    return pos === undefined ? undefined : { x: pos.x, z: pos.z };
  }

  queryRadius(x: number, z: number, radius: number): string[] {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);
    const r2 = radius * radius;
    const found: string[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.cells.get(`${cx},${cz}`);
        if (cell === undefined) continue;
        for (const id of cell) {
          const pos = this.positions.get(id);
          if (pos === undefined) continue;
          const dx = pos.x - x;
          const dz = pos.z - z;
          if (dx * dx + dz * dz <= r2) found.push(id);
        }
      }
    }
    return found.sort();
  }
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export { SpatialGrid } from './world/SpatialGrid';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- spatial-grid`
Expected : 5 passed.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/world/SpatialGrid.ts packages/simulation/src/index.ts packages/simulation/test/spatial-grid.test.ts
git commit -m "feat(simulation): deterministic 2d spatial hash grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6 : Terrain analytique dans le moteur + délégation démo

**Files:**
- Create: `packages/simulation/src/world/terrain.ts`
- Modify: `packages/simulation/src/index.ts`
- Modify: `apps/demo/package.json` (dépendance workspace)
- Modify: `apps/demo/src/simulation/ProceduralTerrain.ts:28-77` (les trois fonctions statiques délèguent au moteur)
- Test: `packages/simulation/test/terrain.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `const WORLD_SIZE = 64`, `function getTerrainHeight(x: number, z: number): number`, `function isRiverAt(x: number, z: number): boolean`, `function isShoreAt(x: number, z: number): boolean`. La démo continue d'exposer `ProceduralTerrain.getHeight/isRiver/isShore` (signatures inchangées) mais délègue au moteur.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/terrain.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { WORLD_SIZE, getTerrainHeight, isRiverAt, isShoreAt } from '../src/world/terrain';

describe('analytic terrain', () => {
  it('world is 64 m wide', () => {
    expect(WORLD_SIZE).toBe(64);
  });

  it('keeps the central settlement plateau perfectly flat at y=0', () => {
    // Plateau: radius 5 around (0, -2.5) — spec inherited from ProceduralTerrain.
    expect(getTerrainHeight(0, -2.5)).toBe(0);
    expect(getTerrainHeight(2, 0)).toBe(0);
    expect(getTerrainHeight(-3, -4)).toBe(0);
  });

  it('is non-negative and finite across the map', () => {
    for (let x = -32; x <= 32; x += 2) {
      for (let z = -32; z <= 32; z += 2) {
        const y = getTerrainHeight(x, z);
        expect(Number.isFinite(y)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is continuous (no cliffs over a 10 cm step)', () => {
    for (let x = -30; x <= 30; x += 1.7) {
      for (let z = -30; z <= 30; z += 1.7) {
        const dy = Math.abs(getTerrainHeight(x + 0.1, z) - getTerrainHeight(x, z));
        expect(dy).toBeLessThan(1);
      }
    }
  });

  it('marks the riverbed and the shore consistently', () => {
    // River center at z=0 is x = 4.0 + sin(0)*3.5 = 4.0.
    expect(isRiverAt(4.0, 0)).toBe(true);
    expect(isShoreAt(4.0, 0)).toBe(false);
    expect(isRiverAt(4.0 + 3.0, 0)).toBe(false);
    expect(isShoreAt(4.0 + 3.0, 0)).toBe(true);
    expect(isRiverAt(20, 0)).toBe(false);
    expect(isShoreAt(20, 0)).toBe(false);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- terrain`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter le terrain moteur**

`packages/simulation/src/world/terrain.ts` — **porter le code à l'identique** depuis `apps/demo/src/simulation/ProceduralTerrain.ts` (les corps de `getHeight`, `isRiver`, `isShore` — mêmes constantes, mêmes formules ; seul le style change : fonctions pures au lieu de méthodes statiques) :

```ts
/**
 * Analytic terrain height field (spec §4.2). Single source of truth: the VR
 * demo's ProceduralTerrain delegates here so simulation and rendering can
 * never diverge. Pure math — no three.js.
 */
export const WORLD_SIZE = 64;

export function getTerrainHeight(x: number, z: number): number {
  const distFromCenter = Math.sqrt(x * x + (z + 2.5) * (z + 2.5));

  // Central settlement flat plateau (radius 5 m is completely flat at 0.0)
  if (distFromCenter < 5.0) {
    return 0.0;
  }

  // Smooth hermite blend from flat village (0.0) to rolling hills beyond 5 m
  const t = Math.min(1.0, (distFromCenter - 5.0) / 4.0);
  const blend = t * t * (3 - 2 * t);

  const hill1 = Math.sin(x * 0.08) * Math.cos(z * 0.08) * 1.8;
  const hill2 =
    (Math.sin(x * 0.05 + 1.2) * Math.cos(z * 0.05 + 0.8) - Math.sin(1.2) * Math.cos(0.8)) * 2.5;

  const mountainRise = distFromCenter > 16 ? Math.pow((distFromCenter - 16) * 0.18, 1.8) : 0;

  const riverX = 4.0 + Math.sin(z * 0.12) * 3.5;
  const distToRiver = Math.abs(x - riverX);
  const riverCarve = distToRiver < 4.0 ? Math.cos((distToRiver / 4.0) * (Math.PI / 2)) * 1.2 : 0;

  const microDetail = Math.sin(x * 0.35) * Math.cos(z * 0.35) * 0.15;

  const rawHeight = Math.max(0, hill1 + hill2 + mountainRise - riverCarve + microDetail);
  return rawHeight * blend;
}

export function isRiverAt(x: number, z: number): boolean {
  const riverX = 4.0 + Math.sin(z * 0.12) * 3.5;
  return Math.abs(x - riverX) < 2.2;
}

export function isShoreAt(x: number, z: number): boolean {
  const riverX = 4.0 + Math.sin(z * 0.12) * 3.5;
  const d = Math.abs(x - riverX);
  return d >= 2.2 && d < 4.5;
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export { WORLD_SIZE, getTerrainHeight, isRiverAt, isShoreAt } from './world/terrain';
```

- [ ] **Step 4 : Vérifier le passage côté moteur, puis builder**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- terrain && pnpm --filter @iwsdk/cardinal-simulation build`
Expected : 5 passed, build OK (le build est requis pour que la démo résolve les types).

- [ ] **Step 5 : Faire déléguer la démo**

Dans `apps/demo/package.json`, ajouter aux `dependencies` :

```json
"@iwsdk/cardinal-simulation": "workspace:*"
```

puis `pnpm install`.

Dans `apps/demo/src/simulation/ProceduralTerrain.ts` : ajouter l'import et remplacer **uniquement les corps** des trois méthodes statiques (les signatures, `SIZE`, `SEGMENTS` et `createTerrain()` ne changent pas) :

```ts
import { getTerrainHeight, isRiverAt, isShoreAt } from '@iwsdk/cardinal-simulation';
```

```ts
  public static getHeight(x: number, z: number): number {
    return getTerrainHeight(x, z);
  }

  public static isRiver(x: number, z: number): boolean {
    return isRiverAt(x, z);
  }

  public static isShore(x: number, z: number): boolean {
    return isShoreAt(x, z);
  }
```

Supprimer du fichier les corps de formules devenus morts (les ~45 lignes de maths des trois méthodes) — la doc de classe pointe désormais vers le moteur.

- [ ] **Step 6 : Vérifier la démo**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck && pnpm test`
Expected : 0 erreur de type ; toutes les suites passent (le rendu du terrain est inchangé puisque les formules sont identiques).

- [ ] **Step 7 : Commit**

```bash
git add packages/simulation/src/world/terrain.ts packages/simulation/src/index.ts packages/simulation/test/terrain.test.ts apps/demo/package.json apps/demo/src/simulation/ProceduralTerrain.ts pnpm-lock.yaml
git commit -m "feat(simulation): pure analytic terrain in engine, demo delegates height/river/shore

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7 : Affordances — préconditions et effets

**Files:**
- Create: `packages/simulation/src/world/affordances.ts`
- Create: `packages/simulation/src/world/SmartObject.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/affordances.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces (dans `SmartObject.ts`) :
  - `type Comparison = string` (forme `'>0'`, `'<1.5'`, `'>=1'`, `'<=3'`, `'==1'`)
  - `interface AffordanceDef { verb: string; durationTicks: number; preconditions?: { objectState?: Record<string, Comparison>; actorDistance?: Comparison; actorInventory?: Record<string, Comparison> }; effects: { object?: Record<string, number>; actorInventory?: Record<string, number> } }`
  - `interface SmartObjectDef { affordances: AffordanceDef[]; state: Record<string, number>; regrowth?: Array<{ field: string; perDay: number; max: number }> }`
  - `interface SmartObjectInstance { id: string; type: string; x: number; z: number; state: Record<string, number> }`
  - `class SmartObjectRegistry { define(type: string, def: SmartObjectDef): void; get(type: string): SmartObjectDef; has(type: string): boolean; types(): string[] }` (`get` jette sur type inconnu, `define` jette sur doublon)
- Produces (dans `affordances.ts`) :
  - `interface ActorContext { x: number; z: number; inventory: Record<string, number> }`
  - `function compare(value: number, expr: Comparison): boolean` (jette sur expression invalide)
  - `type AffordanceCheck = { ok: true } | { ok: false; reason: string }`
  - `function checkAffordance(def: AffordanceDef, obj: SmartObjectInstance, actor: ActorContext): AffordanceCheck`
  - `function applyAffordance(def: AffordanceDef, obj: SmartObjectInstance, actor: ActorContext): void` (mute `obj.state` et `actor.inventory`, plancher à 0)

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/affordances.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  compare,
  checkAffordance,
  applyAffordance,
  type ActorContext,
} from '../src/world/affordances';
import type { AffordanceDef, SmartObjectInstance } from '../src/world/SmartObject';

const gatherBerries: AffordanceDef = {
  verb: 'gather_berries',
  durationTicks: 30,
  preconditions: {
    objectState: { berriesLeft: '>0' },
    actorDistance: '<1.5',
  },
  effects: {
    object: { berriesLeft: -2 },
    actorInventory: { berries: +2 },
  },
};

function makeBush(): SmartObjectInstance {
  return { id: 'bush_1', type: 'berry_bush', x: 0, z: 0, state: { berriesLeft: 3 } };
}

function makeActor(x = 0.5, z = 0): ActorContext {
  return { x, z, inventory: {} };
}

describe('compare', () => {
  it('evaluates all five operators', () => {
    expect(compare(3, '>0')).toBe(true);
    expect(compare(0, '>0')).toBe(false);
    expect(compare(1.2, '<1.5')).toBe(true);
    expect(compare(2, '>=2')).toBe(true);
    expect(compare(2, '<=1')).toBe(false);
    expect(compare(1, '==1')).toBe(true);
  });

  it('throws on malformed expressions', () => {
    expect(() => compare(1, 'abc')).toThrow('Invalid comparison: abc');
  });
});

describe('checkAffordance', () => {
  it('passes when all preconditions hold', () => {
    expect(checkAffordance(gatherBerries, makeBush(), makeActor())).toEqual({ ok: true });
  });

  it('fails on empty object state with a reason', () => {
    const bush = makeBush();
    bush.state.berriesLeft = 0;
    const res = checkAffordance(gatherBerries, bush, makeActor());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('berriesLeft');
  });

  it('fails when the actor is too far', () => {
    const res = checkAffordance(gatherBerries, makeBush(), makeActor(10, 10));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('actorDistance');
  });

  it('checks actor inventory preconditions', () => {
    const lightFire: AffordanceDef = {
      verb: 'light_fire',
      durationTicks: 50,
      preconditions: { actorInventory: { wood: '>=1', flint: '>=1' } },
      effects: { object: { lit: +1 }, actorInventory: { wood: -1 } },
    };
    const fire: SmartObjectInstance = { id: 'f1', type: 'campfire', x: 0, z: 0, state: { lit: 0, fuel: 0 } };
    const poor = makeActor();
    expect(checkAffordance(lightFire, fire, poor).ok).toBe(false);
    const equipped: ActorContext = { x: 0, z: 0, inventory: { wood: 2, flint: 1 } };
    expect(checkAffordance(lightFire, fire, equipped).ok).toBe(true);
  });
});

describe('applyAffordance', () => {
  it('mutates object state and actor inventory', () => {
    const bush = makeBush();
    const actor = makeActor();
    applyAffordance(gatherBerries, bush, actor);
    expect(bush.state.berriesLeft).toBe(1);
    expect(actor.inventory.berries).toBe(2);
  });

  it('floors object state and inventory at zero', () => {
    const bush = makeBush();
    bush.state.berriesLeft = 1;
    const actor = makeActor();
    applyAffordance(gatherBerries, bush, actor); // -2 sur 1 -> plancher 0
    expect(bush.state.berriesLeft).toBe(0);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- affordances`
Expected : FAIL — modules introuvables.

- [ ] **Step 3 : Implémenter les types et le registre**

`packages/simulation/src/world/SmartObject.ts` :

```ts
/**
 * Smart objects declare the world's action repertoire (spec §4.1): the engine
 * knows no verbs of its own. Every affordance serializes 1:1 into an LLM
 * tool definition later (étape 4).
 */
export type Comparison = string; // '>0' | '<1.5' | '>=1' | '<=3' | '==1'

export interface AffordanceDef {
  verb: string;
  durationTicks: number;
  preconditions?: {
    objectState?: Record<string, Comparison>;
    actorDistance?: Comparison;
    actorInventory?: Record<string, Comparison>;
  };
  effects: {
    object?: Record<string, number>;
    actorInventory?: Record<string, number>;
  };
}

export interface SmartObjectDef {
  affordances: AffordanceDef[];
  state: Record<string, number>;
  regrowth?: Array<{ field: string; perDay: number; max: number }>;
}

export interface SmartObjectInstance {
  id: string;
  type: string;
  x: number;
  z: number;
  state: Record<string, number>;
}

export class SmartObjectRegistry {
  private defs = new Map<string, SmartObjectDef>();

  define(type: string, def: SmartObjectDef): void {
    if (this.defs.has(type)) {
      throw new Error(`SmartObjectRegistry.define: duplicate type ${type}`);
    }
    this.defs.set(type, def);
  }

  get(type: string): SmartObjectDef {
    const def = this.defs.get(type);
    if (def === undefined) {
      throw new Error(`SmartObjectRegistry.get: unknown type ${type}`);
    }
    return def;
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  types(): string[] {
    return [...this.defs.keys()].sort();
  }
}
```

`packages/simulation/src/world/affordances.ts` :

```ts
import type { AffordanceDef, Comparison, SmartObjectInstance } from './SmartObject';

export interface ActorContext {
  x: number;
  z: number;
  inventory: Record<string, number>;
}

const COMPARISON_RE = /^(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/;

export function compare(value: number, expr: Comparison): boolean {
  const m = COMPARISON_RE.exec(expr.trim());
  if (m === null) throw new Error(`Invalid comparison: ${expr}`);
  const op = m[1];
  const rhs = Number(m[2]);
  switch (op) {
    case '>':
      return value > rhs;
    case '<':
      return value < rhs;
    case '>=':
      return value >= rhs;
    case '<=':
      return value <= rhs;
    case '==':
      return value === rhs;
    default:
      throw new Error(`Invalid comparison: ${expr}`);
  }
}

export type AffordanceCheck = { ok: true } | { ok: false; reason: string };

export function checkAffordance(
  def: AffordanceDef,
  obj: SmartObjectInstance,
  actor: ActorContext
): AffordanceCheck {
  const pre = def.preconditions;
  if (pre === undefined) return { ok: true };

  if (pre.objectState !== undefined) {
    for (const [field, expr] of Object.entries(pre.objectState)) {
      const value = obj.state[field] ?? 0;
      if (!compare(value, expr)) {
        return { ok: false, reason: `objectState.${field} (${value}) fails ${expr}` };
      }
    }
  }

  if (pre.actorDistance !== undefined) {
    const dx = actor.x - obj.x;
    const dz = actor.z - obj.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (!compare(dist, pre.actorDistance)) {
      return { ok: false, reason: `actorDistance (${dist.toFixed(2)}) fails ${pre.actorDistance}` };
    }
  }

  if (pre.actorInventory !== undefined) {
    for (const [item, expr] of Object.entries(pre.actorInventory)) {
      const count = actor.inventory[item] ?? 0;
      if (!compare(count, expr)) {
        return { ok: false, reason: `actorInventory.${item} (${count}) fails ${expr}` };
      }
    }
  }

  return { ok: true };
}

export function applyAffordance(
  def: AffordanceDef,
  obj: SmartObjectInstance,
  actor: ActorContext
): void {
  if (def.effects.object !== undefined) {
    for (const [field, delta] of Object.entries(def.effects.object)) {
      obj.state[field] = Math.max(0, (obj.state[field] ?? 0) + delta);
    }
  }
  if (def.effects.actorInventory !== undefined) {
    for (const [item, delta] of Object.entries(def.effects.actorInventory)) {
      actor.inventory[item] = Math.max(0, (actor.inventory[item] ?? 0) + delta);
    }
  }
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export {
  SmartObjectRegistry,
  type Comparison,
  type AffordanceDef,
  type SmartObjectDef,
  type SmartObjectInstance,
} from './world/SmartObject';
export {
  compare,
  checkAffordance,
  applyAffordance,
  type ActorContext,
  type AffordanceCheck,
} from './world/affordances';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- affordances` puis `pnpm --filter @iwsdk/cardinal-simulation typecheck`
Expected : 8 passed, 0 erreur.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/world/SmartObject.ts packages/simulation/src/world/affordances.ts packages/simulation/src/index.ts packages/simulation/test/affordances.test.ts
git commit -m "feat(simulation): smart object registry and affordance precondition/effect engine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8 : Catalogue de contenu v1

**Files:**
- Create: `packages/simulation/src/content/objects.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/content-catalog.test.ts`

**Interfaces:**
- Consumes: `SmartObjectRegistry`, `AffordanceDef` (Task 7), `compare` (validation).
- Produces: `function registerDefaultContent(registry: SmartObjectRegistry): void` enregistrant les 7 types (spec §4.1) : `berry_bush`, `oak_tree`, `flint_deposit`, `campfire`, `river_bank`, `shelter`, `camp_storage`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/content-catalog.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { compare } from '../src/world/affordances';
import { registerDefaultContent } from '../src/content/objects';

function freshRegistry(): SmartObjectRegistry {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return reg;
}

describe('default content catalog', () => {
  it('registers the seven v1 smart object types', () => {
    expect(freshRegistry().types()).toEqual([
      'berry_bush',
      'camp_storage',
      'campfire',
      'flint_deposit',
      'oak_tree',
      'river_bank',
      'shelter',
    ]);
  });

  it('every affordance is well-formed', () => {
    const reg = freshRegistry();
    for (const type of reg.types()) {
      const def = reg.get(type);
      expect(def.affordances.length).toBeGreaterThan(0);
      for (const aff of def.affordances) {
        expect(aff.verb.length).toBeGreaterThan(0);
        expect(aff.durationTicks).toBeGreaterThan(0);
        // Every comparison expression must parse (compare throws otherwise).
        const pre = aff.preconditions;
        for (const expr of Object.values(pre?.objectState ?? {})) compare(0, expr);
        for (const expr of Object.values(pre?.actorInventory ?? {})) compare(0, expr);
        if (pre?.actorDistance !== undefined) compare(0, pre.actorDistance);
      }
      // Regrowth fields must exist in initial state.
      for (const rule of def.regrowth ?? []) {
        expect(def.state).toHaveProperty(rule.field);
        expect(rule.perDay).toBeGreaterThan(0);
        expect(rule.max).toBeGreaterThan(0);
      }
    }
  });

  it('campfire light_fire requires wood and flint and consumes wood', () => {
    const def = freshRegistry().get('campfire');
    const light = def.affordances.find((a) => a.verb === 'light_fire');
    expect(light).toBeDefined();
    expect(light?.preconditions?.actorInventory).toEqual({ wood: '>=1', flint: '>=1' });
    expect(light?.effects.object).toEqual({ lit: 1 });
    expect(light?.effects.actorInventory).toEqual({ wood: -1 });
  });

  it('berry_bush regrows toward its cap', () => {
    const def = freshRegistry().get('berry_bush');
    expect(def.state.berriesLeft).toBe(12);
    expect(def.regrowth).toEqual([{ field: 'berriesLeft', perDay: 4, max: 12 }]);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- content-catalog`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter le catalogue**

`packages/simulation/src/content/objects.ts` :

```ts
import type { SmartObjectRegistry } from '../world/SmartObject';

/**
 * v1 content catalog (spec §4.1). Content declares the world's verbs; the
 * engine stays generic. Durations are in 100 ms ticks (30 ticks = 3 s).
 * Actor-need effects (warmth, energy) arrive with the AgentRuntime in étape 2;
 * v1 effects touch only object state and actor inventory.
 */
export function registerDefaultContent(registry: SmartObjectRegistry): void {
  registry.define('berry_bush', {
    affordances: [
      {
        verb: 'gather_berries',
        durationTicks: 30,
        preconditions: { objectState: { berriesLeft: '>0' }, actorDistance: '<1.5' },
        effects: { object: { berriesLeft: -2 }, actorInventory: { berries: 2 } },
      },
    ],
    state: { berriesLeft: 12 },
    regrowth: [{ field: 'berriesLeft', perDay: 4, max: 12 }],
  });

  registry.define('oak_tree', {
    affordances: [
      {
        verb: 'gather_wood',
        durationTicks: 40,
        preconditions: { objectState: { woodLeft: '>0' }, actorDistance: '<2' },
        effects: { object: { woodLeft: -1 }, actorInventory: { wood: 1 } },
      },
    ],
    state: { woodLeft: 8 },
    regrowth: [{ field: 'woodLeft', perDay: 2, max: 8 }],
  });

  registry.define('flint_deposit', {
    affordances: [
      {
        verb: 'gather_flint',
        durationTicks: 50,
        preconditions: { objectState: { flintLeft: '>0' }, actorDistance: '<1.5' },
        effects: { object: { flintLeft: -1 }, actorInventory: { flint: 1 } },
      },
    ],
    state: { flintLeft: 6 },
    regrowth: [{ field: 'flintLeft', perDay: 1, max: 6 }],
  });

  registry.define('campfire', {
    affordances: [
      {
        verb: 'light_fire',
        durationTicks: 50,
        preconditions: {
          objectState: { lit: '==0' },
          actorDistance: '<2',
          actorInventory: { wood: '>=1', flint: '>=1' },
        },
        effects: { object: { lit: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'add_wood',
        durationTicks: 20,
        preconditions: { objectState: { lit: '==1' }, actorDistance: '<2', actorInventory: { wood: '>=1' } },
        effects: { object: { fuel: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'rest_nearby',
        durationTicks: 100,
        preconditions: { objectState: { lit: '==1' }, actorDistance: '<3' },
        effects: {},
      },
    ],
    state: { lit: 0, fuel: 0 },
  });

  registry.define('river_bank', {
    affordances: [
      {
        verb: 'drink',
        durationTicks: 20,
        preconditions: { actorDistance: '<2' },
        effects: {},
      },
      {
        verb: 'fish',
        durationTicks: 80,
        preconditions: { actorDistance: '<2' },
        effects: { actorInventory: { fish: 1 } },
      },
      {
        verb: 'knap_flint',
        durationTicks: 60,
        preconditions: { actorDistance: '<2', actorInventory: { flint: '>=1' } },
        effects: { actorInventory: { flint_blade: 1, flint: -1 } },
      },
    ],
    state: {},
  });

  registry.define('shelter', {
    affordances: [
      {
        verb: 'build',
        durationTicks: 60,
        preconditions: {
          objectState: { progress: '<5' },
          actorDistance: '<2.5',
          actorInventory: { wood: '>=1' },
        },
        effects: { object: { progress: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'sleep_inside',
        durationTicks: 200,
        preconditions: { objectState: { progress: '>=5' }, actorDistance: '<2.5' },
        effects: {},
      },
    ],
    state: { progress: 0 },
  });

  registry.define('camp_storage', {
    affordances: [
      {
        verb: 'deposit_berries',
        durationTicks: 10,
        preconditions: { actorDistance: '<1.5', actorInventory: { berries: '>=1' } },
        effects: { object: { berries: 1 }, actorInventory: { berries: -1 } },
      },
      {
        verb: 'take_berries',
        durationTicks: 10,
        preconditions: { objectState: { berries: '>0' }, actorDistance: '<1.5' },
        effects: { object: { berries: -1 }, actorInventory: { berries: 1 } },
      },
      {
        verb: 'deposit_wood',
        durationTicks: 10,
        preconditions: { actorDistance: '<1.5', actorInventory: { wood: '>=1' } },
        effects: { object: { wood: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'take_wood',
        durationTicks: 10,
        preconditions: { objectState: { wood: '>0' }, actorDistance: '<1.5' },
        effects: { object: { wood: -1 }, actorInventory: { wood: 1 } },
      },
    ],
    state: { berries: 0, wood: 0 },
  });
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export { registerDefaultContent } from './content/objects';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- content-catalog`
Expected : 4 passed.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/content/objects.ts packages/simulation/src/index.ts packages/simulation/test/content-catalog.test.ts
git commit -m "feat(simulation): v1 smart object content catalog (bush, tree, flint, fire, river, shelter, storage)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9 : GroundTruthWorld — objets, lieux nommés, régénération

**Files:**
- Create: `packages/simulation/src/world/GroundTruthWorld.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/world.test.ts`

**Interfaces:**
- Consumes: `SpatialGrid` (Task 5), `SmartObjectRegistry`/`SmartObjectInstance`/`AffordanceDef` (Task 7), `checkAffordance`/`ActorContext` (Task 7), `SimKernel`/`TickContext` (Task 4), `registerDefaultContent` (Task 8, dans les tests).
- Produces:
  - `interface NamedPlace { name: string; x: number; z: number; radius: number }`
  - `interface WorldSnapshot { counter: number; objects: SmartObjectInstance[]; places: NamedPlace[] }`
  - `class GroundTruthWorld { constructor(registry: SmartObjectRegistry); readonly grid: SpatialGrid; spawn(type: string, x: number, z: number): SmartObjectInstance; get(id: string): SmartObjectInstance | undefined; objectsNear(x: number, z: number, radius: number): SmartObjectInstance[]; availableAffordances(actor: ActorContext, radius: number): Array<{ object: SmartObjectInstance; affordance: AffordanceDef }>; definePlace(name: string, x: number, z: number, radius: number): void; placeAt(x: number, z: number): string | null; getPlace(name: string): NamedPlace | undefined; applyDayRegrowth(): void; attachTo(kernel: SimKernel): () => void; toJSON(): WorldSnapshot; static fromJSON(snapshot: WorldSnapshot, registry: SmartObjectRegistry): GroundTruthWorld }`

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/world.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { SimKernel, TICKS_PER_DAY } from '../src/kernel/SimKernel';

function makeWorld(): GroundTruthWorld {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return new GroundTruthWorld(reg);
}

describe('GroundTruthWorld', () => {
  it('spawns instances with deterministic ids and initial state copies', () => {
    const world = makeWorld();
    const a = world.spawn('berry_bush', 10, 5);
    const b = world.spawn('berry_bush', -8, 3);
    expect(a.id).toBe('berry_bush_1');
    expect(b.id).toBe('berry_bush_2');
    a.state.berriesLeft = 0;
    expect(b.state.berriesLeft).toBe(12); // states are independent copies
    expect(world.get('berry_bush_2')?.x).toBe(-8);
  });

  it('objectsNear uses the spatial grid, sorted by id', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 1, 1);
    world.spawn('oak_tree', 2, 0);
    world.spawn('flint_deposit', 30, 30);
    expect(world.objectsNear(0, 0, 5).map((o) => o.type)).toEqual(['berry_bush', 'oak_tree']);
  });

  it('availableAffordances filters by preconditions', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 1, 0);
    world.spawn('campfire', 0.5, 0.5);
    const poor = { x: 0, z: 0, inventory: {} };
    const verbs = world.availableAffordances(poor, 12).map((r) => r.affordance.verb);
    expect(verbs).toContain('gather_berries');
    expect(verbs).not.toContain('light_fire'); // no wood/flint in inventory
    const equipped = { x: 0, z: 0, inventory: { wood: 1, flint: 1 } };
    expect(
      world.availableAffordances(equipped, 12).map((r) => r.affordance.verb)
    ).toContain('light_fire');
  });

  it('named places resolve by containment, nearest-defined-first wins', () => {
    const world = makeWorld();
    world.definePlace('camp_aube', 0, 0, 6);
    world.definePlace('riviere_nord', 4, -20, 5);
    expect(world.placeAt(1, 1)).toBe('camp_aube');
    expect(world.placeAt(4, -18)).toBe('riviere_nord');
    expect(world.placeAt(30, 30)).toBeNull();
    expect(world.getPlace('camp_aube')).toEqual({ name: 'camp_aube', x: 0, z: 0, radius: 6 });
  });

  it('day regrowth restores stocks up to their cap', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 0, 0);
    bush.state.berriesLeft = 3;
    world.applyDayRegrowth();
    expect(bush.state.berriesLeft).toBe(7);
    world.applyDayRegrowth();
    world.applyDayRegrowth();
    expect(bush.state.berriesLeft).toBe(12); // capped at max
  });

  it('attachTo(kernel) applies regrowth on day starts only', () => {
    const world = makeWorld();
    const bush = world.spawn('berry_bush', 0, 0);
    bush.state.berriesLeft = 0;
    const kernel = new SimKernel({ seed: 1 });
    world.attachTo(kernel);
    for (let i = 0; i < TICKS_PER_DAY - 1; i++) kernel.step();
    expect(bush.state.berriesLeft).toBe(0);
    kernel.step(); // tick TICKS_PER_DAY -> day start
    expect(bush.state.berriesLeft).toBe(4);
  });

  it('JSON round-trips the full world', () => {
    const world = makeWorld();
    world.spawn('berry_bush', 1, 2).state.berriesLeft = 5;
    world.spawn('campfire', 0, 0);
    world.definePlace('camp_aube', 0, 0, 6);

    const reg = new SmartObjectRegistry();
    registerDefaultContent(reg);
    const restored = GroundTruthWorld.fromJSON(
      JSON.parse(JSON.stringify(world.toJSON())),
      reg
    );
    expect(restored.toJSON()).toEqual(world.toJSON());
    expect(restored.get('berry_bush_1')?.state.berriesLeft).toBe(5);
    // Counter continues after restore: no id collision.
    expect(restored.spawn('berry_bush', 9, 9).id).toBe('berry_bush_3');
  });
});
```

Note : `berry_bush_3` — le compteur est global par monde (2 objets spawnés avant snapshot ⇒ prochain id numéro 3, le préfixe reste le type).

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- world.test`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/world/GroundTruthWorld.ts` :

```ts
import { SpatialGrid } from './SpatialGrid';
import {
  SmartObjectRegistry,
  type AffordanceDef,
  type SmartObjectInstance,
} from './SmartObject';
import { checkAffordance, type ActorContext } from './affordances';
import type { SimKernel } from '../kernel/SimKernel';

export interface NamedPlace {
  name: string;
  x: number;
  z: number;
  radius: number;
}

export interface WorldSnapshot {
  counter: number;
  objects: SmartObjectInstance[];
  places: NamedPlace[];
}

/**
 * The simulation's ground truth (spec §4): every smart object instance, the
 * spatial index over them, named places, and daily resource regrowth. Agents
 * never read this directly — perception (étape 2) mediates all access.
 */
export class GroundTruthWorld {
  readonly grid = new SpatialGrid();
  private objects = new Map<string, SmartObjectInstance>();
  private places = new Map<string, NamedPlace>();
  private counter = 0;

  constructor(private registry: SmartObjectRegistry) {}

  spawn(type: string, x: number, z: number): SmartObjectInstance {
    const def = this.registry.get(type);
    this.counter++;
    const instance: SmartObjectInstance = {
      id: `${type}_${this.counter}`,
      type,
      x,
      z,
      state: { ...def.state },
    };
    this.objects.set(instance.id, instance);
    this.grid.insert(instance.id, x, z);
    return instance;
  }

  get(id: string): SmartObjectInstance | undefined {
    return this.objects.get(id);
  }

  objectsNear(x: number, z: number, radius: number): SmartObjectInstance[] {
    const result: SmartObjectInstance[] = [];
    for (const id of this.grid.queryRadius(x, z, radius)) {
      const obj = this.objects.get(id);
      if (obj !== undefined) result.push(obj);
    }
    return result;
  }

  /** All affordances near the actor whose preconditions currently pass. */
  availableAffordances(
    actor: ActorContext,
    radius: number
  ): Array<{ object: SmartObjectInstance; affordance: AffordanceDef }> {
    const result: Array<{ object: SmartObjectInstance; affordance: AffordanceDef }> = [];
    for (const object of this.objectsNear(actor.x, actor.z, radius)) {
      const def = this.registry.get(object.type);
      for (const affordance of def.affordances) {
        // Distance preconditions are checked against the actor's *current*
        // position; callers planning ahead should re-check after moving.
        if (checkAffordance(affordance, object, actor).ok) {
          result.push({ object, affordance });
        }
      }
    }
    return result;
  }

  definePlace(name: string, x: number, z: number, radius: number): void {
    if (this.places.has(name)) {
      throw new Error(`GroundTruthWorld.definePlace: duplicate place ${name}`);
    }
    this.places.set(name, { name, x, z, radius });
  }

  placeAt(x: number, z: number): string | null {
    for (const place of this.places.values()) {
      const dx = x - place.x;
      const dz = z - place.z;
      if (dx * dx + dz * dz <= place.radius * place.radius) return place.name;
    }
    return null;
  }

  getPlace(name: string): NamedPlace | undefined {
    return this.places.get(name);
  }

  applyDayRegrowth(): void {
    for (const obj of this.objects.values()) {
      const def = this.registry.get(obj.type);
      for (const rule of def.regrowth ?? []) {
        obj.state[rule.field] = Math.min(rule.max, (obj.state[rule.field] ?? 0) + rule.perDay);
      }
    }
  }

  /** Wire regrowth to the kernel's day boundaries. Returns an unsubscribe. */
  attachTo(kernel: SimKernel): () => void {
    return kernel.onTick((ctx) => {
      if (ctx.isDayStart) this.applyDayRegrowth();
    });
  }

  toJSON(): WorldSnapshot {
    return {
      counter: this.counter,
      objects: [...this.objects.values()].map((o) => ({ ...o, state: { ...o.state } })),
      places: [...this.places.values()].map((p) => ({ ...p })),
    };
  }

  static fromJSON(snapshot: WorldSnapshot, registry: SmartObjectRegistry): GroundTruthWorld {
    const world = new GroundTruthWorld(registry);
    world.counter = snapshot.counter;
    for (const obj of snapshot.objects) {
      const instance: SmartObjectInstance = { ...obj, state: { ...obj.state } };
      world.objects.set(instance.id, instance);
      world.grid.insert(instance.id, instance.x, instance.z);
    }
    for (const place of snapshot.places) {
      world.places.set(place.name, { ...place });
    }
    return world;
  }
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export {
  GroundTruthWorld,
  type NamedPlace,
  type WorldSnapshot,
} from './world/GroundTruthWorld';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- world.test` puis `pnpm --filter @iwsdk/cardinal-simulation typecheck`
Expected : 7 passed, 0 erreur.

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation/src/world/GroundTruthWorld.ts packages/simulation/src/index.ts packages/simulation/test/world.test.ts
git commit -m "feat(simulation): ground-truth world with spawning, places, regrowth and kernel wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10 : Snapshot kernel+monde et tests de déterminisme de bout en bout

**Files:**
- Create: `packages/simulation/src/kernel/snapshot.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/determinism.test.ts`

**Interfaces:**
- Consumes: `SimKernel`/`TICKS_PER_DAY` (Task 4), `Rng`/`RngState` (Task 2), `EventLog`/`ExternalEvent` (Task 3), `GroundTruthWorld`/`WorldSnapshot` (Task 9), `SmartObjectRegistry` (Task 7), `registerDefaultContent` (Task 8).
- Produces:
  - `interface SimSnapshot { version: 1; tick: number; rngState: RngState; events: ExternalEvent[]; world: WorldSnapshot }`
  - `function snapshotSim(kernel: SimKernel, world: GroundTruthWorld): SimSnapshot`
  - `function restoreSim(snapshot: SimSnapshot, registry: SmartObjectRegistry): { kernel: SimKernel; world: GroundTruthWorld }` (le monde restauré est ré-attaché au kernel via `world.attachTo(kernel)`)

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/determinism.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { SimKernel, TICKS_PER_DAY } from '../src/kernel/SimKernel';
import { EventLog } from '../src/kernel/EventLog';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { applyAffordance, checkAffordance } from '../src/world/affordances';
import { snapshotSim, restoreSim } from '../src/kernel/snapshot';

function makeRegistry(): SmartObjectRegistry {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return reg;
}

/**
 * A tiny scripted scenario exercising rng, events, affordances and regrowth.
 * It stands in for the future AgentRuntime: a "gatherer" consumes bushes at
 * random and external events trigger fire-lighting.
 */
function buildScenario(seed: number, replayLog?: EventLog) {
  const reg = makeRegistry();
  const kernel = replayLog ? new SimKernel({ seed, replayLog }) : new SimKernel({ seed });
  const world = new GroundTruthWorld(reg);
  world.attachTo(kernel);
  world.definePlace('camp_aube', 0, 0, 6);
  const bushes = [world.spawn('berry_bush', 1, 1), world.spawn('berry_bush', -2, 2)];
  const fire = world.spawn('campfire', 0, 0);
  const actor = { x: 0.5, z: 0.5, inventory: { wood: 3, flint: 2 } };
  const gather = reg.get('berry_bush').affordances[0]!;
  const light = reg.get('campfire').affordances[0]!;

  kernel.onTick((ctx) => {
    // Random gathering every 10 ticks.
    if (ctx.tick % 10 === 0) {
      const bush = bushes[ctx.rng.int(0, bushes.length)]!;
      const near = { ...actor, x: bush.x + 0.5, z: bush.z };
      if (checkAffordance(gather, bush, near).ok) {
        applyAffordance(gather, bush, near);
        actor.inventory.berries = near.inventory.berries ?? actor.inventory.berries ?? 0;
      }
    }
    // External events light the fire.
    for (const e of ctx.events) {
      if (e.type === 'light_fire' && checkAffordance(light, fire, actor).ok) {
        applyAffordance(light, fire, actor);
      }
    }
  });

  return { kernel, world, reg };
}

describe('end-to-end determinism', () => {
  it('same seed + same external events => identical state after 3 days', () => {
    const runA = buildScenario(42);
    const runB = buildScenario(42);

    for (let t = 1; t <= TICKS_PER_DAY * 3; t++) {
      if (t === 500) {
        runA.kernel.submitEvent('light_fire', {});
        runB.kernel.submitEvent('light_fire', {});
      }
      runA.kernel.step();
      runB.kernel.step();
    }

    expect(snapshotSim(runA.kernel, runA.world)).toEqual(snapshotSim(runB.kernel, runB.world));
  });

  it('advance() chunking does not change the outcome', () => {
    const runA = buildScenario(7);
    const runB = buildScenario(7);
    // A: one big chunk; B: many irregular chunks. Both reach 1000 ticks.
    runA.kernel.advance(100); // 1000 ticks (capped exactly at 1000)
    let advanced = 0;
    const chunks = [0.13, 0.07, 0.4, 1.1, 0.25];
    let i = 0;
    while (advanced < 1000) {
      const chunk = chunks[i % chunks.length]!;
      advanced += runB.kernel.advance(Math.min(chunk, (1000 - advanced) * 0.1));
      i++;
    }
    expect(runA.kernel.tick).toBe(1000);
    expect(runB.kernel.tick).toBe(1000);
    expect(snapshotSim(runA.kernel, runA.world)).toEqual(snapshotSim(runB.kernel, runB.world));
  });

  it('replaying the journal reproduces a live run exactly', () => {
    const live = buildScenario(99);
    for (let t = 1; t <= 2000; t++) {
      if (t === 300) live.kernel.submitEvent('light_fire', {});
      if (t === 900) live.kernel.submitEvent('light_fire', {});
      live.kernel.step();
    }

    const replay = buildScenario(99, EventLog.fromJSON(live.kernel.log.toJSON()));
    for (let t = 1; t <= 2000; t++) replay.kernel.step();

    const liveSnap = snapshotSim(live.kernel, live.world);
    const replaySnap = snapshotSim(replay.kernel, replay.world);
    expect(replaySnap.world).toEqual(liveSnap.world);
    expect(replaySnap.rngState).toEqual(liveSnap.rngState);
    expect(replaySnap.tick).toEqual(liveSnap.tick);
  });

  it('snapshot/restore round-trips and the restored sim continues', () => {
    // The restored side only re-attaches world regrowth (restoreSim calls
    // attachTo); the scripted gathering handler is not restored. So the
    // continuation check asserts kernel clock + day-start regrowth, not a
    // side-by-side comparison with the live run.
    const run = buildScenario(1234);
    for (let t = 1; t <= 1500; t++) run.kernel.step();
    const snap = JSON.parse(JSON.stringify(snapshotSim(run.kernel, run.world)));

    const { kernel: restoredKernel, world: restoredWorld } = restoreSim(snap, makeRegistry());
    expect(snapshotSim(restoredKernel, restoredWorld)).toEqual(snap);

    const bushBefore = restoredWorld.get('berry_bush_1')?.state.berriesLeft ?? -1;
    for (let t = 0; t < TICKS_PER_DAY; t++) restoredKernel.step();
    const bushAfter = restoredWorld.get('berry_bush_1')?.state.berriesLeft ?? -1;
    expect(restoredKernel.tick).toBe(1500 + TICKS_PER_DAY);
    expect(bushAfter).toBeGreaterThan(bushBefore); // day-start regrowth fired
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm --filter @iwsdk/cardinal-simulation test -- determinism`
Expected : FAIL — `snapshot.ts` introuvable.

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/kernel/snapshot.ts` :

```ts
import { SimKernel } from './SimKernel';
import { EventLog, type ExternalEvent } from './EventLog';
import type { RngState } from './Rng';
import { GroundTruthWorld, type WorldSnapshot } from '../world/GroundTruthWorld';
import type { SmartObjectRegistry } from '../world/SmartObject';

/**
 * Full serializable simulation state (spec §8.4): kernel clock, rng, journal
 * and world. Étape 2 will extend this with agent state. version guards
 * future format migrations.
 */
export interface SimSnapshot {
  version: 1;
  tick: number;
  rngState: RngState;
  events: ExternalEvent[];
  world: WorldSnapshot;
}

export function snapshotSim(kernel: SimKernel, world: GroundTruthWorld): SimSnapshot {
  return {
    version: 1,
    tick: kernel.tick,
    rngState: kernel.rng.getState(),
    events: kernel.log.toJSON(),
    world: world.toJSON(),
  };
}

export function restoreSim(
  snapshot: SimSnapshot,
  registry: SmartObjectRegistry
): { kernel: SimKernel; world: GroundTruthWorld } {
  if (snapshot.version !== 1) {
    throw new Error(`restoreSim: unsupported snapshot version ${String(snapshot.version)}`);
  }
  const kernel = new SimKernel({ seed: 0 });
  kernel.tick = snapshot.tick;
  kernel.rng.setState(snapshot.rngState);
  for (const e of snapshot.events) kernel.log.record(e);
  const world = GroundTruthWorld.fromJSON(snapshot.world, registry);
  world.attachTo(kernel);
  return { kernel, world };
}
```

Ajouter dans `packages/simulation/src/index.ts` :

```ts
export { snapshotSim, restoreSim, type SimSnapshot } from './kernel/snapshot';
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm --filter @iwsdk/cardinal-simulation test` puis `pnpm --filter @iwsdk/cardinal-simulation typecheck`
Expected : toute la suite du paquet passe (~40 tests), 0 erreur.

- [ ] **Step 5 : Vérification finale monorepo**

Run : `pnpm typecheck && pnpm test && pnpm build`
Expected : tout vert — les 303 tests existants + la nouvelle suite ; builds OK.

- [ ] **Step 6 : Commit**

```bash
git add packages/simulation/src/kernel/snapshot.ts packages/simulation/src/index.ts packages/simulation/test/determinism.test.ts
git commit -m "feat(simulation): full sim snapshots and end-to-end determinism/replay tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Couverture spec (auto-contrôle)

| Exigence spec §13.1 | Tâche(s) |
| :--- | :--- |
| Paquet headless zéro dépendance | 1 (scaffold, platform neutral, aucune dep) |
| RNG seedé | 2 |
| Event-log rejouable (spec §8.3) | 3, 4 |
| Pas fixe / timeScale / jour 2400 ticks (spec §8.1) | 4 |
| Index spatial (spec §4.2) | 5 |
| `getHeight` déplacé dans le moteur, source unique (spec §4.2) | 6 |
| Smart objects + affordances (spec §4.1) | 7 |
| Catalogue v1 (7 types, spec §4.1) | 8 |
| Ressources vivantes / régénération (spec §4.3) | 8, 9 |
| Lieux nommés (spec §4.4) | 9 |
| Snapshots (spec §8.4) | 9, 10 |
| Tests de déterminisme (spec §11) | 2, 4, 10 |

Hors périmètre de cette étape (étapes suivantes de la spec §13) : AgentRuntime/perception/besoins (étape 2), adaptateur VR (étape 3), Mode-2 LLM/mémoire/BFF (étape 4), télémétrie JSONL (étape 5), joueur/faune (étape 6). Le point d'entrée `headless.ts` arrive en étape 5 avec la télémétrie (rien à accélérer avant qu'il y ait des agents).
