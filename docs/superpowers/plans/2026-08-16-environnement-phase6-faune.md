# Phase 6 — Faune et matériels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre visible ce que la simulation fait déjà — l'abri qui se construit, le buisson qui s'épuise, le silex entamé, les provisions qui montent — et poser l'interface par laquelle tout animal du moteur se projette dans la scène.

**Architecture:** Une fonction pure traduit l'état d'un smart object en **paramètres visuels** (étape de construction, taux de remplissage, taille de flamme) ; un système ECS mince applique ces paramètres aux objets de la scène en montrant, masquant et redimensionnant des enfants nommés. La faune suit le même principe : le moteur expose une vue, le rendu la projette, et rien dans le rendu ne connaît le loup en particulier.

**Tech Stack:** TypeScript strict, vitest, `@iwsdk/core` (Three).

**Spec:** `docs/superpowers/specs/2026-08-16-environnement-procedural-ecs-design.md` (§8 faune, §9 matériels, §11 phase 6)

## Global Constraints

- **La traduction état → visuel est PURE et testée.** Le système ECS ne fait qu'appliquer ; c'est ce qui a permis à `packages/world` d'atteindre 141 tests sur du rendu.
- **Ne jamais allouer dans `update()`** ; `entity.dispose()`, jamais `destroy()`.
- **Importer Three depuis `@iwsdk/core`**, jamais depuis `three`.
- **Budget : 500 000 triangles visibles**, dont 362 000 déjà pris par le terrain et la flore. Cette phase ne doit pas ajouter de géométrie : elle montre et masque ce qui existe.
- **Le rendu ne connaît aucun animal en particulier.** La spec §8 borne le périmètre : « uniquement l'interface de projection — le rendu sait afficher tout animal exposant une vue. »
- TypeScript strict avec `noUncheckedIndexedAccess`.

## État constaté avant de commencer

| Fait | Valeur |
| :--- | :--- |
| États de smart objects reflétés à l'écran | **un seul** : `campfire.lit` |
| États existants et invisibles | `shelter.progress` 0→5, `berry_bush.berriesLeft` 0→12, `flint_deposit.flintLeft` 0→6, `oak_tree.woodLeft` 0→8, `campfire.fuel` |
| Rendu du loup | `WolfVisual.ts`, 63 lignes, câblé à la main dans `CardinalSimulationSystem` |
| Vue exposée par le moteur | `{ x, y, z, heading, mode }` |

---

## File Structure

| Fichier | Responsabilité |
| :--- | :--- |
| `packages/world/src/objects/visualState.ts` **(créé)** | Pur, sans Three : traduit l'état d'un smart object en paramètres visuels. Toute la logique de la phase vit ici. |
| `packages/world/src/objects/components.ts` **(créé)** | Composants `SmartObjectVisual` et `AnimalVisual`. |
| `packages/world/src/objects/SmartObjectVisualSystem.ts` **(créé)** | Applique les paramètres : montre, masque, redimensionne des enfants nommés. |
| `packages/world/src/objects/FaunaSystem.ts` **(créé)** | Projette toute vue d'animal — position, cap, animation. Ne connaît aucune espèce. |
| `packages/world/src/install.ts` **(modifié)** | Enregistre composants et systèmes. |
| `apps/demo/src/simulation/PrehistoricEnvironment3D.ts` **(modifié)** | Nomme les enfants que le système pilote. |
| `apps/demo/src/simulation/WolfVisual.ts` **(supprimé)** | Remplacé par l'interface de projection. |

**Pourquoi une fonction pure au centre.** « Un buisson à moitié cueilli montre la moitié de ses baies » est une règle, pas un dessin. Isolée, elle se vérifie sans GPU ; mêlée au code de scène, elle ne se vérifierait qu'à l'œil.

---

### Task 1: La traduction de l'état en paramètres visuels

