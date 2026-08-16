# Phase 3C — Hydrologie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la rainure sinusoïdale par un vrai cours d'eau qui descend de la crête jusqu'à la mer en creusant sa vallée, sans déloger le village ni lui retirer l'accès à l'eau.

**Architecture:** Tout vit dans `packages/simulation/src/world/flow.ts`, en mathématiques pures. Le cours est une **polyligne déterministe** calculée une fois et mémorisée : tronçon épinglé sur la formule historique dans la zone simulée, puis descente par plus forte pente jusqu'à la mer, avec altitude forcée décroissante vers l'aval. `heightAt` ne fait plus que **creuser** le terrain jusqu'à cette polyligne — jamais le remonter. Une grille de hachage rend la proximité au cours consultable en temps constant, `isRiverAt` étant appelé par agent et par tick.

**Tech Stack:** TypeScript strict, vitest, zéro dépendance d'exécution.

**Spec:** `docs/superpowers/specs/2026-08-16-environnement-procedural-ecs-design.md` (§6 bis, ajoutée pour cette phase)

## Global Constraints

- `packages/simulation` conserve **zéro dépendance d'exécution**. Aucun `Math.random()` : tout est déterministe.
- Le niveau de la mer reste **exactement 0**.
- `river_bank(2.9, -8)` et `river_bank(4.0, 0)` de `DEFAULT_VILLAGE` doivent **rester dans l'eau**. Le premier ne dispose que de 0,43 m de marge : c'est la contrainte la plus serrée de la phase.
- Les 38 sites du village (23 objets, 11 agents, 4 lieux) restent sur terre ferme, à pente franchissable, dans la zone simulée — le garde-fou `village-habitability.test.ts` en répond.
- `heightAt` est appelé par sommet de tuile : son coût conditionne le streaming. Budget mesuré avant cette phase : **0,60 µs**, pour une tuile complète à 0,98 ms sur un budget d'image VR de 11–14 ms. Toute régression au-delà de **0,90 µs** doit être signalée.
- TypeScript strict avec `noUncheckedIndexedAccess`.
- Les tests tournent en moins de 5 s par fichier.

---

## File Structure

| Fichier | Responsabilité |
| :--- | :--- |
| `packages/simulation/src/world/relief.ts` **(créé)** | Le relief SEC et ses constantes : masque continental, chaînes, détail, plateau, `dryReliefAt`. Ne connaît ni la rivière ni l'entaille. |
| `packages/simulation/src/world/flow.ts` **(créé)** | Le cours d'eau : construction de la polyligne (source, descente, épinglage, altitude monotone), index spatial, requêtes de proximité. Ne connaît pas l'entaille. |
| `packages/simulation/src/world/terrain.ts` **(modifié)** | Élévation du village, et creusement de la vallée jusqu'au cours. Délègue toute la géométrie du cours à `flow.ts`. |
| `packages/simulation/src/index.ts` **(modifié)** | Surface publique. |
| `packages/simulation/test/flow.test.ts` **(créé)** | Descente monotone, atteinte de la mer, épinglage, index spatial. |
| `packages/simulation/test/terrain.test.ts` **(modifié)** | Plateau élevé, vallée creusée et jamais remontée. |
| `packages/simulation/test/village-habitability.test.ts` **(modifié)** | Le garde-fou, réaffirmé sur le nouveau relief. |

**Pourquoi trois modules et non deux.** Le cours a besoin du relief sec, et le terrain a besoin du cours : les mettre tous deux dans `terrain.ts` créerait un **import circulaire**. Les modules ES le toléreraient ici — tous les usages sont dans des corps de fonction — mais c'est une fragilité gratuite qu'un lecteur devrait vérifier à chaque modification. `relief.ts` porte donc le terrain sec, `flow.ts` en dérive le cours, `terrain.ts` compose les deux. Le graphe d'imports est un arbre.

Cette découpe a un second mérite : le cours est une donnée géométrique — une suite de points avec altitude et largeur — qui se teste sans jamais évaluer une hauteur de terrain.

---

### Task 1: Le village gagne son altitude

