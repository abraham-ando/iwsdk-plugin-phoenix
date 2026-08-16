# Moteur de Simulation — Étape 3 : Adaptateur VR — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La démo VR devient un client de rendu du moteur : suppression du théâtre scripté (`PrehistoricWorldSystem`, `AgentBrain`, `TribeManager`, `GodModeController`), projection des agents du moteur sur des avatars visibles animés, météo simulée côté moteur, cycle céleste continu (aube → nuit étoilée) et pluie visuelle, HUD branché sur les vrais événements.

**Architecture:** Côté moteur : une `WeatherMachine` seedée (états clear/cloudy/rain/storm, la pluie éteint les feux). Côté démo : un unique `CardinalSimulationSystem` (ECS IWSDK) possède kernel + monde + runtime + météo, avance la simulation avec le **vrai delta** de frame, et projette chaque frame l'état sur la scène (avatars, flammes de feux, ciel, pluie). Une `layout.ts` unique décrit le village — le moteur y spawne ses smart objects et la scène y construit ses visuels : plus aucune divergence possible entre simulation et rendu.

**Tech Stack:** `@iwsdk/cardinal-simulation` (workspace), IWSDK ECS (`createSystem`, `update(delta, time)`), Three.js via `@iwsdk/core`. Tests vitest côté moteur ; la démo n'a pas de runner de tests — sa vérification est `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck` + `pnpm build` + QA visuelle.

**Spec:** `docs/superpowers/specs/2026-08-15-simulation-engine-design.md` (sections 3, 6.5, 10.1, 10.2, 13.3)

## Global Constraints

- Le moteur reste sans dépendance rendu ; la démo importe Three uniquement via `@iwsdk/core` (jamais `three`).
- Le vrai `delta` du frame alimente `kernel.advance(Math.min(delta, 0.25))` — plus jamais de `0.0166` codé en dur.
- Conventions IWSDK de la démo : jamais d'allocation dans `update()` (vecteurs/couleurs pré-alloués en propriétés), `entity.dispose()` et non `destroy()`, systèmes enregistrés dans `src/index.ts`.
- `Math.random()` reste interdit dans `packages/simulation/src` ; il reste toléré dans la démo pour le **décor** uniquement (végétation), jamais pour l'état simulé.
- Messages de commit `feat(...)`/`refactor(...)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Après chaque tâche : tests moteur verts (si moteur touché) + `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck` (si démo touchée).

---

## Structure de fichiers cible

```
packages/simulation/src/
├── world/WeatherMachine.ts        (nouveau) météo seedée, pluie éteint les feux
├── kernel/snapshot.ts             (modifié) champ weather optionnel
└── index.ts                       (modifié) exports

packages/simulation/test/
└── weather.test.ts                (nouveau)

apps/demo/src/simulation/
├── layout.ts                      (nouveau) source unique : lieux, objets, agents
├── CardinalSimulationSystem.ts    (nouveau) le système ECS adaptateur
├── AgentAvatarFactory.ts          (nouveau) avatars stylisés visibles + poses procédurales
├── CelestialVisuals.ts            (nouveau) soleil/lune/ciel/étoiles/pluie
├── simulation-hud.ts              (réécrit) HUD branché sur le moteur
├── PrehistoricEnvironment3D.ts    (modifié) visuels depuis layout, plus d'avatars ni de loup
├── PrehistoricWorldSystem.ts      (SUPPRIMÉ)
├── AgentBrain.ts                  (SUPPRIMÉ)
├── TribeManager.ts                (SUPPRIMÉ)
├── GodModeController.ts           (SUPPRIMÉ)
└── types.ts                       (SUPPRIMÉ)

apps/demo/src/index.ts             (modifié) enregistrement du nouveau système
```

Notes de périmètre assumées :
- Les avatars étape 3 sont des silhouettes stylisées **visibles** (corps + tête aux couleurs de tribu, poses procédurales par état sémantique). Le rig RPM/GLB complet avec `AvatarMeshBinder` arrive à l'étape 4 avec les dialogues — l'API `AgentView.animation` est déjà celle qu'il consommera.
- Le loup disparaît de la scène (il revient comme vrai agent à l'étape 6). Les boutons HUD « Attaque de Loup » et les décrets divins (qui exigent le LLM de l'étape 4) sont retirés — le HUD n'expose que des actions réellement branchées : Tempête, Ciel dégagé, Bénédiction.
- Les colliders capsules cinématiques par agent sont retirés (ils étaient figés) ; la synchronisation physique des corps mobiles reviendra quand elle servira au gameplay.

---

### Task 1 : WeatherMachine côté moteur

**Files:**
- Create: `packages/simulation/src/world/WeatherMachine.ts`
- Modify: `packages/simulation/src/kernel/snapshot.ts` (champ `weather` optionnel)
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/weather.test.ts`