**Files:**
- Create: `packages/world/src/objects/visualState.ts`
- Test: `packages/world/test/visual-state.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `interface ObjectVisualState { stage: number; stageCount: number; fill: number; lit: boolean; flame: number }`
  - `visualStateFor(type: string, state: Readonly<Record<string, number>>): ObjectVisualState`
  - `VISUAL_TYPES: readonly string[]`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/visual-state.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { visualStateFor, VISUAL_TYPES } from '../src/objects/visualState';

describe('visualStateFor', () => {
  it("rend un état neutre pour un type qu'il ne connaît pas", () => {
    // Un type inconnu ne doit rien casser : il s'affiche tel qu'il a été bâti.
    const v = visualStateFor('inconnu', {});
    expect(v.stage).toBe(0);
    expect(v.stageCount).toBe(1);
    expect(v.fill).toBe(1);
  });

  it('rend un remplissage borné à [0, 1] quel que soit l\'état', () => {
    // Les états viennent du moteur ; une régénération pourrait les dépasser.
    for (const type of VISUAL_TYPES) {
      for (const value of [-5, 0, 3, 999]) {
        const v = visualStateFor(type, {
          berriesLeft: value,
          flintLeft: value,
          woodLeft: value,
          progress: value,
          fuel: value,
          berries: value,
          wood: value,
        });
        expect(v.fill, `${type} à ${value}`).toBeGreaterThanOrEqual(0);
        expect(v.fill, `${type} à ${value}`).toBeLessThanOrEqual(1);
      }
    }
  });

  describe('abri', () => {
    it('SUIT LA CONSTRUCTION, étape par étape', () => {
      // progress va de 0 à 5 dans le moteur ; la construction doit se voir
      // avancer, sans quoi bâtir ne produit aucun retour visible.
      const stages = [0, 1, 2, 3, 4, 5].map((p) => visualStateFor('shelter', { progress: p }).stage);
      expect(stages).toEqual([0, 1, 2, 3, 4, 5]);
      expect(visualStateFor('shelter', { progress: 0 }).stageCount).toBe(6);
    });

    it('ne dépasse pas la dernière étape même si le moteur va plus loin', () => {
      expect(visualStateFor('shelter', { progress: 9 }).stage).toBe(5);
    });
  });

  describe('foyer', () => {
    it("n'est allumé que lorsque le moteur le dit", () => {
      expect(visualStateFor('campfire', { lit: 0, fuel: 5 }).lit).toBe(false);
      expect(visualStateFor('campfire', { lit: 1, fuel: 5 }).lit).toBe(true);
    });

    it('porte une flamme dont la taille suit le combustible', () => {
      const low = visualStateFor('campfire', { lit: 1, fuel: 1 }).flame;
      const high = visualStateFor('campfire', { lit: 1, fuel: 10 }).flame;
      expect(high).toBeGreaterThan(low);
      expect(low).toBeGreaterThan(0);
    });

    it("n'a aucune flamme quand il est éteint", () => {
      expect(visualStateFor('campfire', { lit: 0, fuel: 10 }).flame).toBe(0);
    });
  });

  describe('ressources qui s\'épuisent', () => {
    it('vide le buisson à mesure des cueillettes', () => {
      expect(visualStateFor('berry_bush', { berriesLeft: 12 }).fill).toBe(1);
      expect(visualStateFor('berry_bush', { berriesLeft: 6 }).fill).toBeCloseTo(0.5, 6);
      expect(visualStateFor('berry_bush', { berriesLeft: 0 }).fill).toBe(0);
    });

    it('entame l\'affleurement de silex', () => {
      expect(visualStateFor('flint_deposit', { flintLeft: 6 }).fill).toBe(1);
      expect(visualStateFor('flint_deposit', { flintLeft: 3 }).fill).toBeCloseTo(0.5, 6);
    });

    it('dégarnit le chêne', () => {
      expect(visualStateFor('oak_tree', { woodLeft: 8 }).fill).toBe(1);
      expect(visualStateFor('oak_tree', { woodLeft: 2 }).fill).toBeCloseTo(0.25, 6);
    });
  });

  describe('provisions', () => {
    it('MONTE AVEC LA RÉSERVE, baies et bois confondus', () => {
      // Le tas de provisions doit refléter ce que le village a mis de côté :
      // c'est le seul retour visible sur une journée de cueillette.
      const empty = visualStateFor('camp_storage', { berries: 0, wood: 0 }).fill;
      const some = visualStateFor('camp_storage', { berries: 4, wood: 2 }).fill;
      const full = visualStateFor('camp_storage', { berries: 20, wood: 20 }).fill;
      expect(empty).toBe(0);
      expect(some).toBeGreaterThan(empty);
      expect(full).toBeGreaterThan(some);
    });
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test visual-state`
Expected: FAIL — `Failed to resolve import "../src/objects/visualState"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `packages/world/src/objects/visualState.ts` :

```ts
/**
 * Traduction de l'état d'un smart object en paramètres visuels (spec §9).
 *
 * Pure et sans Three : « un buisson à moitié cueilli montre la moitié de ses
 * baies » est une RÈGLE, pas un dessin. Isolée, elle se vérifie sans GPU ;
 * mêlée au code de scène, elle ne se vérifierait qu'à l'œil.
 */