**Files:**
- Modify: `packages/simulation/src/world/terrain.ts`
- Test: `packages/simulation/test/terrain.test.ts`, `packages/simulation/test/village-habitability.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `VILLAGE_ELEVATION: number` (`6`) — altitude exacte du plateau

**Pourquoi cette tâche d'abord.** Le plateau est aujourd'hui à l'altitude 0, c'est-à-dire au niveau de la mer. Une rivière qui en part n'a **aucune charge hydraulique** : elle ne peut descendre nulle part. Six mètres sur les 800 qui séparent le village de la mer donnent une pente de 0,75 %, celle d'une rivière de plaine.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `packages/simulation/test/terrain.test.ts`, remplacer le bloc `describe('plateau du village', ...)` par :

```ts
describe('plateau du village', () => {
  it("est exactement plat, et AU-DESSUS du niveau de la mer", () => {
    // Un plateau au niveau de la mer ne donne aucune charge hydraulique :
    // la rivière n'aurait nulle part où descendre (spec §6 bis).
    expect(VILLAGE_ELEVATION).toBeGreaterThan(SEA_LEVEL + 3);
    expect(heightAt(0, -2.5)).toBe(VILLAGE_ELEVATION);
    expect(heightAt(2, 0)).toBe(VILLAGE_ELEVATION);
    expect(heightAt(-3, -4)).toBe(VILLAGE_ELEVATION);
  });

  it('getTerrainHeight reste un alias exact de heightAt', () => {
    for (const [x, z] of [
      [0, 0],
      [17, -23],
      [-140, 310],
    ]) {
      expect(getTerrainHeight(x!, z!)).toBe(heightAt(x!, z!));
    }
  });
});
```

Ajouter `VILLAGE_ELEVATION` à la liste d'imports en tête du fichier.

Dans le même fichier, le bloc `describe('bassin habitable', ...)` fige des bornes qui se décalent de six mètres. Remplacer ses deux premières assertions de hauteur par :

```ts
        const y = heightAt(x, z);
        expect(y).toBeGreaterThan(VILLAGE_ELEVATION - 8);
        expect(y).toBeLessThan(VILLAGE_ELEVATION + 6);
```

et **supprimer** le test `'ne creuse sous zéro que dans le lit de la rivière'` : il vérifiait une propriété du monde d'avant, où le sol du village coïncidait avec la mer. La tâche 3 le remplace par une assertion plus forte — la vallée ne remonte jamais le terrain.

Dans `packages/simulation/test/village-habitability.test.ts`, le test `'garde chaque site à une altitude plausible'` devient :

```ts
  it('garde chaque site à une altitude plausible', () => {
    for (const s of sites) {
      const y = heightAt(s.x, s.z);
      expect(y, s.label).toBeGreaterThan(VILLAGE_ELEVATION - 8);
      expect(y, s.label).toBeLessThan(VILLAGE_ELEVATION + 6);
    }
  });
```

en important `VILLAGE_ELEVATION` depuis `../src/world/terrain`.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test terrain`
Expected: FAIL — `VILLAGE_ELEVATION` n'est pas exporté.

- [ ] **Step 3: Écrire l'implémentation**

Dans `packages/simulation/src/world/terrain.ts`, ajouter après `PLATEAU_RADIUS` :

```ts
/**
 * Altitude du plateau du village.
 *
 * Il valait 0, c'est-à-dire le niveau de la mer : une rivière qui en part n'a
 * aucune charge hydraulique et ne peut descendre nulle part (spec §6 bis).
 * Six mètres sur les 800 qui séparent le village de la mer donnent une pente
 * de 0,75 %, celle d'une rivière de plaine.
 */
export const VILLAGE_ELEVATION = 6;
```

Puis, dans `heightAt`, remplacer la ligne d'aplatissement :

```ts
  // Aplatissement exact du cœur, désormais à VILLAGE_ELEVATION et non à zéro.
  const plateau = 1 - smoothstep(PLATEAU_RADIUS, PLATEAU_RADIUS + PLATEAU_FALLOFF, d);
  return lerp(height, VILLAGE_ELEVATION, plateau);
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test`
Expected: PASS.