**Interfaces:**
- Consumes: `SimKernel`/`TickContext` (rng), `GroundTruthWorld`.
- Produces:
  - `type WeatherState = 'clear' | 'cloudy' | 'rain' | 'storm'`
  - `const WEATHER_CHECK_PERIOD = 300` (ticks — une chance de transition toutes les 30 s simulées)
  - `class WeatherMachine { current: WeatherState; sinceTick: number; attachTo(kernel: SimKernel, world: GroundTruthWorld): () => void; force(state: WeatherState, tick: number, world: GroundTruthWorld): void; onChange(cb: (state: WeatherState, tick: number) => void): () => void; toJSON(): { current: WeatherState; sinceTick: number }; static fromJSON(json: { current: WeatherState; sinceTick: number }): WeatherMachine }`
  - Transitions markoviennes seedées (rng du kernel) : clear→(clear .7, cloudy .3) ; cloudy→(clear .3, cloudy .4, rain .3) ; rain→(cloudy .5, rain .35, storm .15) ; storm→(rain .6, storm .4).
  - Effet simulé (spec §10.2) : à l'**entrée** en rain ou storm, tous les `campfire` du monde passent `lit = 0` (les feux ne sont pas abrités en v1).
  - Snapshot : `SimSnapshot.weather?: { current: WeatherState; sinceTick: number }` ; `snapshotSim(kernel, world, runtime?, weather?)` ; `restoreSim` renvoie en plus `weather: WeatherMachine | null` (restaurée mais **non attachée** — l'appelant appelle `attachTo`).

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/simulation/test/weather.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { WeatherMachine, WEATHER_CHECK_PERIOD } from '../src/world/WeatherMachine';
import { SimKernel } from '../src/kernel/SimKernel';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { snapshotSim, restoreSim } from '../src/kernel/snapshot';

function setup(seed: number) {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  const kernel = new SimKernel({ seed });
  const world = new GroundTruthWorld(reg);
  world.attachTo(kernel);
  const weather = new WeatherMachine();
  weather.attachTo(kernel, world);
  return { reg, kernel, world, weather };
}

describe('WeatherMachine', () => {
  it('starts clear and only transitions on period boundaries', () => {
    const { kernel, weather } = setup(1);
    expect(weather.current).toBe('clear');
    for (let t = 0; t < WEATHER_CHECK_PERIOD - 1; t++) kernel.step();
    expect(weather.current).toBe('clear'); // no boundary crossed yet
  });

  it('is deterministic: same seed, same weather history', () => {
    const a = setup(7);
    const b = setup(7);
    const historyA: string[] = [];
    const historyB: string[] = [];
    a.weather.onChange((s) => historyA.push(s));
    b.weather.onChange((s) => historyB.push(s));
    for (let t = 0; t < WEATHER_CHECK_PERIOD * 40; t++) {
      a.kernel.step();
      b.kernel.step();
    }
    expect(historyA).toEqual(historyB);
    expect(historyA.length).toBeGreaterThan(0); // it did change at least once over 40 checks
  });

  it('entering rain extinguishes every lit campfire', () => {
    const { kernel, world, weather } = setup(1);
    const fire = world.spawn('campfire', 0, 0);
    fire.state.lit = 1;
    weather.force('rain', kernel.tick, world);
    expect(weather.current).toBe('rain');
    expect(fire.state.lit).toBe(0);
  });

  it('force notifies listeners and unsubscribe works', () => {
    const { kernel, world, weather } = setup(1);
    const seen: string[] = [];
    const off = weather.onChange((s) => seen.push(s));
    weather.force('storm', kernel.tick, world);
    off();
    weather.force('clear', kernel.tick, world);
    expect(seen).toEqual(['storm']);
  });

  it('rides along snapshots', () => {
    const { kernel, world, weather } = setup(3);
    weather.force('cloudy', kernel.tick, world);
    const snap = JSON.parse(JSON.stringify(snapshotSim(kernel, world, undefined, weather)));
    expect(snap.weather).toEqual({ current: 'cloudy', sinceTick: kernel.tick });

    const reg = new SmartObjectRegistry();
    registerDefaultContent(reg);
    const restored = restoreSim(snap, reg);
    expect(restored.weather?.current).toBe('cloudy');

    // v2 snapshots without weather still restore (weather null).
    const bare = JSON.parse(JSON.stringify(snapshotSim(kernel, world)));
    delete bare.weather;
    expect(restoreSim(bare, reg).weather).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `cd packages/simulation && pnpm vitest run weather` → FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

`packages/simulation/src/world/WeatherMachine.ts` :

```ts
import type { SimKernel } from '../kernel/SimKernel';
import type { GroundTruthWorld } from './GroundTruthWorld';
import type { Rng } from '../kernel/Rng';

/**
 * Seeded Markov weather (spec §10.2). One transition roll every
 * WEATHER_CHECK_PERIOD ticks through the kernel's rng — fully deterministic.
 * Entering rain/storm extinguishes every campfire (v1: no sheltered fires).
 */
export type WeatherState = 'clear' | 'cloudy' | 'rain' | 'storm';

export const WEATHER_CHECK_PERIOD = 300;

const TRANSITIONS: Record<WeatherState, Array<[WeatherState, number]>> = {
  clear: [['clear', 0.7], ['cloudy', 0.3]],
  cloudy: [['clear', 0.3], ['cloudy', 0.4], ['rain', 0.3]],
  rain: [['cloudy', 0.5], ['rain', 0.35], ['storm', 0.15]],
  storm: [['rain', 0.6], ['storm', 0.4]],
};

function nextState(current: WeatherState, rng: Rng): WeatherState {
  const roll = rng.next();
  let cumulative = 0;
  for (const [state, p] of TRANSITIONS[current]) {
    cumulative += p;
    if (roll < cumulative) return state;
  }
  return current;
}

export class WeatherMachine {
  current: WeatherState = 'clear';
  sinceTick = 0;

  private listeners: Array<(state: WeatherState, tick: number) => void> = [];

  attachTo(kernel: SimKernel, world: GroundTruthWorld): () => void {
    return kernel.onTick((ctx) => {
      if (ctx.tick % WEATHER_CHECK_PERIOD !== 0) return;
      const next = nextState(this.current, ctx.rng);
      if (next !== this.current) this.transition(next, ctx.tick, world);
    });
  }

  force(state: WeatherState, tick: number, world: GroundTruthWorld): void {
    if (state !== this.current) this.transition(state, tick, world);
  }

  private transition(state: WeatherState, tick: number, world: GroundTruthWorld): void {
    const wasWet = this.current === 'rain' || this.current === 'storm';
    this.current = state;
    this.sinceTick = tick;
    const isWet = state === 'rain' || state === 'storm';
    if (isWet && !wasWet) {
      for (const fire of world.objectsNear(0, 0, 1000).filter((o) => o.type === 'campfire')) {
        fire.state.lit = 0;
      }
    }
    for (const listener of [...this.listeners]) listener(state, tick);
  }

  onChange(cb: (state: WeatherState, tick: number) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  toJSON(): { current: WeatherState; sinceTick: number } {
    return { current: this.current, sinceTick: this.sinceTick };
  }

  static fromJSON(json: { current: WeatherState; sinceTick: number }): WeatherMachine {
    const machine = new WeatherMachine();
    machine.current = json.current;
    machine.sinceTick = json.sinceTick;
    return machine;
  }
}
```

Dans `kernel/snapshot.ts` :
- Importer `WeatherMachine, type WeatherState`.
- Ajouter à `SimSnapshot` : `weather?: { current: WeatherState; sinceTick: number };`
- `snapshotSim(kernel, world, runtime?, weather?: WeatherMachine)` : ajouter `...(weather ? { weather: weather.toJSON() } : {})` à l'objet retourné.
- `restoreSim` : type de retour `{ kernel; world; runtime; weather: WeatherMachine | null }` ; après la construction du runtime : `const weather = snapshot.version === 2 && snapshot.weather ? WeatherMachine.fromJSON(snapshot.weather) : null;` (le champ est optionnel, un snapshot v1/v2 sans météo donne `null`) ; retourner `{ kernel, world, runtime, weather }`.

Dans `src/index.ts` :

```ts
export { WeatherMachine, WEATHER_CHECK_PERIOD, type WeatherState } from './world/WeatherMachine';
```

- [ ] **Step 4 : Vérifier** — `pnpm vitest run` (toute la suite moteur : les tests existants de snapshot restent verts, le champ est optionnel), `pnpm typecheck`, puis `pnpm --filter @iwsdk/cardinal-simulation build` (la démo consommera le dist).

- [ ] **Step 5 : Commit**

```bash
git add packages/simulation
git commit -m "feat(simulation): seeded markov weather machine, rain extinguishes fires

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : Layout du village + système adaptateur

**Files:**
- Create: `apps/demo/src/simulation/layout.ts`
- Create: `apps/demo/src/simulation/CardinalSimulationSystem.ts`
- Verify: `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck` (la démo n'a pas de runner de tests)

**Interfaces:**
- Consumes: tout l'export public de `@iwsdk/cardinal-simulation`.
- Produces (layout.ts) :
  - `interface LayoutObject { type: string; x: number; z: number }`
  - `interface LayoutAgent { id: string; name: string; tribe: 'Aube' | 'Rive' | 'Pic'; role: string; gender: 'masculine' | 'feminine'; x: number; z: number }`
  - `interface SettlementLayout { tribe: 'Aube' | 'Rive' | 'Pic'; x: number; z: number; color: number }`
  - `const VILLAGE_LAYOUT: { settlements: SettlementLayout[]; objects: LayoutObject[]; agents: LayoutAgent[]; places: Array<{ name: string; x: number; z: number; radius: number }> }`
- Produces (CardinalSimulationSystem.ts) :
  - `interface SimEvent { tick: number; kind: 'action' | 'weather' | 'day'; agentName?: string; text: string }`
  - `class CardinalSimulationSystem extends createSystem({})` avec :
    - propriétés publiques `kernel: SimKernel`, `simWorld: GroundTruthWorld`, `runtime: AgentRuntime`, `weather: WeatherMachine`, `registry: SmartObjectRegistry` — construites dans `init()` depuis `VILLAGE_LAYOUT` (graine fixe `20260815`).
    - `update(delta: number): void` → `this.kernel.advance(Math.min(delta, 0.25))`, puis drainage des `ActionEvent` du runtime transformés en `SimEvent` narratifs français, émis aux abonnés.
    - `subscribe(cb: (e: SimEvent) => void): () => void`
    - actions HUD : `forceRain()`, `forceClear()`, `grantBlessing()` (recharge `berriesLeft`/`woodLeft`/`flintLeft` de tous les nœuds à leur max et `berries +8, wood +4` dans chaque `camp_storage`).
    - `hourOfDay(): number` et `dayIndex(): number` pour le HUD/ciel.

- [ ] **Step 1 : Écrire `layout.ts`**

```ts
/**
 * Single source of truth for the village: the engine spawns its smart objects
 * from these entries and the 3D scene builds its visuals from the SAME
 * entries — simulation and rendering can never diverge (spec §3, §13.3).
 * Coordinates follow the historical settlement placement of the demo.
 */
export interface LayoutObject {
  type: string;
  x: number;
  z: number;
}

export interface LayoutAgent {
  id: string;
  name: string;
  tribe: 'Aube' | 'Rive' | 'Pic';
  role: string;
  gender: 'masculine' | 'feminine';
  x: number;
  z: number;
}

export interface SettlementLayout {
  tribe: 'Aube' | 'Rive' | 'Pic';
  x: number;
  z: number;
  color: number;
}

const SETTLEMENTS: SettlementLayout[] = [
  { tribe: 'Aube', x: 0, z: -4.5, color: 0x3b82f6 },
  { tribe: 'Rive', x: 5.5, z: -3.0, color: 0xef4444 },
  { tribe: 'Pic', x: -5.5, z: -3.0, color: 0x10b981 },
];

/** Per-settlement objects at fixed offsets (campfire at center). */
function settlementObjects(s: SettlementLayout): LayoutObject[] {
  return [
    { type: 'campfire', x: s.x, z: s.z },
    { type: 'shelter', x: s.x, z: s.z - 1.3 },
    { type: 'berry_bush', x: s.x + 1.5, z: s.z + 0.6 },
    { type: 'flint_deposit', x: s.x - 1.4, z: s.z + 0.8 },
    { type: 'camp_storage', x: s.x + 0.9, z: s.z - 0.7 },
  ];
}

const SHARED_OBJECTS: LayoutObject[] = [
  // Oaks close to the camps (subset of the visual oak grove) — wood sources.
  { type: 'oak_tree', x: -6.5, z: 2.0 },
  { type: 'oak_tree', x: 7.0, z: -1.0 },
  { type: 'oak_tree', x: -2.0, z: -13.0 },
  { type: 'oak_tree', x: 4.5, z: -14.0 },
  // River access points (river center x = 4 + sin(z*0.12)*3.5).
  { type: 'river_bank', x: 4.0, z: 0.0 },
  { type: 'river_bank', x: 2.9, z: -8.0 },
];

const AGENTS: LayoutAgent[] = [
  // Tribu de l'Aube (famille)
  { id: 'haran', name: 'Haran', tribe: 'Aube', role: 'Père & Éclaireur', gender: 'masculine', x: 1.0, z: -3.8 },
  { id: 'mira', name: 'Mira', tribe: 'Aube', role: 'Mère & Gardienne', gender: 'feminine', x: -1.0, z: -3.8 },
  { id: 'lio', name: 'Lio', tribe: 'Aube', role: 'Fils Aîné', gender: 'masculine', x: 0.8, z: -5.4 },
  { id: 'aya', name: 'Aya', tribe: 'Aube', role: 'Petite Fille', gender: 'feminine', x: -0.8, z: -5.4 },
  // Tribu de la Rive (chasseurs-artisans)
  { id: 'dagan', name: 'Dagan', tribe: 'Rive', role: 'Chef & Chasseur', gender: 'masculine', x: 6.5, z: -2.4 },
  { id: 'sira', name: 'Sira', tribe: 'Rive', role: 'Artisane', gender: 'feminine', x: 4.6, z: -2.4 },
  { id: 'nia', name: 'Nia', tribe: 'Rive', role: 'Jeune Apprentie', gender: 'feminine', x: 6.2, z: -3.9 },
  { id: 'kan', name: 'Kan', tribe: 'Rive', role: 'Guerrier Solitaire', gender: 'masculine', x: 4.8, z: -4.0 },
  // Tribu du Pic (survivants)
  { id: 'narek', name: 'Narek', tribe: 'Pic', role: 'Pisteur Expérimenté', gender: 'masculine', x: -4.6, z: -2.4 },
  { id: 'ivan', name: 'Ivan', tribe: 'Pic', role: 'Tailleur de Silex', gender: 'masculine', x: -6.4, z: -2.4 },
  { id: 'tao', name: 'Tao', tribe: 'Pic', role: 'Sentinelle du Froid', gender: 'masculine', x: -5.5, z: -4.1 },
];

export const VILLAGE_LAYOUT = {
  settlements: SETTLEMENTS,
  objects: [...SETTLEMENTS.flatMap(settlementObjects), ...SHARED_OBJECTS],
  agents: AGENTS,
  places: [
    { name: 'camp_aube', x: 0, z: -4.5, radius: 4 },
    { name: 'camp_rive', x: 5.5, z: -3.0, radius: 4 },
    { name: 'camp_pic', x: -5.5, z: -3.0, radius: 4 },
    { name: 'riviere', x: 4.0, z: 0.0, radius: 5 },
  ],
};
```

- [ ] **Step 2 : Écrire `CardinalSimulationSystem.ts`**

```ts
/**
 * The VR demo's bridge to @iwsdk/cardinal-simulation (spec §13.3): owns the
 * kernel/world/runtime/weather, advances them with the REAL frame delta, and
 * republishes engine events as French narrative lines for the HUD. Rendering
 * projection (avatars, sky, fires) subscribes to this system.
 */
import { createSystem } from '@iwsdk/core';
import {
  SimKernel,
  GroundTruthWorld,
  SmartObjectRegistry,
  AgentRuntime,
  WeatherMachine,
  registerDefaultContent,
  hourOfDay,
  TICKS_PER_DAY,
  type ActionEvent,
} from '@iwsdk/cardinal-simulation';
import { VILLAGE_LAYOUT } from './layout';

export interface SimEvent {
  tick: number;
  kind: 'action' | 'weather' | 'day';
  agentName?: string;
  text: string;
}

const SIM_SEED = 20260815;

const VERB_LABELS: Record<string, string> = {
  gather_berries: 'cueille des baies',
  gather_wood: 'ramasse du bois mort',
  gather_flint: 'extrait un éclat de silex',
  light_fire: 'allume le feu de camp',
  add_wood: 'nourrit le feu',
  rest_nearby: 'se repose près du feu',
  sleep_inside: "dort à l'abri",
  build: "renforce l'abri",
  drink: 'boit à la rivière',
  fish: 'pêche dans la rivière',
  knap_flint: 'taille une lame de silex',
  deposit_berries: 'dépose des baies au campement',
  take_berries: 'prend des baies de la réserve',
  deposit_wood: 'dépose du bois au campement',
  take_wood: 'prend du bois de la réserve',
  eat_berries: 'mange des baies',
  eat_fish: 'mange un poisson',
  nap: 'fait une sieste',
};

const WEATHER_LABELS: Record<string, string> = {
  clear: '☀️ Le ciel se dégage, un soleil bienfaisant réchauffe la vallée.',
  cloudy: '☁️ Des nuages voilent le soleil.',
  rain: '🌧️ La pluie s\'abat sur la vallée — les feux de camp s\'éteignent !',
  storm: '⛈️ L\'orage gronde ! Les tribus cherchent refuge.',
};

export class CardinalSimulationSystem extends createSystem({}) {
  public kernel!: SimKernel;
  public simWorld!: GroundTruthWorld;
  public runtime!: AgentRuntime;
  public weather!: WeatherMachine;
  public registry!: SmartObjectRegistry;

  private listeners: Array<(e: SimEvent) => void> = [];
  private lastDay = 0;

  init(): void {
    this.registry = new SmartObjectRegistry();
    registerDefaultContent(this.registry);
    this.kernel = new SimKernel({ seed: SIM_SEED });
    this.simWorld = new GroundTruthWorld(this.registry);
    this.simWorld.attachTo(this.kernel);
    this.weather = new WeatherMachine();
    this.weather.attachTo(this.kernel, this.simWorld);
    this.runtime = new AgentRuntime(this.simWorld, this.registry);
    this.runtime.attachTo(this.kernel);

    for (const place of VILLAGE_LAYOUT.places) {
      this.simWorld.definePlace(place.name, place.x, place.z, place.radius);
    }
    for (const obj of VILLAGE_LAYOUT.objects) {
      this.simWorld.spawn(obj.type, obj.x, obj.z);
    }
    for (const agent of VILLAGE_LAYOUT.agents) {
      this.runtime.addAgent(
        { id: agent.id, name: agent.name, tribe: agent.tribe, role: agent.role },
        agent.x,
        agent.z
      );
    }
    // Day one starts with the fires lit, as the village always did.
    for (const fire of this.simWorld.objectsNear(0, 0, 1000)) {
      if (fire.type === 'campfire') fire.state.lit = 1;
    }

    this.weather.onChange((state, tick) => {
      this.emit({ tick, kind: 'weather', text: WEATHER_LABELS[state] ?? state });
    });
  }

  update(delta: number): void {
    this.kernel.advance(Math.min(delta, 0.25));

    const day = Math.floor(this.kernel.tick / TICKS_PER_DAY);
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.emit({
        tick: this.kernel.tick,
        kind: 'day',
        text: `🌅 L'aube du jour ${day + 1} se lève sur les trois tribus.`,
      });
    }

    for (const event of this.runtime.drainEvents()) {
      const narrated = this.narrate(event);
      if (narrated !== null) this.emit(narrated);
    }
  }

  private narrate(event: ActionEvent): SimEvent | null {
    if (event.type === 'started') return null; // completions tell the story
    const agent = this.runtime.agents.get(event.agentId);
    const name = agent?.profile.name ?? event.agentId;
    const label = VERB_LABELS[event.verb] ?? event.verb;
    if (event.type === 'failed') {
      return {
        tick: event.tick,
        kind: 'action',
        agentName: name,
        text: `⚠️ ${name} échoue (${label}) — le monde a changé derrière son dos.`,
      };
    }
    return { tick: event.tick, kind: 'action', agentName: name, text: `${name} ${label}.` };
  }

  private emit(event: SimEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(cb: (e: SimEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  // --- HUD actions (all wired to real engine state) ---

  forceRain(): void {
    this.weather.force('storm', this.kernel.tick, this.simWorld);
  }

  forceClear(): void {
    this.weather.force('clear', this.kernel.tick, this.simWorld);
  }

  grantBlessing(): void {
    for (const obj of this.simWorld.objectsNear(0, 0, 1000)) {
      const def = this.registry.get(obj.type);
      for (const rule of def.regrowth ?? []) {
        obj.state[rule.field] = rule.max;
      }
      if (obj.type === 'camp_storage') {
        obj.state.berries = (obj.state.berries ?? 0) + 8;
        obj.state.wood = (obj.state.wood ?? 0) + 4;
      }
    }
    this.emit({
      tick: this.kernel.tick,
      kind: 'action',
      text: '✨ Bénédiction : les buissons regorgent de baies, les réserves débordent.',
    });
  }

  hourOfDaySim(): number {
    return hourOfDay(this.kernel.tick);
  }

  dayIndex(): number {
    return Math.floor(this.kernel.tick / TICKS_PER_DAY) + 1;
  }
}
```

- [ ] **Step 3 : Vérifier** — `pnpm --filter @iwsdk/cardinal-simulation build && pnpm --filter @iwsdk/plugin-phoenix-demo typecheck`
Expected : 0 erreur (le système n'est pas encore enregistré — c'est la tâche 5).

- [ ] **Step 4 : Commit**

```bash
git add apps/demo/src/simulation/layout.ts apps/demo/src/simulation/CardinalSimulationSystem.ts
git commit -m "feat(demo): village layout single-source and engine adapter system

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : Avatars visibles + projection des vues

**Files:**
- Create: `apps/demo/src/simulation/AgentAvatarFactory.ts`
- Modify: `apps/demo/src/simulation/CardinalSimulationSystem.ts` (projection par frame)
- Modify: `apps/demo/src/simulation/PrehistoricEnvironment3D.ts` (signature layout, suppression avatars/loup/colliders agents)
- Verify: typecheck démo

**Interfaces:**
- Consumes: `AgentView` (`animation`, `x/y/z`, `heading`, `verb`), `VILLAGE_LAYOUT`.
- Produces (AgentAvatarFactory.ts) :
  - `function createAgentAvatar(name: string, color: number, gender: 'masculine' | 'feminine'): Group` — silhouette visible : corps capsule (cylindre + calotte), tête sphère, teinte tribu ; `group.name = 'Avatar_' + name` ; hauteur ~1,7 m (1,6 féminin).
  - `function applyAvatarPose(avatar: Group, animation: AgentView['animation'], timeSeconds: number): void` — poses procédurales sans allocation : `walk` = bob vertical sinusoïdal (±3 cm à 8 Hz) ; `gather`/`craft` = buste incliné (rotation.x ≈ 0.5) et léger accroupissement (scale.y 0.92) ; `rest` = accroupi (scale.y 0.7) ; `sleep` = allongé (rotation.x = −π/2, y abaissé) ; `idle` = pose neutre. La fonction remet TOUJOURS la pose neutre avant d'appliquer l'état courant (pas d'accumulation).
- Produces (PrehistoricEnvironment3D) : `createWorldScene(world: World, layout: typeof VILLAGE_LAYOUT): PrehistoricSceneResult` — les campements sont construits depuis `layout.settlements`/`layout.objects` (feux, abris, buissons, silex, monolithes conservés visuellement) ; `agentAvatars` construit depuis `layout.agents` via la factory ; **supprimés** : le loup (mesh + entité), les colliders capsules par agent, le paramètre `tribes`/import `TribeData`, l'import `RPMAvatarRig`.
- Produces (CardinalSimulationSystem) : dans `update()`, après `advance` : pour chaque `view` de `runtime.views()` → positionner le Group (`position.set(view.x, view.y, view.z)`, `rotation.y = view.heading`), appeler `applyAvatarPose(avatar, view.animation, elapsed)` ; synchroniser chaque flamme de feu : `PrehistoricEnvironment3D.setCampfireLit(fireGroup, litState === 1)` en retrouvant l'objet moteur `campfire` le plus proche du groupe visuel. Le système reçoit la scène via une méthode `attachScene(sceneData: PrehistoricSceneResult): void` (appelée depuis `index.ts` après construction).

- [ ] **Step 1 : Écrire `AgentAvatarFactory.ts`**

```ts
/**
 * Visible stylized villager avatars (étape 3). Full RPM GLB rigs arrive with
 * étape 4 (dialogue + lipsync); this factory keeps the same semantic
 * animation contract (AgentView.animation) so the swap is renderer-only.
 */
import {
  Group,
  Mesh,
  CylinderGeometry,
  SphereGeometry,
  MeshStandardMaterial,
  Color,
} from '@iwsdk/core';
import type { AgentView } from '@iwsdk/cardinal-simulation';

export function createAgentAvatar(
  name: string,
  color: number,
  gender: 'masculine' | 'feminine'
): Group {
  const avatar = new Group();
  avatar.name = `Avatar_${name}`;
  const height = gender === 'feminine' ? 1.6 : 1.7;
  const bodyHeight = height * 0.62;
  const bodyRadius = gender === 'feminine' ? 0.16 : 0.19;

  const skinMat = new MeshStandardMaterial({ color: 0xc68863, roughness: 0.8 });
  const clothMat = new MeshStandardMaterial({ color, roughness: 0.85 });

  const body = new Mesh(new CylinderGeometry(bodyRadius, bodyRadius * 0.8, bodyHeight, 10), clothMat);
  body.name = 'body';
  body.position.y = bodyHeight * 0.5 + height * 0.08;
  avatar.add(body);

  const head = new Mesh(new SphereGeometry(height * 0.09, 12, 12), skinMat);
  head.name = 'head';
  head.position.y = bodyHeight + height * 0.08 + height * 0.1;
  avatar.add(head);

  const beltMat = new MeshStandardMaterial({
    color: new Color(color).multiplyScalar(0.6),
    roughness: 0.9,
  });
  const belt = new Mesh(new CylinderGeometry(bodyRadius * 1.05, bodyRadius * 1.05, 0.06, 10), beltMat);
  belt.position.y = bodyHeight * 0.55 + height * 0.08;
  avatar.add(belt);

  return avatar;
}

export function applyAvatarPose(
  avatar: Group,
  animation: AgentView['animation'],
  timeSeconds: number
): void {
  // Reset neutral pose first — poses must never accumulate frame to frame.
  avatar.rotation.x = 0;
  avatar.scale.set(1, 1, 1);
  let bob = 0;

  switch (animation) {
    case 'walk':
      bob = Math.sin(timeSeconds * 8) * 0.03;
      break;
    case 'gather':
    case 'craft':
      avatar.rotation.x = 0.5;
      avatar.scale.y = 0.92;
      break;
    case 'rest':
      avatar.scale.y = 0.7;
      break;
    case 'sleep':
      avatar.rotation.x = -Math.PI / 2;
      break;
    case 'idle':
      bob = Math.sin(timeSeconds * 1.5) * 0.008; // subtle breathing
      break;
  }
  avatar.position.y += bob;
}
```

Note d'usage : `applyAvatarPose` est appelée APRÈS `position.set(...)` — le bob s'additionne à la hauteur terrain du frame courant, jamais d'accumulation.

- [ ] **Step 2 : Refactorer `PrehistoricEnvironment3D.createWorldScene`**

- Nouvelle signature : `createWorldScene(world: World, layout: typeof VILLAGE_LAYOUT): PrehistoricSceneResult` (importer `VILLAGE_LAYOUT` en type ; supprimer les imports `TribeData` et `RPMAvatarRig`).
- Les campements itèrent `layout.settlements` (couleur incluse) — les visuels feu/abri/monolithe/buisson/silex restent identiques, aux mêmes offsets qu'aujourd'hui (le layout reprend ces offsets).
- Les avatars itèrent `layout.agents` : `const avatar = createAgentAvatar(a.name, settlementColor(a.tribe), a.gender);` positionné à `(a.x, terrain.getHeight(a.x, a.z), a.z)` **directement dans `root`** (plus dans le groupe de campement — les agents bougent librement) ; `agentAvatars.set(a.id, avatar)`.
- Supprimer : le bloc loup complet (mesh + entité), les entités capsules cinématiques par agent, `createWolfMesh` et `createAgentAvatar` (remplacée par la factory).
- `PrehistoricSceneResult` : retirer `wolfMesh`.

- [ ] **Step 3 : Projection dans `CardinalSimulationSystem`**

Ajouter au système :

```ts
  private sceneData: PrehistoricSceneResult | null = null;
  private elapsed = 0;
  private campfireBindings: Array<{ group: Group; objectId: string }> = [];

  attachScene(sceneData: PrehistoricSceneResult): void {
    this.sceneData = sceneData;
    // Bind each visual campfire to the nearest engine campfire once.
    this.campfireBindings = [];
    for (const [, group] of sceneData.campfires) {
      const world = this.simWorld;
      const near = world
        .objectsNear(group.position.x + (group.parent?.position.x ?? 0),
                     group.position.z + (group.parent?.position.z ?? 0), 3)
        .find((o) => o.type === 'campfire');
      if (near) this.campfireBindings.push({ group, objectId: near.id });
    }
  }
```

et dans `update(delta)`, après le drainage des événements :

```ts
    this.elapsed += delta;
    if (this.sceneData !== null) {
      for (const view of this.runtime.views()) {
        const avatar = this.sceneData.agentAvatars.get(view.id);
        if (avatar === undefined) continue;
        avatar.position.set(view.x, view.y, view.z);
        avatar.rotation.y = view.heading;
        applyAvatarPose(avatar, view.animation, this.elapsed);
      }
      for (const binding of this.campfireBindings) {
        const fire = this.simWorld.get(binding.objectId);
        if (fire) PrehistoricEnvironment3D.setCampfireLit(binding.group, (fire.state.lit ?? 0) === 1);
      }
      this.sceneData.grassField.updateWind(this.elapsed);
      this.sceneData.river.updateWater(this.elapsed);
    }
```

(Les animations d'herbe et d'eau migrent ici depuis l'ancien `PrehistoricWorldSystem` — le décor est animé par le système de rendu, pas par la simulation.)

Imports à ajouter : `applyAvatarPose` depuis `./AgentAvatarFactory`, `PrehistoricEnvironment3D, type PrehistoricSceneResult` depuis `./PrehistoricEnvironment3D`, `type Group` depuis `@iwsdk/core`.

- [ ] **Step 4 : Vérifier** — `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck`
Expected : erreurs UNIQUEMENT dans `PrehistoricWorldSystem.ts` (qui référence encore l'ancienne signature de `createWorldScene`) — c'est attendu, il meurt en tâche 5. S'il n'y a que celles-là, la tâche est bonne. (Ne pas le corriger : il sera supprimé.)

- [ ] **Step 5 : Commit**

```bash
git add apps/demo/src/simulation/AgentAvatarFactory.ts apps/demo/src/simulation/CardinalSimulationSystem.ts apps/demo/src/simulation/PrehistoricEnvironment3D.ts
git commit -m "feat(demo): visible avatar factory and per-frame projection of engine views

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : Ciel céleste continu + pluie visuelle

**Files:**
- Create: `apps/demo/src/simulation/CelestialVisuals.ts`
- Modify: `apps/demo/src/simulation/CardinalSimulationSystem.ts` (création + update)
- Verify: typecheck démo

**Interfaces:**
- Consumes: `hourOfDaySim()`, `weather.current`, la scène Three (`root` du décor).
- Produces: `class CelestialVisuals { constructor(root: Group); update(hour: number, weather: WeatherState, elapsed: number): void; dispose(): void }` :
  - **Soleil** : `DirectionalLight` sur un arc (lever 6 h à l'est, zénith 13 h, coucher 20 h) ; intensité 0 la nuit ; couleur chaude à l'aube/crépuscule.
  - **Lune** : `DirectionalLight` faible bleutée, arc opposé, active la nuit.
  - **Ambiance** : `HemisphereLight` dont l'intensité suit le jour (0.15 nuit → 0.7 midi).
  - **Ciel** : couleur de fond (`root` porte un grand dôme `SphereGeometry` en `BackSide`, ou à défaut un fog + clear color) interpolée dans une palette par heure : nuit `#0b1026` → aube `#f59e0b` → jour `#7ec8f7` → crépuscule `#7c3aed` → nuit. Interpolation continue (pas de sauts), couleurs pré-allouées.
  - **Étoiles** : `Points` (~400 positions aléatoires sur le dôme, générées une fois à la construction — `Math.random()` toléré : décor), opacité 0 le jour → 1 la nuit.
  - **Pluie** : `Points` (~600 gouttes dans un volume 40×12×40 au-dessus du joueur), visible seulement en rain/storm, positions animées vers le bas dans `update` (recyclées en haut), matériau pré-alloué. En storm, ciel assombri (multiplication de la couleur par 0.5).
  - Toutes les allocations au constructeur ; `update` ne crée aucun objet.

- [ ] **Step 1 : Implémenter `CelestialVisuals.ts`** (structure imposée ; le corps suit les spécifications ci-dessus — palette et arcs solaires sont les seules décisions locales, les garder proches des valeurs données) :

```ts
import {
  Group,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  BackSide,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Color,
} from '@iwsdk/core';
import type { WeatherState } from '@iwsdk/cardinal-simulation';

const SKY_STOPS: Array<{ hour: number; color: number }> = [
  { hour: 0, color: 0x0b1026 },
  { hour: 5, color: 0x0b1026 },
  { hour: 7, color: 0xf59e0b },
  { hour: 10, color: 0x7ec8f7 },
  { hour: 16, color: 0x7ec8f7 },
  { hour: 19, color: 0x7c3aed },
  { hour: 21, color: 0x0b1026 },
  { hour: 24, color: 0x0b1026 },
];

export class CelestialVisuals {
  // sun, moon, hemi, skyDome, stars, rain : créés au constructeur,
  // ajoutés à root ; couleurs temporaires pré-allouées (this.tmpColor…).
  // update(hour, weather, elapsed) :
  //  - angle solaire = ((hour - 6) / 14) * PI  (0 = lever, PI = coucher)
  //  - sun.position.set(cos(PI - angle) * 30, sin(angle) * 30, -10), intensité
  //    max(0, sin(angle)) * (weather 'clear' ? 1 : 'cloudy' ? 0.6 : 0.35)
  //  - moon symétrique la nuit, intensité 0.15
  //  - hemi.intensity = 0.15 + max(0, sin(angle)) * 0.55
  //  - couleur ciel = interpolation linéaire entre SKY_STOPS voisins de hour,
  //    assombrie ×0.5 en storm, ×0.75 en rain ; appliquée au dôme
  //  - stars.material.opacity = 1 quand le soleil est couché, 0 sinon (lissé)
  //  - pluie : visible = rain/storm ; chaque goutte y -= 12 * dtApprox,
  //    recyclée à y=12 quand y<0 (dtApprox dérivé de elapsed - lastElapsed)
}
```

L'implémenteur écrit le corps complet en suivant ces formules ; interdiction d'allouer dans `update` (attributs de position mutés en place, `needsUpdate = true`).

- [ ] **Step 2 : Brancher dans `CardinalSimulationSystem`**

Dans `attachScene` : `this.celestial = new CelestialVisuals(sceneData.root);`
Dans `update`, fin de bloc scène : `this.celestial?.update(this.hourOfDaySim(), this.weather.current, this.elapsed);`

- [ ] **Step 3 : Vérifier** — typecheck démo (mêmes erreurs résiduelles attendues dans `PrehistoricWorldSystem.ts` uniquement).

- [ ] **Step 4 : Commit**

```bash
git add apps/demo/src/simulation/CelestialVisuals.ts apps/demo/src/simulation/CardinalSimulationSystem.ts
git commit -m "feat(demo): continuous celestial cycle and weather visuals driven by sim clock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 : HUD v2, câblage index.ts, suppression du théâtre scripté

**Files:**
- Rewrite: `apps/demo/src/simulation/simulation-hud.ts`
- Modify: `apps/demo/src/index.ts`
- Delete: `apps/demo/src/simulation/PrehistoricWorldSystem.ts`, `AgentBrain.ts`, `TribeManager.ts`, `GodModeController.ts`, `types.ts`
- Verify: typecheck démo + suite complète + builds

**Interfaces:**
- Consumes: `CardinalSimulationSystem` (`subscribe`, `forceRain`, `forceClear`, `grantBlessing`, `dayIndex`, `hourOfDaySim`, `weather.current`, `runtime.agents`).
- Produces: `class SimulationHud { constructor(container: HTMLElement, system: CardinalSimulationSystem); dispose(): void }`.

- [ ] **Step 1 : Réécrire `simulation-hud.ts`**

Garder la structure visuelle existante (mêmes styles, même position) en remplaçant la source de données :

- Import : `import type { CardinalSimulationSystem, SimEvent } from './CardinalSimulationSystem';`
- Cartes de stats (mises à jour sur événement ET toutes les ~1 s via `setInterval` conservé dans la classe, nettoyé dans `dispose`) :
  - « JOUR & HEURE » : `Jour ${system.dayIndex()} · ${system.hourOfDaySim().toFixed(0)}h` + icône ☀️/☁️/🌧️/⛈️ selon `system.weather.current`.
  - « POPULATION » : `${system.runtime.agents.size} Âmes`.
  - « FAIM MOYENNE » : moyenne de `needs.hunger` sur les agents, arrondie (`${avg}%`).
- Boutons (seuls les branchés restent) : `🌧️ Tempête` → `system.forceRain()` ; `☀️ Ciel Dégagé` → `system.forceClear()` ; `✨ Bénédiction` → `system.grantBlessing()`. Les boutons décrets et loup sont supprimés (reviennent aux étapes 4 et 6).
- Flux : `system.subscribe((e) => this.addEventToFeed(e))` — bordure ambre pour `kind === 'weather'`, bleue pour `day`, neutre pour `action` ; préfixe `[Jour ${system.dayIndex()}]`.
- En-tête : sous-titre `Moteur Cardinal Simulation · 11 agents autonomes`.

- [ ] **Step 2 : Câbler `index.ts`**

Remplacer le bloc simulation :

```ts
import { CardinalSimulationSystem } from './simulation/CardinalSimulationSystem.js';
import { PrehistoricEnvironment3D } from './simulation/PrehistoricEnvironment3D.js';
import { VILLAGE_LAYOUT } from './simulation/layout.js';
```

et dans le `then` :

```ts
    // 2. Mount the Cardinal simulation engine + its VR projection
    world.registerSystem(CardinalSimulationSystem);
    const simSystem = world.getSystem(CardinalSimulationSystem);
    if (simSystem) {
      const sceneData = PrehistoricEnvironment3D.createWorldScene(world, VILLAGE_LAYOUT);
      (world as any).scene?.add?.(sceneData.root);
      simSystem.attachScene(sceneData);
      new SimulationHud(document.body, simSystem);
    }
```

Supprimer les imports `PrehistoricWorldSystem` (le mount de la scène quitte le système : c'est `index.ts` qui construit le décor et le donne à l'adaptateur).

- [ ] **Step 3 : Supprimer les fichiers morts**

```bash
git rm apps/demo/src/simulation/PrehistoricWorldSystem.ts apps/demo/src/simulation/AgentBrain.ts apps/demo/src/simulation/TribeManager.ts apps/demo/src/simulation/GodModeController.ts apps/demo/src/simulation/types.ts
```

Vérifier qu'aucun autre fichier ne les importe : `grep -rn "PrehistoricWorldSystem\|AgentBrain\|TribeManager\|GodModeController\|simulation/types" apps/demo/src --include="*.ts"` → seul `simulation-hud.ts`/`index.ts` déjà migrés ne doivent plus matcher.

- [ ] **Step 4 : Vérification complète**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck` (0 erreur, plus aucune erreur résiduelle), puis à la racine `pnpm typecheck && pnpm test && pnpm build && pnpm demo:build`.
Expected : tout vert — le moteur (tests weather inclus), les 3 paquets, le build Vite de la démo.

- [ ] **Step 5 : Commit**

```bash
git add -A apps/demo/src
git commit -m "refactor(demo): replace scripted prehistoric theater with cardinal simulation engine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Couverture spec (auto-contrôle)

| Exigence spec | Tâche(s) |
| :--- | :--- |
| Météo simulée seedée, pluie éteint les feux (§10.2) | 1 |
| La démo = client de rendu du moteur (§3, §13.3) | 2, 3, 5 |
| Vrai delta de frame → `kernel.advance` (§8.1) | 2 |
| Source unique layout monde/visuels (§3 principe 3) | 2, 3 |
| Projection `{position, orientation, animation}` sur avatars (§6.5) | 3 |
| Cycle céleste continu aube→nuit étoilée (§10.1) | 4 |
| Météo visuelle (pluie, ciel assombri) (§10.2) | 4 |
| HUD branché sur les vrais événements ; interventions réelles (§13.3) | 5 |
| Suppression de `apps/demo/src/simulation/*` scripté (§13.3) | 5 |

Hors périmètre étape 3 (étapes suivantes) : rigs RPM/GLB complets et lipsync (étape 4, avec les dialogues), Mode-2 LLM/mémoire/BFF (étape 4), télémétrie JSONL et headless batch (étape 5), loup/faune/joueur perçu (étape 6). La QA visuelle en casque/navigateur (`pnpm demo`) est manuelle — le plan garantit typecheck/build/tests, pas le goût du coucher de soleil.