export interface ObjectVisualState {
  /** Étape de construction, de 0 à `stageCount - 1`. */
  readonly stage: number;
  readonly stageCount: number;
  /** Taux de remplissage dans [0, 1] : baies restantes, provisions, silex. */
  readonly fill: number;
  readonly lit: boolean;
  /** Taille relative de la flamme dans [0, 1] ; 0 quand le foyer est éteint. */
  readonly flame: number;
}

/** Maxima déclarés par le contenu du moteur (`content/objects.ts`). */
const MAX = {
  berriesLeft: 12,
  flintLeft: 6,
  woodLeft: 8,
  shelterProgress: 5,
  campfireFuel: 12,
  storage: 30,
} as const;

export const VISUAL_TYPES: readonly string[] = [
  'shelter',
  'campfire',
  'berry_bush',
  'flint_deposit',
  'oak_tree',
  'camp_storage',
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const NEUTRAL: ObjectVisualState = { stage: 0, stageCount: 1, fill: 1, lit: false, flame: 0 };

export function visualStateFor(
  type: string,
  state: Readonly<Record<string, number>>,
): ObjectVisualState {
  switch (type) {
    case 'shelter': {
      const progress = Math.max(0, Math.min(MAX.shelterProgress, state.progress ?? 0));
      return {
        stage: Math.round(progress),
        stageCount: MAX.shelterProgress + 1,
        fill: clamp01(progress / MAX.shelterProgress),
        lit: false,
        flame: 0,
      };
    }
    case 'campfire': {
      const lit = (state.lit ?? 0) >= 1;
      const fuel = clamp01((state.fuel ?? 0) / MAX.campfireFuel);
      return {
        stage: 0,
        stageCount: 1,
        fill: fuel,
        lit,
        // Une flamme ne s'éteint pas d'un coup faute de bûches : elle rétrécit.
        flame: lit ? 0.45 + 0.55 * fuel : 0,
      };
    }
    case 'berry_bush':
      return { ...NEUTRAL, fill: clamp01((state.berriesLeft ?? 0) / MAX.berriesLeft) };
    case 'flint_deposit':
      return { ...NEUTRAL, fill: clamp01((state.flintLeft ?? 0) / MAX.flintLeft) };
    case 'oak_tree':
      return { ...NEUTRAL, fill: clamp01((state.woodLeft ?? 0) / MAX.woodLeft) };
    case 'camp_storage':
      return {
        ...NEUTRAL,
        fill: clamp01(((state.berries ?? 0) + (state.wood ?? 0)) / MAX.storage),
      };
    default:
      // Un type inconnu s'affiche tel qu'il a été bâti : ne rien casser vaut
      // mieux que masquer un objet dont on ignore la forme.
      return NEUTRAL;
  }
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test visual-state`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/world/src/objects/visualState.ts packages/world/test/visual-state.test.ts
git commit -m "feat(world): pure translation of smart object state into visual parameters"
```

---

### Task 2: L'application aux objets de la scène

**Files:**
- Create: `packages/world/src/objects/components.ts`
- Create: `packages/world/src/objects/SmartObjectVisualSystem.ts`
- Modify: `packages/world/src/install.ts`
- Modify: `packages/world/src/index.ts`
- Test: `packages/world/test/smart-object-visual.test.ts`

**Interfaces:**
- Consumes: `visualStateFor`, `ObjectVisualState` de la tâche 1.
- Produces:
  - `SmartObjectVisual` — composant elics : `objectType` (`Types.String`), `stage`, `fill`, `flame` (`Types.Float32`), `lit` (`Types.Boolean`)
  - `SmartObjectVisualSystem` avec `appliedCount: number`
  - Convention de nommage des enfants : `from<N>`, `fill`, `flame`

**La convention qui relie les deux mondes.** Le système ne construit aucune géométrie : il montre l'enfant `from3` dès que l'avancement atteint 3, met `fill` à l'échelle, allume `flame`.

Le nommage est **cumulatif** et non alternatif, parce qu'une construction l'est : les perches restent quand le toit arrive. `from1` désigne ce qui apparaît à la première étape et ne disparaît plus. C'est ce qui permet de n'ajouter aucune géométrie — l'abri de la démo possède déjà ses perches et son toit, il ne leur manquait qu'un nom.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/smart-object-visual.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { SmartObjectVisual } from '../src/objects/components';
import { SmartObjectVisualSystem } from '../src/objects/SmartObjectVisualSystem';

/** Un objet de scène minimal, avec les enfants que la convention prévoit. */
function makeObject(names: string[]) {
  const children = names.map((name) => ({
    name,
    visible: true,
    scale: { x: 1, y: 1, z: 1, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
  }));
  return {
    children,
    traverse(fn: (o: unknown) => void) {
      fn(this);
      for (const c of children) fn(c);
    },
  };
}

function makeRig(names: string[], type: string) {
  const world = new World();
  world.registerComponent(SmartObjectVisual);
  world.registerSystem(SmartObjectVisualSystem);
  const system = world.getSystem(SmartObjectVisualSystem) as SmartObjectVisualSystem;
  const object = makeObject(names);
  const entity = world.createEntity();
  (entity as unknown as { object3D: unknown }).object3D = object;
  entity.addComponent(SmartObjectVisual, { objectType: type, stage: 0, fill: 1, flame: 0, lit: false });
  return { world, system, entity, object };
}

describe('SmartObjectVisualSystem', () => {
  it('MONTRE CE QUI EST DÉJÀ BÂTI, ET RIEN DE PLUS', () => {
    // Une construction est cumulative : les perches restent quand le toit
    // arrive. Montrer une seule étape à la fois ferait disparaître le bas de
    // l'abri à mesure qu'on le termine.
    const rig = makeRig(['from1', 'from3', 'from5'], 'shelter');
    rig.entity.setValue(SmartObjectVisual, 'stage', 3);
    rig.system.update(0.016, 0);
    expect(rig.object.children.map((c) => c.visible)).toEqual([true, true, false]);
  });

  it("ne montre rien d'un chantier pas commencé", () => {
    const rig = makeRig(['from1', 'from3', 'from5'], 'shelter');
    rig.entity.setValue(SmartObjectVisual, 'stage', 0);
    rig.system.update(0.016, 0);
    expect(rig.object.children.map((c) => c.visible)).toEqual([false, false, false]);
  });

  it("montre tout l'abri une fois terminé", () => {
    const rig = makeRig(['from1', 'from3', 'from5'], 'shelter');
    rig.entity.setValue(SmartObjectVisual, 'stage', 5);
    rig.system.update(0.016, 0);
    expect(rig.object.children.map((c) => c.visible)).toEqual([true, true, true]);
  });

  it("met l'enfant `fill` à l'échelle de la réserve", () => {
    const rig = makeRig(['fill'], 'berry_bush');
    rig.entity.setValue(SmartObjectVisual, 'fill', 0.25);
    rig.system.update(0.016, 0);
    expect(rig.object.children[0]!.scale.y).toBeCloseTo(0.25, 6);
  });

  it("MASQUE le remplissage quand il ne reste rien", () => {
    // Un buisson vide qui garde ses baies à l'échelle zéro reste un artefact
    // visible d'un pixel ; mieux vaut le cacher franchement.
    const rig = makeRig(['fill'], 'berry_bush');
    rig.entity.setValue(SmartObjectVisual, 'fill', 0);
    rig.system.update(0.016, 0);
    expect(rig.object.children[0]!.visible).toBe(false);
  });

  it("n'allume la flamme que lorsque le foyer est allumé", () => {
    const rig = makeRig(['flame'], 'campfire');
    rig.system.update(0.016, 0);
    expect(rig.object.children[0]!.visible).toBe(false);

    rig.entity.setValue(SmartObjectVisual, 'lit', true);
    rig.entity.setValue(SmartObjectVisual, 'flame', 0.8);
    rig.system.update(0.016, 0.016);
    expect(rig.object.children[0]!.visible).toBe(true);
    expect(rig.object.children[0]!.scale.y).toBeCloseTo(0.8, 6);
  });

  it("survit à un objet dépourvu des enfants attendus", () => {
    // Tous les objets de la scène ne suivent pas la convention, et ce n'est
    // pas une raison pour faire tomber la frame.
    const rig = makeRig(['autre_chose'], 'shelter');
    expect(() => rig.system.update(0.016, 0)).not.toThrow();
    expect(rig.system.appliedCount).toBe(1);
  });

  it("survit à une entité sans objet de scène", () => {
    const world = new World();
    world.registerComponent(SmartObjectVisual);
    world.registerSystem(SmartObjectVisualSystem);
    const system = world.getSystem(SmartObjectVisualSystem) as SmartObjectVisualSystem;
    const entity = world.createEntity();
    entity.addComponent(SmartObjectVisual, { objectType: 'shelter' });
    expect(() => system.update(0.016, 0)).not.toThrow();
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test smart-object-visual`
Expected: FAIL — les modules n'existent pas.

- [ ] **Step 3: Écrire le composant**

Créer `packages/world/src/objects/components.ts` :

```ts
import { Types, createComponent } from '@iwsdk/core';

/**
 * L'état visible d'un smart object (spec §9). Les valeurs sont écrites par
 * l'application depuis l'état du moteur, via `visualStateFor`.
 */
export const SmartObjectVisual = createComponent(
  'SmartObjectVisual',
  {
    objectType: { type: Types.String, default: '' },
    stage: { type: Types.Float32, default: 0 },
    fill: { type: Types.Float32, default: 1 },
    flame: { type: Types.Float32, default: 0 },
    lit: { type: Types.Boolean, default: false },
  },
  'Visible state of a simulated object',
);

/**
 * Un animal projeté depuis le moteur (spec §8).
 *
 * Le rendu ne connaît AUCUNE espèce : il projette toute vue exposant une
 * position, un cap et une animation.
 */
export const AnimalVisual = createComponent(
  'AnimalVisual',
  {
    x: { type: Types.Float32, default: 0 },
    y: { type: Types.Float32, default: 0 },
    z: { type: Types.Float32, default: 0 },
    heading: { type: Types.Float32, default: 0 },
    animation: { type: Types.String, default: 'idle' },
  },
  'Projected view of an engine animal',
);
```

- [ ] **Step 4: Écrire le système**

Créer `packages/world/src/objects/SmartObjectVisualSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import { SmartObjectVisual } from './components';

/**
 * Applique l'état visible d'un smart object (spec §9).
 *
 * Ce système ne construit AUCUNE géométrie : il montre l'enfant nommé
 * `stage<N>`, masque les autres, met `fill` et `flame` à l'échelle. La
 * convention de nommage est le contrat avec le constructeur de scène — c'est
 * ce qui permet de faire évoluer l'un sans toucher l'autre.
 */
interface SceneChild {
  name?: string;
  visible?: boolean;
  scale?: { set: (x: number, y: number, z: number) => void };
}

export class SmartObjectVisualSystem extends createSystem({
  visuals: { required: [SmartObjectVisual] },
}) {
  public appliedCount = 0;

  public override update(_delta: number, _time: number): void {
    this.appliedCount = 0;
    for (const entity of this.queries.visuals.entities) {
      const object = (entity as unknown as { object3D?: { traverse?: (fn: (o: SceneChild) => void) => void } })
        .object3D;
      if (object?.traverse === undefined) continue;

      const stage = Math.round(entity.getValue(SmartObjectVisual, 'stage') ?? 0);
      const fill = entity.getValue(SmartObjectVisual, 'fill') ?? 1;
      const flame = entity.getValue(SmartObjectVisual, 'flame') ?? 0;
      const lit = entity.getValue(SmartObjectVisual, 'lit') === true;

      object.traverse((child: SceneChild) => {
        const name = child.name;
        if (name === undefined || name === '') return;

        // `from<N>` : apparaît à l'étape N et ne disparaît plus. Une
        // construction est cumulative — les perches restent quand le toit
        // arrive.
        if (name.startsWith('from')) {
          const threshold = Number.parseInt(name.slice(4), 10);
          child.visible = Number.isFinite(threshold) && stage >= threshold;
          return;
        }
        if (name === 'fill') {
          child.visible = fill > 0.001;
          child.scale?.set(1, Math.max(0.001, fill), 1);
          return;
        }
        if (name === 'flame') {
          child.visible = lit && flame > 0.001;
          child.scale?.set(1, Math.max(0.001, flame), 1);
        }
      });

      this.appliedCount++;
    }
  }
}
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test smart-object-visual`
Expected: PASS, 8 tests.

- [ ] **Step 6: Enregistrer et exporter**

Dans `packages/world/src/install.ts` : importer `SmartObjectVisual`, `AnimalVisual`, `SmartObjectVisualSystem` ; ajouter les deux composants à la chaîne `registerComponent` ; enregistrer `world.registerSystem(SmartObjectVisualSystem);` après `FloraSystem`.

Réexporter depuis `packages/world/src/index.ts` :

```ts
export { SmartObjectVisual, AnimalVisual } from './objects/components';
export { SmartObjectVisualSystem } from './objects/SmartObjectVisualSystem';
export { visualStateFor, VISUAL_TYPES, type ObjectVisualState } from './objects/visualState';
```

- [ ] **Step 7: Commit**

```bash
git add packages/world/src/objects packages/world/src/install.ts packages/world/src/index.ts \
        packages/world/test/smart-object-visual.test.ts
git commit -m "feat(world): apply smart object state to named scene children"
```

---

### Task 3: L'interface de projection de la faune

**Files:**
- Create: `packages/world/src/objects/FaunaSystem.ts`
- Modify: `packages/world/src/install.ts`
- Modify: `packages/world/src/index.ts`
- Test: `packages/world/test/fauna-projection.test.ts`

**Interfaces:**
- Consumes: `AnimalVisual` de la tâche 2.
- Produces: `FaunaSystem` avec `projectedCount: number`

**Le périmètre, tel que la spec le borne.** §8 : « Périmètre de la présente spécification : uniquement l'interface de projection — le rendu sait afficher tout animal exposant une vue. » Ce système ne connaît donc ni loup, ni troupeau : il lit une position, un cap, une animation, et les pose sur l'objet de scène.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/fauna-projection.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { AnimalVisual } from '../src/objects/components';
import { FaunaSystem } from '../src/objects/FaunaSystem';

function makeRig() {
  const world = new World();
  world.registerComponent(AnimalVisual);
  world.registerSystem(FaunaSystem);
  const system = world.getSystem(FaunaSystem) as FaunaSystem;
  const object = {
    position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
  };
  const entity = world.createEntity();
  (entity as unknown as { object3D: unknown }).object3D = object;
  entity.addComponent(AnimalVisual, { x: 3, y: 1.5, z: -4, heading: 1.2, animation: 'walk' });
  return { world, system, entity, object };
}

describe('FaunaSystem', () => {
  it('POSE L\'ANIMAL LÀ OÙ LE MOTEUR LE DIT', () => {
    // Si le rendu plaçait l'animal ailleurs, le joueur verrait un loup qui
    // n'est pas celui que la simulation fait agir.
    const rig = makeRig();
    rig.system.update(0.016, 0);
    expect(rig.object.position.x).toBeCloseTo(3, 6);
    expect(rig.object.position.y).toBeCloseTo(1.5, 6);
    expect(rig.object.position.z).toBeCloseTo(-4, 6);
  });

  it('oriente l\'animal selon son cap', () => {
    const rig = makeRig();
    rig.system.update(0.016, 0);
    expect(rig.object.rotation.y).toBeCloseTo(1.2, 6);
  });

  it('suit les mises à jour du moteur', () => {
    const rig = makeRig();
    rig.system.update(0.016, 0);
    rig.entity.setValue(AnimalVisual, 'x', -12);
    rig.system.update(0.016, 0.016);
    expect(rig.object.position.x).toBeCloseTo(-12, 6);
  });

  it('compte les animaux projetés', () => {
    const rig = makeRig();
    rig.system.update(0.016, 0);
    expect(rig.system.projectedCount).toBe(1);
  });

  it("NE CONNAÎT AUCUNE ESPÈCE", () => {
    // La spec §8 borne le périmètre à l'interface : un animal quelconque doit
    // se projeter sans que le rendu sache ce qu'il est.
    const source = FaunaSystem.toString();
    expect(source.toLowerCase()).not.toContain('wolf');
    expect(source.toLowerCase()).not.toContain('loup');
  });

  it("survit à une entité sans objet de scène", () => {
    const world = new World();
    world.registerComponent(AnimalVisual);
    world.registerSystem(FaunaSystem);
    const system = world.getSystem(FaunaSystem) as FaunaSystem;
    const entity = world.createEntity();
    entity.addComponent(AnimalVisual, {});
    expect(() => system.update(0.016, 0)).not.toThrow();
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test fauna-projection`
Expected: FAIL — le module n'existe pas.

- [ ] **Step 3: Écrire le système**

Créer `packages/world/src/objects/FaunaSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import { AnimalVisual } from './components';

/**
 * Projette dans la scène toute vue d'animal exposée par le moteur (spec §8).
 *
 * Ce système ne connaît AUCUNE espèce, et c'est délibéré : la spec borne son
 * périmètre à l'interface de projection. Les troupeaux que l'écologie fournira
 * s'afficheront sans qu'une ligne change ici.
 */
interface Placeable {
  position?: { set: (x: number, y: number, z: number) => void };
  rotation?: { set: (x: number, y: number, z: number) => void };
}

export class FaunaSystem extends createSystem({
  animals: { required: [AnimalVisual] },
}) {
  public projectedCount = 0;

  public override update(_delta: number, _time: number): void {
    this.projectedCount = 0;
    for (const entity of this.queries.animals.entities) {
      const object = (entity as unknown as { object3D?: Placeable }).object3D;
      if (object === undefined) continue;

      object.position?.set(
        entity.getValue(AnimalVisual, 'x') ?? 0,
        entity.getValue(AnimalVisual, 'y') ?? 0,
        entity.getValue(AnimalVisual, 'z') ?? 0,
      );
      object.rotation?.set(0, entity.getValue(AnimalVisual, 'heading') ?? 0, 0);
      this.projectedCount++;
    }
  }
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test fauna-projection`
Expected: PASS, 6 tests.

- [ ] **Step 5: Enregistrer et exporter**

Dans `packages/world/src/install.ts`, enregistrer `world.registerSystem(FaunaSystem);` après `SmartObjectVisualSystem`, et l'ajouter à la valeur de retour sous `fauna`.

Réexporter depuis `packages/world/src/index.ts` :

```ts
export { FaunaSystem } from './objects/FaunaSystem';
```

- [ ] **Step 6: Commit**

```bash
git add packages/world/src/objects/FaunaSystem.ts packages/world/src/install.ts \
        packages/world/src/index.ts packages/world/test/fauna-projection.test.ts
git commit -m "feat(world): project any engine animal, knowing no species"
```

---

### Task 4: Le branchement de la démo

**Files:**
- Modify: `apps/demo/src/simulation/PrehistoricEnvironment3D.ts` (nommage des enfants)
- Modify: `apps/demo/src/simulation/CardinalSimulationSystem.ts` (écriture des états)
- Delete: `apps/demo/src/simulation/WolfVisual.ts`

**Interfaces:**
- Consumes: `SmartObjectVisual`, `AnimalVisual`, `visualStateFor` de `@iwsdk/cardinal-world`.
- Produces: rien.

- [ ] **Step 1: Nommer les enfants selon la convention**

Dans `apps/demo/src/simulation/PrehistoricEnvironment3D.ts` :

- pour le foyer, nommer `flame` le maillage de flamme, qui existe déjà et que `setCampfireLit` pilotait à la main ;
- pour l'abri, nommer les parties existantes selon l'étape à laquelle elles apparaissent : `from1` pour la première perche, `from2` pour la seconde, `from4` pour le toit. **Aucune géométrie n'est ajoutée** — l'abri possède déjà ces pièces, il ne leur manquait qu'un nom, et le nommage cumulatif fait le reste ;
- pour le buisson, le chêne, l'affleurement de silex et le tas de provisions, nommer `fill` le maillage dont le volume doit suivre la réserve.

Supprimer ensuite la méthode `setCampfireLit` : le système la remplace.

- [ ] **Step 2: Écrire les états depuis le moteur**

Dans `apps/demo/src/simulation/CardinalSimulationSystem.ts`, là où `setCampfireLit` était appelé, écrire les composants pour chaque objet lié :

```ts
      const visual = visualStateFor(object.type, object.state);
      entity.setValue(SmartObjectVisual, 'objectType', object.type);
      entity.setValue(SmartObjectVisual, 'stage', visual.stage);
      entity.setValue(SmartObjectVisual, 'fill', visual.fill);
      entity.setValue(SmartObjectVisual, 'flame', visual.flame);
      entity.setValue(SmartObjectVisual, 'lit', visual.lit);
```

et, pour le loup, remplacer `WolfVisual` par l'écriture de la vue :

```ts
      const view = this.wolf.view();
      wolfEntity.setValue(AnimalVisual, 'x', view.x);
      wolfEntity.setValue(AnimalVisual, 'y', view.y);
      wolfEntity.setValue(AnimalVisual, 'z', view.z);
      wolfEntity.setValue(AnimalVisual, 'heading', view.heading);
      wolfEntity.setValue(AnimalVisual, 'animation', view.mode);
```

Puis : `git rm apps/demo/src/simulation/WolfVisual.ts`

- [ ] **Step 3: Vérification complète**

Run:
```bash
pnpm --filter @iwsdk/cardinal-world build && pnpm typecheck && pnpm test \
  && pnpm build && pnpm --filter @iwsdk/plugin-phoenix-demo build
```
Expected: 0 erreur de type ; suite verte (le total passe d'environ 665 à environ 688) ; 18 paquets ; build démo OK.

- [ ] **Step 4: Vérification en session réelle**

```bash
cd apps/demo && npx iwsdk dev up
```

Après `browserCommandReady: true`, **laisser la simulation tourner** — c'est elle qui fait bouger les états — puis relever et **rapporter honnêtement** :

1. La console (`npx iwsdk browser logs`, `count` seul, jamais `level`).
2. `npx iwsdk ecs find --input-json '{"withComponents":["SmartObjectVisual"],"limit":40}'` : autant que d'objets liés.
3. **Faire avancer un abri** : relever `shelter.progress` dans l'état du moteur, puis vérifier qu'une pièce `from<N>` supplémentaire est devenue visible. C'est la seule preuve que la construction se voit avancer.
4. Le loup se déplace et s'oriente.
5. `npx iwsdk scene render-stats` : les triangles ne doivent **pas** monter — cette phase montre et masque, elle n'ajoute rien.

Arrêter : `npx iwsdk dev down`

- [ ] **Step 5: Commit**

```bash
git add -A apps
git commit -m "feat(demo): the village shows what the simulation does"
```

---

## Ce que la phase 6 ne fait PAS

- **Pas de `three-bvh-csg`.** La spec §9 l'évoque pour les ouvertures d'abris et les lames de silex sculptées ; c'est une dépendance et de la géométrie neuve, hors du budget de cette phase qui ne fait que montrer et masquer.
- **Pas de nuées d'ambiance.** Oiseaux et insectes relèvent de la faune d'ambiance, sans existence dans le moteur.
- **Pas d'animation d'animal.** Le champ `animation` est transporté et posé ; aucun squelette ne le consomme encore.
- **Pas de troupeaux.** Le loup reste le seul animal de vérité terrain jusqu'à l'écologie.
- **Pas d'ombres portées par la flamme.** La lumière du foyer ne varie pas avec le combustible.