Si `village-habitability` échoue sur la pente, **ne pas déplacer le village** : la marche entre le plateau et le terrain environnant est trop raide, il faut élargir `PLATEAU_FALLOFF`.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/world/terrain.ts packages/simulation/test
git commit -m "feat(simulation): lift the village plateau above sea level"
```

---

### Task 2: Le cours d'eau

**Files:**
- Create: `packages/simulation/src/world/flow.ts`
- Test: `packages/simulation/test/flow.test.ts`

**Interfaces:**
- Consumes: `landMaskAt`, `dryReliefAt`, `SEA_LEVEL`, `VILLAGE_ELEVATION` de `./relief` — **jamais de `./terrain`**, qui importe ce module.
- Produces:
  - `interface CoursePoint { x: number; z: number; elevation: number; width: number }`
  - `interface RiverCourse { points: readonly CoursePoint[]; length: number }`
  - `getRiverCourse(): RiverCourse` — mémorisé
  - `interface RiverProximity { distance: number; elevation: number; width: number }`
  - `riverProximityAt(x: number, z: number): RiverProximity`
  - `historicalRiverX(z: number): number` — la formule d'origine, conservée pour l'épinglage
  - `PINNED_HALF_LENGTH: number` (`60`)

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/simulation/test/flow.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  getRiverCourse,
  riverProximityAt,
  historicalRiverX,
  PINNED_HALF_LENGTH,
} from '../src/world/flow';
import { SEA_LEVEL, VILLAGE_ELEVATION, WORLD_SIZE } from '../src/world/terrain';

describe('le cours', () => {
  const course = getRiverCourse();

  it('a une longueur crédible et des points ordonnés', () => {
    expect(course.points.length).toBeGreaterThan(50);
    expect(course.length).toBeGreaterThan(400);
  });

  it('DESCEND : son altitude ne remonte jamais vers l\'aval', () => {
    // C'est la propriété qui distingue une rivière d'une rainure.
    for (let i = 1; i < course.points.length; i++) {
      expect(
        course.points[i]!.elevation,
        `point ${i} en (${course.points[i]!.x.toFixed(0)}, ${course.points[i]!.z.toFixed(0)})`,
      ).toBeLessThanOrEqual(course.points[i - 1]!.elevation + 1e-9);
    }
  });

  it('part au-dessus du village et finit à la mer', () => {
    const source = course.points[0]!;
    const mouth = course.points[course.points.length - 1]!;
    expect(source.elevation).toBeGreaterThan(VILLAGE_ELEVATION);
    expect(mouth.elevation).toBeLessThanOrEqual(SEA_LEVEL);
  });

  it("s'élargit vers l'aval", () => {
    expect(course.points[course.points.length - 1]!.width).toBeGreaterThan(
      course.points[0]!.width,
    );
  });

  it('avance sans sauts : deux points consécutifs restent proches', () => {
    for (let i = 1; i < course.points.length; i++) {
      const a = course.points[i - 1]!;
      const b = course.points[i]!;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(12);
    }
  });

  it('est mémorisé : deux appels rendent le même objet', () => {
    expect(getRiverCourse()).toBe(course);
  });
});

describe('épinglage sur la formule historique', () => {
  it("passe EXACTEMENT par l'axe d'origine dans la zone simulée", () => {
    // Les deux points d'eau de DEFAULT_VILLAGE y sont calés à la main, l'un
    // avec 0,43 m de marge. Un cours qui dérive ici assoiffe le village.
    const course = getRiverCourse();
    for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 4) {
      const expected = historicalRiverX(z);
      const near = course.points.filter((p) => Math.abs(p.z - z) < 1.5);
      expect(near.length, `aucun point de cours à z=${z}`).toBeGreaterThan(0);
      const closest = near.reduce((a, b) =>
        Math.abs(a.z - z) <= Math.abs(b.z - z) ? a : b,
      );
      expect(Math.abs(closest.x - expected), `dérive à z=${z}`).toBeLessThan(0.6);
    }
  });

  it('conserve la formule historique elle-même', () => {
    expect(historicalRiverX(0)).toBeCloseTo(4.0, 10);
    expect(historicalRiverX(-8)).toBeCloseTo(4.0 + Math.sin(-8 * 0.12) * 3.5, 10);
    expect(PINNED_HALF_LENGTH).toBeGreaterThanOrEqual(WORLD_SIZE / 2);
  });
});

describe('riverProximityAt', () => {
  it('rend une distance nulle sur l\'axe et croissante en s\'écartant', () => {
    const onAxis = riverProximityAt(historicalRiverX(0), 0);
    expect(onAxis.distance).toBeLessThan(1);
    const off = riverProximityAt(historicalRiverX(0) + 20, 0);
    expect(off.distance).toBeGreaterThan(15);
  });

  it("s'accorde avec une recherche exhaustive sur la polyligne", () => {
    // L'index spatial est une optimisation : il doit rendre EXACTEMENT ce que
    // rendrait le parcours complet, sinon la rivière se déplacerait selon la
    // manière dont on l'interroge.
    const course = getRiverCourse();
    for (const [x, z] of [
      [0, 0],
      [40, -40],
      [-120, 30],
      [12, 90],
    ]) {
      let brute = Infinity;
      for (const p of course.points) brute = Math.min(brute, Math.hypot(p.x - x!, p.z - z!));
      expect(riverProximityAt(x!, z!).distance).toBeCloseTo(brute, 6);
    }
  });

  it('rend une distance finie loin de tout', () => {
    const far = riverProximityAt(5000, 5000);
    expect(Number.isFinite(far.distance)).toBe(true);
    expect(far.distance).toBeGreaterThan(1000);
  });

  it('porte une altitude qui suit celle du cours', () => {
    const atVillage = riverProximityAt(historicalRiverX(0), 0);
    const downstream = riverProximityAt(-400, 0);
    expect(atVillage.elevation).toBeGreaterThan(downstream.elevation);
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test flow`
Expected: FAIL — `Failed to resolve import "../src/world/flow"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `packages/simulation/src/world/flow.ts` :

```ts
import { SEA_LEVEL, VILLAGE_ELEVATION, dryReliefAt, landMaskAt } from './relief';

/**
 * Le cours d'eau (spec §6 bis).
 *
 * Une rivière réelle CREUSE sa vallée : on trace donc un cours dont l'altitude
 * décroît strictement vers l'aval, et `terrain.ts` abaisse ensuite le sol
 * jusqu'à lui. Le cours ne connaît pas l'entaille — il se lit sur le relief
 * SEC, ce qui lève la circularité entre « où passe la rivière » et « où le
 * terrain a été creusé ».
 */

export interface CoursePoint {
  readonly x: number;
  readonly z: number;
  readonly elevation: number;
  readonly width: number;
}

export interface RiverCourse {
  readonly points: readonly CoursePoint[];
  readonly length: number;
}

export interface RiverProximity {
  readonly distance: number;
  readonly elevation: number;
  readonly width: number;
}

/** Demi-longueur du tronçon épinglé, en z. Couvre toute la zone simulée. */
export const PINNED_HALF_LENGTH = 60;

const STEP = 6;
const MAX_POINTS = 900;
const SOURCE_Z = 260;
const WIDTH_SOURCE = 1.4;
const WIDTH_MOUTH = 7;

/** La formule d'origine, à laquelle les points d'eau du village sont calés. */
export function historicalRiverX(z: number): number {
  return 4.0 + Math.sin(z * 0.12) * 3.5;
}

/**
 * Descente par plus forte pente, biaisée vers la mer.
 *
 * Le pur gradient s'enlise dans le moindre creux ; le biais directionnel lui
 * donne l'inertie qu'a un cours d'eau réel, qui franchit les irrégularités
 * au lieu de s'y arrêter.
 */
function descentStep(x: number, z: number, dirX: number, dirZ: number): [number, number] {
  let bestX = dirX;
  let bestZ = dirZ;
  let bestScore = -Infinity;
  for (let a = 0; a < 16; a++) {
    const angle = (a / 16) * Math.PI * 2;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    // Inertie : un cours ne se retourne pas sur lui-même.
    const inertia = cx * dirX + cz * dirZ;
    if (inertia < -0.2) continue;
    const drop = dryReliefAt(x, z) - dryReliefAt(x + cx * STEP, z + cz * STEP);
    const score = drop + inertia * 0.6;
    if (score <= bestScore) continue;
    bestScore = score;
    bestX = cx;
    bestZ = cz;
  }
  return [bestX, bestZ];
}

function buildCourse(): RiverCourse {
  const raw: { x: number; z: number }[] = [];

  // 1. Tronçon épinglé : le cours suit EXACTEMENT la formule historique dans
  //    la zone simulée, pour ne pas déplacer les points d'eau du village.
  for (let z = PINNED_HALF_LENGTH; z >= -PINNED_HALF_LENGTH; z -= STEP) {
    raw.push({ x: historicalRiverX(z), z });
  }

  // 2. Amont : on remonte du début de l'épinglage vers la crête, en montant.
  //    Puis on retourne la séquence pour que le cours parte bien de la source.
  const upstream: { x: number; z: number }[] = [];
  let ux = historicalRiverX(PINNED_HALF_LENGTH);
  let uz = PINNED_HALF_LENGTH;
  let udx = 0;
  let udz = 1;
  while (uz < SOURCE_Z && upstream.length < 120) {
    // Montée : plus forte PENTE ASCENDANTE, donc descente sur le relief inversé.
    const [nx, nz] = descentStep(ux, uz, udx, udz);
    ux -= nx * STEP;
    uz -= nz * STEP;
    udx = -nx;
    udz = -nz;
    upstream.push({ x: ux, z: uz });
  }
  upstream.reverse();

  // 3. Aval : descente libre jusqu'à la mer.
  const downstream: { x: number; z: number }[] = [];
  let dx = historicalRiverX(-PINNED_HALF_LENGTH);
  let dz = -PINNED_HALF_LENGTH;
  let ddx = -1;
  let ddz = 0;
  while (downstream.length < MAX_POINTS) {
    const [nx, nz] = descentStep(dx, dz, ddx, ddz);
    dx += nx * STEP;
    dz += nz * STEP;
    ddx = nx;
    ddz = nz;
    downstream.push({ x: dx, z: dz });
    if (landMaskAt(dx, dz) < 0.35) break; // la mer est atteinte
  }

  const all = [...upstream, ...raw, ...downstream];

  // 4. Altitude forcée décroissante, et largeur croissante vers l'aval.
  const points: CoursePoint[] = [];
  let ceiling = Infinity;
  let length = 0;
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    const t = i / Math.max(1, all.length - 1);
    // Le sol sec donne l'altitude visée ; le plafond garantit la descente.
    const target = Math.min(dryReliefAt(p.x, p.z), ceiling);
    const elevation = Math.max(SEA_LEVEL - 2, target);
    ceiling = Math.min(ceiling, elevation);
    if (i > 0) {
      const q = all[i - 1]!;
      length += Math.hypot(p.x - q.x, p.z - q.z);
    }
    points.push({
      x: p.x,
      z: p.z,
      elevation,
      width: WIDTH_SOURCE + (WIDTH_MOUTH - WIDTH_SOURCE) * t,
    });
  }
  return { points, length };
}

let cached: RiverCourse | null = null;

export function getRiverCourse(): RiverCourse {
  if (cached === null) cached = buildCourse();
  return cached;
}

// --- Index spatial ---------------------------------------------------------
// `isRiverAt` est appelé par agent et par tick, et `heightAt` par sommet de
// tuile : parcourir la polyligne à chaque requête serait ruineux.

const CELL = 32;

let index: Map<string, number[]> | null = null;

function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function getIndex(): Map<string, number[]> {
  if (index !== null) return index;
  const built = new Map<string, number[]>();
  const course = getRiverCourse();
  for (let i = 0; i < course.points.length; i++) {
    const p = course.points[i]!;
    const cx = Math.floor(p.x / CELL);
    const cz = Math.floor(p.z / CELL);
    // Un point est inscrit dans sa cellule ET ses voisines : une requête n'a
    // alors qu'une seule cellule à consulter, et jamais neuf.
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const key = cellKey(cx + ox, cz + oz);
        const list = built.get(key);
        if (list === undefined) built.set(key, [i]);
        else list.push(i);
      }
    }
  }
  index = built;
  return built;
}

const FAR: RiverProximity = { distance: Infinity, elevation: SEA_LEVEL, width: 0 };

export function riverProximityAt(x: number, z: number): RiverProximity {
  const course = getRiverCourse();
  const candidates = getIndex().get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));

  let best = FAR;
  let bestDistance = Infinity;
  const scan = candidates ?? null;
  const count = scan === null ? course.points.length : scan.length;
  for (let k = 0; k < count; k++) {
    const i = scan === null ? k : scan[k]!;
    const p = course.points[i]!;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= bestDistance) continue;
    bestDistance = d;
    best = { distance: d, elevation: p.elevation, width: p.width };
  }
  return best;
}
```

- [ ] **Step 4: Extraire le relief sec dans son propre module**

`flow.ts` a besoin du relief AVANT entaille, et `terrain.ts` a besoin du cours :
les laisser se citer l'un l'autre créerait un cycle d'imports. Créer
`packages/simulation/src/world/relief.ts` en y **déplaçant depuis `terrain.ts`**,
sans en changer une ligne de calcul :

- les constantes `WORLD_SIZE`, `SEA_LEVEL`, `PLATEAU_RADIUS`, `PLATEAU_FALLOFF`,
  `BASIN_RADIUS`, `BASIN_FALLOFF`, `VILLAGE_Z`, `VILLAGE_ELEVATION`, et toutes
  les échelles et graines (`CONTINENT_*`, `MOUNTAIN_*`, `RANGE_*`, `DETAIL_*`,
  `SEA_FLOOR`, `INLAND_RISE`, `MOUNTAIN_HEIGHT`, `HOMELAND_*`) ;
- les fonctions `distanceToVillage`, `landMaskAt`, `reliefFromLand`,
  `reliefWithoutRiver` — cette dernière renommée et exportée :

```ts
/**
 * Le relief avant toute entaille.
 *
 * `flow.ts` doit lire le terrain SEC : lire le terrain creusé ferait dépendre
 * le tracé du cours de l'entaille que ce tracé produit.
 */
export function dryReliefAt(x: number, z: number): number {
  return reliefFromLand(x, z, landMaskAt(x, z));
}
```

`terrain.ts` réexporte alors ces symboles pour préserver sa surface publique :

```ts
export {
  WORLD_SIZE,
  SEA_LEVEL,
  PLATEAU_RADIUS,
  BASIN_RADIUS,
  VILLAGE_ELEVATION,
  landMaskAt,
  dryReliefAt,
} from './relief';
```

Le graphe d'imports devient un arbre : `noise` → `relief` → `flow` → `terrain`.

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test flow`
Expected: PASS, 12 tests.

Si « finit à la mer » échoue, la descente s'est enlisée : relever le poids d'inertie de `0.6` à `0.9` dans `descentStep`. **Ne pas** relâcher l'assertion — un cours qui n'atteint pas la mer est précisément le défaut que cette phase corrige.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/world/flow.ts packages/simulation/src/world/terrain.ts \
        packages/simulation/test/flow.test.ts
git commit -m "feat(simulation): deterministic river course that descends to the sea"
```

---

### Task 3: La vallée creusée

**Files:**
- Modify: `packages/simulation/src/world/terrain.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/terrain.test.ts`

**Interfaces:**
- Consumes: `riverProximityAt`, `getRiverCourse` de `./flow`.
- Produces:
  - `isRiverAt(x, z)` et `isShoreAt(x, z)` — **mêmes noms et signatures**, désormais adossés au cours
  - `riverSurfaceAt(x: number, z: number): number` — altitude de la nappe, pour la phase 4
  - `VALLEY_MARGIN: number` (`9`)
  - `riverCenterX` et `riverStrengthAt` — **supprimés** (remplacés par `riverProximityAt`)

**L'invariant qui tient toute la tâche.** L'entaille ne fait que **baisser** le terrain, jamais le monter. Formulée avec un `Math.min`, cette règle rend impossible qu'une rivière se retrouve sur une crête — le défaut exact que la phase corrige. Elle est directement testable.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `packages/simulation/test/terrain.test.ts`, remplacer entièrement le bloc `describe('rivière', ...)` et le bloc `describe('plausibilité hydrologique', ...)` par :

```ts
describe('rivière', () => {
  it("garde les deux points d'eau du village dans le lit", () => {
    // river_bank(2.9, -8) ne dispose que de 0,43 m de marge : c'est la
    // contrainte la plus serrée de tout le projet.
    expect(isRiverAt(4.0, 0)).toBe(true);
    expect(isRiverAt(2.9, -8)).toBe(true);
  });

  it('sépare le lit, la berge et la terre ferme', () => {
    expect(isRiverAt(4.0 + 12, 0)).toBe(false);
    expect(isShoreAt(4.0, 0)).toBe(false);
    expect(isShoreAt(20, 0)).toBe(false);
  });

  it("NE COULE JAMAIS en altitude", () => {
    // Sans le masque d'altitude d'autrefois, l'entaille suivait son axe
    // par-dessus les montagnes : une rivière à 68 m sur un flanc alpin.
    // Le cours descendant rend l'anomalie structurellement impossible.
    const course = getRiverCourse();
    for (const p of course.points) {
      expect(p.elevation, `point (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`).toBeLessThan(
        VILLAGE_ELEVATION + 60,
      );
    }
  });

  it('creuse : le lit est plus bas que ses abords', () => {
    for (const z of [-40, -20, 0, 20, 40]) {
      const axis = riverProximityAt(historicalRiverX(z), z);
      if (axis.distance > 2) continue;
      const bed = heightAt(historicalRiverX(z), z);
      const bank = heightAt(historicalRiverX(z) + 14, z);
      expect(bed, `à z=${z}`).toBeLessThan(bank);
    }
  });
});

describe("l'entaille ne remonte jamais le sol", () => {
  it('reste partout sous le relief sec', () => {
    // Invariant central : formulé avec Math.min, il rend impossible qu'une
    // rivière se retrouve perchée sur une crête.
    for (let x = -600; x <= 600; x += 23) {
      for (let z = -600; z <= 600; z += 23) {
        expect(heightAt(x, z), `(${x}, ${z})`).toBeLessThanOrEqual(dryReliefAt(x, z) + 1e-9);
      }
    }
  });

  it('ne touche pas au terrain loin du cours', () => {
    let untouched = 0;
    for (let x = -600; x <= 600; x += 37) {
      for (let z = -600; z <= 600; z += 37) {
        if (riverProximityAt(x, z).distance < 40) continue;
        untouched++;
        expect(heightAt(x, z)).toBeCloseTo(dryReliefAt(x, z), 6);
      }
    }
    expect(untouched).toBeGreaterThan(100);
  });
});

describe('riverSurfaceAt', () => {
  it('rend une nappe qui descend vers l\'aval', () => {
    const atVillage = riverSurfaceAt(historicalRiverX(0), 0);
    const downstream = riverSurfaceAt(-400, 0);
    expect(atVillage).toBeGreaterThan(downstream);
  });

  it('pose la nappe au-dessus du lit et sous les berges', () => {
    const x = historicalRiverX(0);
    expect(riverSurfaceAt(x, 0)).toBeGreaterThan(heightAt(x, 0));
    expect(riverSurfaceAt(x, 0)).toBeLessThan(heightAt(x + 14, 0));
  });
});
```

Adapter les imports du fichier : ajouter `riverSurfaceAt`, `dryReliefAt`, `VILLAGE_ELEVATION` depuis `../src/world/terrain`, et `getRiverCourse`, `riverProximityAt`, `historicalRiverX` depuis `../src/world/flow`. Retirer `riverCenterX`, `riverStrengthAt`, `RIVER_CARVE_RADIUS`, `RIVER_MAX_ALTITUDE` des imports **et** des tests qui les utilisaient — le test `"ne bouge d'aucun millimètre dans la zone simulée"` est remplacé par l'épinglage vérifié dans `flow.test.ts`, et `"méandre à grande échelle"` par la descente du cours.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test terrain`
Expected: FAIL — `riverSurfaceAt` et `dryReliefAt` ne sont pas exportés.

- [ ] **Step 3: Écrire l'implémentation**

Dans `packages/simulation/src/world/terrain.ts` : importer `riverProximityAt` depuis `./flow`, **supprimer** `riverCenterX`, `riverStrengthAt`, `riverCarveAt`, `RIVER_CARVE_RADIUS`, `RIVER_FADE_ALTITUDE`, `RIVER_MAX_ALTITUDE`, `MEANDER_*`, puis écrire :

```ts
/** Largeur de la vallée au-delà du lit, où le terrain rejoint le relief sec. */
export const VALLEY_MARGIN = 9;

/** Profondeur du lit sous la nappe. */
const BED_DEPTH = 1.1;

export function isRiverAt(x: number, z: number): boolean {
  const river = riverProximityAt(x, z);
  return river.distance < river.width;
}

export function isShoreAt(x: number, z: number): boolean {
  const river = riverProximityAt(x, z);
  return river.distance >= river.width && river.distance < river.width + 3.5;
}

/** Altitude de la nappe libre. C'est ce que la phase 4 maillera. */
export function riverSurfaceAt(x: number, z: number): number {
  return riverProximityAt(x, z).elevation;
}

export function heightAt(x: number, z: number): number {
  const dry = reliefWithoutRiver(x, z);
  const d = distanceToVillage(x, z);
  const plateau = 1 - smoothstep(PLATEAU_RADIUS, PLATEAU_RADIUS + PLATEAU_FALLOFF, d);
  const ground = lerp(dry, VILLAGE_ELEVATION, plateau);

  const river = riverProximityAt(x, z);
  const reach = river.width + VALLEY_MARGIN;
  if (river.distance >= reach) return ground;

  // Profil de vallée : le fond du lit au centre, le sol intact au bord.
  const t = 1 - smoothstep(0, reach, river.distance);
  const valley = lerp(ground, river.elevation - BED_DEPTH, t);

  // L'entaille ne fait que CREUSER. Sans ce min, une vallée traversant un
  // creux du terrain y remonterait le sol, et la rivière se retrouverait
  // perchée sur un remblai de sa propre fabrication.
  return Math.min(ground, valley);
}
```

Dans `packages/simulation/src/index.ts`, retirer `riverCenterX` et `RIVER_MAX_ALTITUDE` de l'export de `./world/terrain`, y ajouter `VILLAGE_ELEVATION`, `VALLEY_MARGIN`, `riverSurfaceAt`, `dryReliefAt`, et ajouter une ligne :

```ts
export {
  getRiverCourse,
  riverProximityAt,
  historicalRiverX,
  PINNED_HALF_LENGTH,
  type CoursePoint,
  type RiverCourse,
  type RiverProximity,
} from './world/flow';
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test`
Expected: PASS. Le garde-fou `village-habitability` doit rester vert **sans être modifié** : c'est lui qui atteste que le village survit à la refonte.

Si `river_bank(2.9, -8)` sort du lit, la largeur du cours à cet endroit est insuffisante : relever `WIDTH_SOURCE` dans `flow.ts`. **Ne pas déplacer l'objet** — il est calé sur la formule historique, que l'épinglage préserve.

- [ ] **Step 5: Mesurer le coût de `heightAt`**

`heightAt` gagne une requête d'index par appel, et il est évalué par sommet de tuile. Écrire un fichier temporaire `packages/simulation/test/_cost.test.ts` :

```ts
import { it } from 'vitest';
import { heightAt } from '../src/world/terrain';

it('mesure heightAt', () => {
  for (let i = 0; i < 5000; i++) heightAt(i * 0.3, i * -0.2);
  const n = 200000;
  const t = performance.now();
  for (let i = 0; i < n; i++) heightAt(i * 0.37, i * -0.11);
  console.log(`heightAt : ${(((performance.now() - t) / n) * 1000).toFixed(2)} us/appel`);
});
```

Run: `pnpm --filter @iwsdk/cardinal-simulation test _cost` puis supprimer le fichier.
Expected: **au plus 0,90 µs**. Au-delà, le signaler explicitement dans le rapport — le streaming de la phase 3B repose sur ce budget.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src packages/simulation/test
git commit -m "feat(simulation): carve the valley down to the river course, never up"
```

---

### Task 4: Adaptation de la démo et vérification

**Files:**
- Modify: `apps/demo/src/simulation/ProceduralRiver.ts`
- Modify: `apps/demo/src/simulation/ProceduralGrassField.ts` (import de `isRiverAt` inchangé, à vérifier)
- Modify: `packages/world/src/terrain/sampling.ts` (le biome consomme la distance au cours)

**Interfaces:**
- Consumes: `riverProximityAt`, `riverSurfaceAt`, `getRiverCourse` du moteur.
- Produces: rien.

- [ ] **Step 1: Adapter l'échantillonnage des biomes**

`packages/world/src/terrain/sampling.ts` passe `Math.abs(x - riverCenterX(z))` à `classifyBiome`. Cette fonction n'existe plus. Remplacer l'import et l'appel :

```ts
import {
  heightAt,
  landMaskAt,
  humidityAt,
  riverProximityAt,
  classifyBiome,
  BIOME_IDS,
  type BiomeId,
} from '@iwsdk/cardinal-simulation';
```

et dans la boucle :

```ts
        riverProximityAt(x, z).distance,
```

à la place de `Math.abs(x - riverCenterX(z))`.

Faire de même dans `packages/simulation/src/world/biomes.ts`, dont la fonction privée `distanceToRiver` devient :

```ts
function distanceToRiver(x: number, z: number): number {
  return riverProximityAt(x, z).distance;
}
```

en important `riverProximityAt` depuis `./flow`.

- [ ] **Step 2: Faire suivre le ruban d'eau de la démo**

`apps/demo/src/simulation/ProceduralRiver.ts` déforme un plan avec `riverCenterX(z)` et pose l'eau à plat en `y = -0.05`. Remplacer la boucle de déformation par un ruban qui suit le cours et **descend avec lui** :

```ts
import { getRiverCourse, riverSurfaceAt } from '@iwsdk/cardinal-simulation';
```

et, dans `createRiver`, remplacer le corps de la boucle sur `pos` par :

```ts
    const course = getRiverCourse();
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // Le ruban est paramétré le long du cours : chaque rangée de sommets
      // reprend un point de la polyligne, et sa hauteur est celle de la nappe.
      const v = pos.getZ(i) / length + 0.5; // [0, 1] le long du plan
      const idx = Math.min(course.points.length - 1, Math.max(0, Math.round(v * (course.points.length - 1))));
      const p = course.points[idx]!;
      const lateral = pos.getX(i);
      pos.setX(i, p.x + lateral * (p.width / width));
      pos.setZ(i, p.z);
      pos.setY(i, riverSurfaceAt(p.x, p.z));
    }
```

- [ ] **Step 3: Vérification complète**

Run:
```bash
pnpm --filter @iwsdk/cardinal-simulation build && pnpm typecheck && pnpm test && pnpm build && pnpm --filter @iwsdk/plugin-phoenix-demo build
```
Expected: 0 erreur de type ; suite verte ; 18 paquets ; build démo OK. Le `build` du moteur passe **avant** le typecheck : la démo et `packages/world` l'importent par son `dist`.

- [ ] **Step 4: Vérification en session réelle**

```bash
cd apps/demo && npx iwsdk dev up
```

Après `browserCommandReady: true`, mettre la simulation en pause et forcer midi, puis vérifier et **rapporter honnêtement** :

1. la rivière descend visiblement au lieu d'être un ruban plat ;
2. elle passe toujours au même endroit au village ;
3. le joueur ne tombe pas — relever `positionRelativeToXROrigin` d'une tuile proche, qui doit rester de l'ordre du centimètre ;
4. `npx iwsdk scene render-stats` : appels de dessin et triangles comparables à la phase 3B (144 / 41472) ;
5. console relevée avec `count` seul, jamais `level`.

Arrêter ensuite : `npx iwsdk dev down`

- [ ] **Step 5: Commit**

```bash
git add -A packages apps
git commit -m "feat(demo): the river ribbon follows the descending course"
```

---

## Ce que la phase 3C ne fait PAS

- **Pas de réseau hydrographique.** Un seul cours, de la source à la mer. Ni affluents, ni confluences, ni lacs.
- **Pas de débit variable.** La largeur croît linéairement vers l'aval ; elle ne dépend ni de la pluie ni de la saison.
- **Pas de rendu d'eau.** Surface, vagues, Fresnel, écume : c'est la phase 4, que cette phase rend enfin cohérente.
- **Pas d'érosion par le cours.** La vallée est creusée d'un profil fixe, sans dépendre de la pente locale ni du débit.
- **Pas d'extension de la zone simulée.** `WORLD_SIZE` reste 64 m : les agents ne suivent pas la rivière jusqu'à la mer.
