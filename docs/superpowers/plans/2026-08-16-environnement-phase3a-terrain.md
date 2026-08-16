# Phase 3A — Champ de terrain kilométrique — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le champ de hauteur analytique de 64 m par un générateur procédural valable sur le plan infini, exposant `heightAt`, `slopeAt`, `isWaterAt`, `depthAt` et `biomeAt` comme vérité terrain partagée, sans déloger le village existant.

**Architecture:** Tout vit dans `packages/simulation/src/world/`, en mathématiques pures et sans aucune dépendance. Un module `noise.ts` fournit le hachage sans état, le bruit de valeur et deux variantes fractales ; `terrain.ts` les compose en un relief à trois échelles (masque continental, montagnes ridées, détail fin) que deux atténuations protègent : un **plateau exact** au cœur du village et un **bassin habitable** couvrant la zone simulée. `biomes.ts` dérive les biomes de ce relief. Le maillage, le streaming et les niveaux de détail relèvent de la phase 3B et ne sont pas traités ici.

**Tech Stack:** TypeScript strict, vitest, zéro dépendance d'exécution.

**Spec:** `docs/superpowers/specs/2026-08-16-environnement-procedural-ecs-design.md` (§6 Terrain, biomes et streaming)

## Global Constraints

- `packages/simulation` conserve **zéro dépendance d'exécution** (`dependencies` et `peerDependencies` vides). Le bruit s'écrit à la main ; interdiction d'importer `packages/world` (qui, lui, dépend de `@iwsdk/core`).
- **Aucun `Math.random()`** nulle part dans le moteur (spec §8.2) : tout aléa est un hachage déterministe des coordonnées.
- `WORLD_SIZE = 64` **reste inchangé** : c'est la borne de la zone *simulée* (clamp de navigation, dimensionnement de `SpatialGrid`), pas l'étendue du terrain. Le champ de hauteur, lui, devient défini sur le plan infini.
- Le niveau de la mer est **exactement 0**.
- `getTerrainHeight`, `isRiverAt` et `isShoreAt` gardent leur nom et leur signature : ils sont exportés par `src/index.ts` et consommés par `apps/demo`, `WolfSystem`, `AgentRuntime` et `navigation`.
- TypeScript strict avec `noUncheckedIndexedAccess` : tout accès indexé exige `!` ou une garde.
- Les tests tournent en moins de 5 s par fichier (défaut vitest). Un test qui balaie le terrain doit échantillonner, pas énumérer.

---

## File Structure

| Fichier | Responsabilité |
| :--- | :--- |
| `packages/simulation/src/world/noise.ts` **(créé)** | Hachage sans état, bruit de valeur, `fbm` érodée, `ridgedFbm`, helpers `clamp01`/`lerp`/`smoothstep`. Aucune notion de terrain. |
| `packages/simulation/src/world/terrain.ts` **(modifié)** | Compose le bruit en relief : masque continental, montagnes, détail, entaille de rivière, plateau du village, bassin habitable. Expose `heightAt`/`getTerrainHeight`, `slopeAt`, `isWaterAt`, `depthAt`. |
| `packages/simulation/src/world/biomes.ts` **(créé)** | `BiomeId`, `BiomeSample`, `biomeAt` — dérivé de la hauteur, de la pente, de l'humidité et de la distance à la mer. |
| `packages/simulation/src/index.ts` **(modifié)** | Surface d'export publique. |
| `packages/simulation/test/noise.test.ts` **(créé)** | Déterminisme, bornes, continuité du bruit. |
| `packages/simulation/test/terrain.test.ts` **(modifié)** | Plateau, bassin, mer, pente, cohérence pente/hauteur. |
| `packages/simulation/test/biomes.test.ts` **(créé)** | Poids normalisés, biomes attendus par région. |
| `packages/simulation/test/village-habitability.test.ts` **(créé)** | Garde-fou de migration : le village reste habitable sur le nouveau relief. |

**Pourquoi trois fichiers et non un.** `noise.ts` ne connaît rien au terrain et se teste sur ses seules propriétés mathématiques ; `terrain.ts` compose ; `biomes.ts` classe. Un seul fichier mélangerait trois niveaux d'abstraction et rendrait les tests de bruit dépendants du relief.

---

### Task 1: Primitives de bruit déterministe

**Files:**
- Create: `packages/simulation/src/world/noise.ts`
- Test: `packages/simulation/test/noise.test.ts`

**Interfaces:**
- Consumes: rien (premier module).
- Produces:
  - `clamp01(v: number): number`
  - `lerp(a: number, b: number, t: number): number`
  - `smoothstep(edge0: number, edge1: number, x: number): number`
  - `valueNoise(x: number, z: number, seed: number): number` → `[0, 1]`
  - `erodedFbm(x: number, z: number, seed: number, octaves?: number): number` → `[0, 1]`
  - `ridgedFbm(x: number, z: number, seed: number, octaves?: number): number` → `[0, 1]`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/simulation/test/noise.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  clamp01,
  lerp,
  smoothstep,
  valueNoise,
  erodedFbm,
  ridgedFbm,
} from '../src/world/noise';

describe('helpers', () => {
  it('clamp01 borne des deux côtés', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(9)).toBe(1);
  });

  it('lerp interpole aux extrémités et au milieu', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('smoothstep est plat aux bords et vaut 0.5 au centre', () => {
    expect(smoothstep(2, 6, 1)).toBe(0);
    expect(smoothstep(2, 6, 7)).toBe(1);
    expect(smoothstep(2, 6, 4)).toBeCloseTo(0.5, 10);
  });

  it('smoothstep ne divise pas par zéro quand les bords coïncident', () => {
    expect(Number.isFinite(smoothstep(3, 3, 3))).toBe(true);
  });
});

describe('valueNoise', () => {
  it('reste dans [0, 1] sur un large domaine', () => {
    for (let i = 0; i < 800; i++) {
      const v = valueNoise(i * 3.7 - 1000, i * -1.3 + 500, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('est SANS ÉTAT : le même point rend toujours la même valeur', () => {
    const a = valueNoise(123.456, -78.9, 5);
    valueNoise(0, 0, 5);
    valueNoise(999, 999, 5);
    expect(valueNoise(123.456, -78.9, 5)).toBe(a);
  });

  it('sépare les graines', () => {
    expect(valueNoise(3.3, 7.1, 1)).not.toBe(valueNoise(3.3, 7.1, 2));
  });

  it('est continu : deux points voisins restent proches', () => {
    let previous = valueNoise(-40, 2, 5);
    for (let x = -40; x < 40; x += 0.02) {
      const current = valueNoise(x, 2, 5);
      expect(Math.abs(current - previous)).toBeLessThan(0.05);
      previous = current;
    }
  });

  it('vaut exactement le hachage du coin sur les entiers', () => {
    // Aux nœuds du réseau, l'interpolation est inutile : la valeur EST le hachage.
    // Deux nœuds distincts diffèrent, ce qui prouve que le réseau porte du signal.
    expect(valueNoise(7, -3, 4)).not.toBe(valueNoise(8, -3, 4));
  });
});

describe('erodedFbm', () => {
  it('reste dans [0, 1]', () => {
    for (let i = 0; i < 400; i++) {
      const v = erodedFbm(i * 0.31, i * -0.17, 21);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('est déterministe', () => {
    expect(erodedFbm(4.2, -8.8, 3)).toBe(erodedFbm(4.2, -8.8, 3));
  });

  it('ADOUCIT les pentes par rapport à une fbm non érodée', () => {
    // L'érosion amortit les octaves hautes là où la pente accumulée est forte :
    // la variation moyenne doit être plus faible que celle du bruit brut sommé.
    const meanStep = (f: (x: number) => number) => {
      let total = 0;
      let n = 0;
      for (let x = 0; x < 30; x += 0.05) {
        total += Math.abs(f(x + 0.05) - f(x));
        n++;
      }
      return total / n;
    };
    const eroded = meanStep((x) => erodedFbm(x, 1.5, 9, 5));
    const raw = meanStep((x) => {
      let sum = 0;
      let amp = 1;
      let freq = 1;
      let norm = 0;
      for (let o = 0; o < 5; o++) {
        sum += amp * valueNoise(x * freq, 1.5 * freq, 9 + o * 1013);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      return sum / norm;
    });
    expect(eroded).toBeLessThan(raw);
  });
});

describe('ridgedFbm', () => {
  it('reste dans [0, 1] et est déterministe', () => {
    for (let i = 0; i < 300; i++) {
      const v = ridgedFbm(i * 0.23, i * 0.41, 33);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(ridgedFbm(1.1, 2.2, 33)).toBe(ridgedFbm(1.1, 2.2, 33));
  });

  it('produit des crêtes : la valeur maximale approche 1', () => {
    let max = 0;
    for (let x = 0; x < 60; x += 0.05) max = Math.max(max, ridgedFbm(x, 3.7, 33));
    expect(max).toBeGreaterThan(0.75);
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test noise`
Expected: FAIL — `Failed to resolve import "../src/world/noise"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `packages/simulation/src/world/noise.ts` :

```ts
/**
 * Bruit déterministe sans état (spec §6). Aucune dépendance : le paquet n'en a
 * aucune et cette propriété est préservée.
 *
 * Pourquoi ne pas réutiliser `Rng` : c'est un générateur de FLUX, son état
 * avance à chaque appel. Un terrain exige l'inverse — le même point du monde
 * doit rendre la même hauteur, pour toujours et quel que soit l'ordre des
 * appels. Seule la fonction de mélange splitmix32 de `Rng` est reprise ici.
 */

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  // Bords confondus : la rampe est un échelon, pas une division par zéro.
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Hachage entier -> [0, 1). Mélange splitmix32, comme l'expansion de graine de Rng. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ (seed | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 0x1_0000_0000;
}

/** Rampe quintique : dérivées première ET seconde nulles aux nœuds, donc pas de facettes visibles. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bruit de valeur bilinéaire sur le plan infini. Renvoie [0, 1]. */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const u = fade(x - x0);
  const v = fade(z - z0);
  const n00 = hash2(x0, z0, seed);
  const n10 = hash2(x0 + 1, z0, seed);
  const n01 = hash2(x0, z0 + 1, seed);
  const n11 = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

const GRADIENT_EPS = 0.0015;

/**
 * fbm dont chaque octave est amortie par la pente accumulée sous elle.
 * C'est l'approximation d'érosion de la spec : le détail se dépose dans les
 * creux et s'efface sur les flancs raides, au lieu de saupoudrer uniformément.
 * Coût : trois évaluations de bruit par octave — le maillage de la phase 3B
 * choisira le nombre d'octaves selon le niveau de détail.
 */
export function erodedFbm(x: number, z: number, seed: number, octaves = 5): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  let slopeX = 0;
  let slopeZ = 0;
  for (let o = 0; o < octaves; o++) {
    const s = seed + o * 1013;
    const n = valueNoise(x * frequency, z * frequency, s);
    const gx = (valueNoise((x + GRADIENT_EPS) * frequency, z * frequency, s) - n) / GRADIENT_EPS;
    const gz = (valueNoise(x * frequency, (z + GRADIENT_EPS) * frequency, s) - n) / GRADIENT_EPS;
    slopeX += gx;
    slopeZ += gz;
    const damping = 1 / (1 + slopeX * slopeX + slopeZ * slopeZ);
    sum += amplitude * n * damping;
    norm += amplitude * damping;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm > 0 ? clamp01(sum / norm) : 0;
}

/** fbm ridée : les crêtes sont des plis, pas des bosses. Renvoie [0, 1]. */
export function ridgedFbm(x: number, z: number, seed: number, octaves = 5): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(x * frequency, z * frequency, seed + o * 7919);
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += amplitude * ridge * ridge;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return clamp01(sum / norm);
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test noise`
Expected: PASS, 12 tests.

Si le test « ADOUCIT les pentes » échoue, ne pas relâcher l'assertion : vérifier que `damping` est bien appliqué à `norm` **et** à `sum` (sinon la normalisation annule l'effet).

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/world/noise.ts packages/simulation/test/noise.test.ts
git commit -m "feat(simulation): stateless deterministic noise with slope-damped fbm"
```

---

### Task 2: Champ de hauteur kilométrique

**Files:**
- Modify: `packages/simulation/src/world/terrain.ts` (remplacement complet du corps, exports conservés)
- Test: `packages/simulation/test/terrain.test.ts` (réécriture)

**Interfaces:**
- Consumes: `clamp01`, `lerp`, `smoothstep`, `valueNoise`, `erodedFbm`, `ridgedFbm` depuis `./noise`.
- Produces:
  - `WORLD_SIZE: number` (inchangé, `64`)
  - `SEA_LEVEL: number` (`0`)
  - `PLATEAU_RADIUS: number` (`5`)
  - `BASIN_RADIUS: number` (`38`)
  - `heightAt(x: number, z: number): number`
  - `getTerrainHeight(x: number, z: number): number` — alias historique de `heightAt`
  - `isRiverAt(x: number, z: number): boolean`
  - `isShoreAt(x: number, z: number): boolean`
  - `riverCenterX(z: number): number`
  - `landMaskAt(x: number, z: number): number` → `[0, 1]`, 0 = pleine mer

- [ ] **Step 1: Écrire les tests qui échouent**

Remplacer intégralement `packages/simulation/test/terrain.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  WORLD_SIZE,
  SEA_LEVEL,
  PLATEAU_RADIUS,
  BASIN_RADIUS,
  heightAt,
  getTerrainHeight,
  isRiverAt,
  isShoreAt,
  riverCenterX,
  landMaskAt,
} from '../src/world/terrain';

describe('constantes', () => {
  it('garde la zone simulée à 64 m et la mer à zéro', () => {
    // WORLD_SIZE borne la SIMULATION (clamp de navigation, SpatialGrid),
    // pas l'étendue du terrain, qui est désormais infinie.
    expect(WORLD_SIZE).toBe(64);
    expect(SEA_LEVEL).toBe(0);
  });
});

describe('plateau du village', () => {
  it('est exactement plat au cœur', () => {
    expect(heightAt(0, -2.5)).toBe(0);
    expect(heightAt(2, 0)).toBe(0);
    expect(heightAt(-3, -4)).toBe(0);
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

describe('bassin habitable', () => {
  it('garde un relief doux sur toute la zone simulée', () => {
    // Le village et ses ressources vivent ici : sans cette garantie, les agents
    // se retrouveraient dans une falaise (spec §6, risque de migration assumé).
    // La borne basse laisse passer le lit de la rivière (creusé à -1,2 m) et
    // rien d'autre.
    expect(BASIN_RADIUS).toBeGreaterThan(WORLD_SIZE / 2 - 10);
    for (let x = -WORLD_SIZE / 2; x <= WORLD_SIZE / 2; x += 2) {
      for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 2) {
        const y = heightAt(x, z);
        expect(y).toBeGreaterThan(-1.5);
        expect(y).toBeLessThan(5);
      }
    }
  });

  it('ne creuse sous zéro que dans le lit de la rivière', () => {
    for (let x = -WORLD_SIZE / 2; x <= WORLD_SIZE / 2; x += 1.5) {
      for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 1.5) {
        if (heightAt(x, z) < -0.05) {
          expect(Math.abs(x - riverCenterX(z))).toBeLessThan(4.0);
        }
      }
    }
  });

  it('ne noie jamais la zone simulée', () => {
    for (let x = -WORLD_SIZE / 2; x <= WORLD_SIZE / 2; x += 3) {
      for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 3) {
        expect(landMaskAt(x, z)).toBeGreaterThan(0.9);
      }
    }
  });
});

describe('relief lointain', () => {
  it('produit du dénivelé réel au-delà du bassin', () => {
    let max = -Infinity;
    for (let x = -1500; x <= 1500; x += 37) {
      for (let z = -1500; z <= 1500; z += 37) {
        max = Math.max(max, heightAt(x, z));
      }
    }
    expect(max).toBeGreaterThan(40);
  });

  it('creuse une mer sous le niveau zéro', () => {
    let min = Infinity;
    for (let x = -3000; x <= 3000; x += 53) {
      for (let z = -3000; z <= 3000; z += 53) {
        min = Math.min(min, heightAt(x, z));
      }
    }
    expect(min).toBeLessThan(-5);
  });

  it('reste continu : pas de falaise verticale entre deux échantillons voisins', () => {
    for (let x = -600; x < 600; x += 7) {
      const dy = Math.abs(heightAt(x + 0.5, 120) - heightAt(x, 120));
      expect(dy).toBeLessThan(6);
    }
  });

  it('est déterministe', () => {
    expect(heightAt(412.5, -733.25)).toBe(heightAt(412.5, -733.25));
  });
});

describe('rivière', () => {
  it('passe toujours au même endroit près du village', () => {
    expect(riverCenterX(0)).toBeCloseTo(4.0, 10);
    expect(isRiverAt(4.0, 0)).toBe(true);
    expect(isRiverAt(4.0 + 3.0, 0)).toBe(false);
    expect(isRiverAt(20, 0)).toBe(false);
  });

  it('sépare le lit de la berge', () => {
    expect(isShoreAt(4.0, 0)).toBe(false);
    expect(isShoreAt(4.0 + 3.0, 0)).toBe(true);
    expect(isShoreAt(4.0 + 9.0, 0)).toBe(false);
  });

  it('méandre à grande échelle', () => {
    expect(Math.abs(riverCenterX(400) - riverCenterX(0))).toBeGreaterThan(5);
  });

  it("ne bouge d'aucun millimètre dans la zone simulée", () => {
    // Verrou de non-régression : la formule historique, à laquelle les points
    // d'eau de DEFAULT_VILLAGE sont calés à la main.
    for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += 0.5) {
      expect(riverCenterX(z)).toBeCloseTo(4.0 + Math.sin(z * 0.12) * 3.5, 12);
    }
  });

  it('garde le point d\'eau river_bank(2.9, -8) dans le lit', () => {
    // Cet objet ne dispose que de 0,43 m de marge. Il est le seul accès à l'eau
    // du camp Aube : s'il sort du lit, les agents ne peuvent plus boire.
    expect(isRiverAt(2.9, -8)).toBe(true);
    expect(isRiverAt(4.0, 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test terrain`
Expected: FAIL — `SEA_LEVEL`, `BASIN_RADIUS`, `heightAt`, `riverCenterX`, `landMaskAt` n'existent pas.

- [ ] **Step 3: Écrire l'implémentation**

Remplacer intégralement `packages/simulation/src/world/terrain.ts` :

```ts
import { lerp, smoothstep, erodedFbm, ridgedFbm } from './noise';

/**
 * Vérité terrain (spec §6). Le rendu appelle EXACTEMENT ces fonctions : sans
 * cela, les agents marcheraient sur un relief que le joueur ne voit pas.
 *
 * Le champ est défini sur le plan infini. `WORLD_SIZE` ne le borne pas — il
 * borne la zone SIMULÉE (clamp de navigation, dimension de SpatialGrid), qui
 * reste volontairement de 64 m tant que l'écologie n'a pas étendu le domaine.
 */
export const WORLD_SIZE = 64;
export const SEA_LEVEL = 0;

/** Cœur du village : rigoureusement plat, pour poser abris et foyer. */
export const PLATEAU_RADIUS = 5;
const PLATEAU_FALLOFF = 4;

/** Bassin habitable : le relief y reste doux, couvrant toute la zone simulée. */
export const BASIN_RADIUS = 38;
const BASIN_FALLOFF = 55;

/** Le village est décentré de 2,5 m en z, comme dans le terrain d'origine. */
const VILLAGE_Z = -2.5;

const CONTINENT_SCALE = 1 / 2600;
const MOUNTAIN_SCALE = 1 / 420;
const DETAIL_SCALE = 1 / 55;

const CONTINENT_SEED = 90210;
const MOUNTAIN_SEED = 31337;
const DETAIL_SEED = 5150;

const SEA_FLOOR = -22;
const INLAND_RISE = 7;
const MOUNTAIN_HEIGHT = 95;

/** Rayon sous lequel la terre ferme est garantie autour de l'origine. */
const HOMELAND_RADIUS = 700;
const HOMELAND_STRENGTH = 0.45;

function distanceToVillage(x: number, z: number): number {
  const dz = z - VILLAGE_Z;
  return Math.sqrt(x * x + dz * dz);
}

/**
 * Masque continental : 0 en pleine mer, 1 à l'intérieur des terres.
 * Le biais « terre natale » garantit que l'origine n'est jamais engloutie —
 * sans lui, une graine malheureuse noierait le village.
 */
export function landMaskAt(x: number, z: number): number {
  const base = erodedFbm(x * CONTINENT_SCALE, z * CONTINENT_SCALE, CONTINENT_SEED, 4);
  const d = Math.hypot(x, z);
  const homeland = Math.exp(-((d / HOMELAND_RADIUS) ** 2)) * HOMELAND_STRENGTH;
  return smoothstep(0.48, 0.6, base + homeland);
}

/** Le grand méandre ne démarre qu'au-delà de la zone simulée. */
const MEANDER_START = 60;
const MEANDER_FULL = 320;
const MEANDER_AMPLITUDE = 40;

/**
 * Axe de la rivière : méandre serré près du village, ample au loin.
 *
 * La rampe n'est PAS cosmétique. `river_bank(2.9, -8)` de DEFAULT_VILLAGE a été
 * calé à la main sur l'ancienne formule et ne dispose que de 0,43 m de marge
 * avant de sortir du lit ; un méandre actif dès l'origine priverait les agents
 * de leur point d'eau sans qu'aucune erreur ne soit levée.
 */
export function riverCenterX(z: number): number {
  const meander = smoothstep(MEANDER_START, MEANDER_FULL, Math.abs(z));
  return 4.0 + Math.sin(z * 0.12) * 3.5 + Math.sin(z * 0.004) * MEANDER_AMPLITUDE * meander;
}

export function isRiverAt(x: number, z: number): boolean {
  return Math.abs(x - riverCenterX(z)) < 2.2;
}

export function isShoreAt(x: number, z: number): boolean {
  const d = Math.abs(x - riverCenterX(z));
  return d >= 2.2 && d < 4.5;
}

function riverCarveAt(x: number, z: number): number {
  const d = Math.abs(x - riverCenterX(z));
  if (d >= 4.0) return 0;
  return Math.cos((d / 4.0) * (Math.PI / 2)) * 1.2;
}

export function heightAt(x: number, z: number): number {
  const land = landMaskAt(x, z);
  const d = distanceToVillage(x, z);

  // 0 dans le bassin, 1 en plein relief : le village n'hérite pas des montagnes.
  const relief = smoothstep(BASIN_RADIUS, BASIN_RADIUS + BASIN_FALLOFF, d);

  const base = lerp(SEA_FLOOR, INLAND_RISE, land) * relief;

  // Les montagnes exigent d'être loin de la côte : land³ les efface sur le littoral.
  const ridges = ridgedFbm(x * MOUNTAIN_SCALE, z * MOUNTAIN_SCALE, MOUNTAIN_SEED, 5);
  const mountain = ridges * MOUNTAIN_HEIGHT * land * land * land * relief;

  // Le détail survit dans le bassin, atténué : le village ondule, il n'est pas lisse.
  // Il reste POSITIF pour que la seule chose qui creuse sous zéro près du village
  // soit le lit de la rivière — un agent ne doit pas se retrouver sous l'eau
  // parce qu'une octave de bruit est passée du mauvais côté.
  const detailAmplitude = lerp(1.6, 4.5, relief) * land;
  const detail = erodedFbm(x * DETAIL_SCALE, z * DETAIL_SCALE, DETAIL_SEED, 4) * detailAmplitude;

  const height = base + mountain + detail - riverCarveAt(x, z) * land;

  // Aplatissement exact du cœur : multiplier garantit 0, une interpolation non.
  const plateau = 1 - smoothstep(PLATEAU_RADIUS, PLATEAU_RADIUS + PLATEAU_FALLOFF, d);
  return height * (1 - plateau);
}

/** Alias historique : consommé par apps/demo, WolfSystem et AgentRuntime. */
export function getTerrainHeight(x: number, z: number): number {
  return heightAt(x, z);
}
```

**Note sur l'import inutilisé** : `clamp01` et `valueNoise` figurent dans l'import mais ne sont pas utilisés par ce fichier. Retirer les deux de la ligne d'import — la ligne correcte est :

```ts
import { lerp, smoothstep, erodedFbm, ridgedFbm } from './noise';
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test terrain`
Expected: PASS.

Si « creuse une mer sous le niveau zéro » échoue, c'est que le biais de terre natale déborde : vérifier que `HOMELAND_RADIUS` vaut bien 700 et non une valeur kilométrique. **Ne pas** élargir la fenêtre de balayage pour aller chercher la mer plus loin — ce serait masquer le défaut.

- [ ] **Step 5: Vérifier la typographie du paquet**

Run: `pnpm --filter @iwsdk/cardinal-simulation typecheck`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/world/terrain.ts packages/simulation/test/terrain.test.ts
git commit -m "feat(simulation): kilometre-scale terrain field with habitable basin"
```

---

### Task 3: Pente, eau et profondeur

**Files:**
- Modify: `packages/simulation/src/world/terrain.ts` (ajout en fin de fichier)
- Test: `packages/simulation/test/terrain.test.ts` (ajout de blocs `describe`)

**Interfaces:**
- Consumes: `heightAt`, `SEA_LEVEL` de la tâche 2.
- Produces:
  - `slopeAt(x: number, z: number): number` — radians, `[0, π/2)`
  - `isWaterAt(x: number, z: number): boolean`
  - `depthAt(x: number, z: number): number` — mètres sous le niveau de la mer, `0` sur terre

- [ ] **Step 1: Écrire les tests qui échouent**

D'abord compléter l'import **existant** en haut de `packages/simulation/test/terrain.test.ts` en y ajoutant trois noms — `slopeAt`, `isWaterAt`, `depthAt` — plutôt que d'ouvrir une seconde déclaration d'import plus bas dans le fichier.

Puis ajouter à la fin de `packages/simulation/test/terrain.test.ts` :

```ts
describe('slopeAt', () => {
  it('est nulle sur le plateau du village', () => {
    expect(slopeAt(0, -2.5)).toBeCloseTo(0, 6);
  });

  it('reste dans [0, π/2)', () => {
    for (let x = -800; x <= 800; x += 41) {
      const s = slopeAt(x, 250);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(Math.PI / 2);
    }
  });

  it("s'accorde avec la dérivée de heightAt", () => {
    // Auto-cohérence : si pente et hauteur divergeaient, la végétation se
    // planterait sur des falaises et la navigation croirait le sol plat.
    const x = 320;
    const z = -180;
    const e = 0.5;
    const hx = heightAt(x + e, z) - heightAt(x - e, z);
    const hz = heightAt(x, z + e) - heightAt(x, z - e);
    const expected = Math.atan(Math.hypot(hx, hz) / (2 * e));
    expect(slopeAt(x, z)).toBeCloseTo(expected, 10);
  });

  it('est plus forte en montagne que dans le bassin', () => {
    const basin = slopeAt(10, 10);
    let mountain = 0;
    for (let x = 400; x < 900; x += 13) mountain = Math.max(mountain, slopeAt(x, 400));
    expect(mountain).toBeGreaterThan(basin);
  });
});

describe('isWaterAt / depthAt', () => {
  it("n'a pas d'eau sous le village", () => {
    expect(isWaterAt(0, -2.5)).toBe(false);
    expect(depthAt(0, -2.5)).toBe(0);
  });

  it('trouve de la mer au large et lui donne une profondeur positive', () => {
    let found = false;
    for (let x = -3000; x <= 3000 && !found; x += 53) {
      for (let z = -3000; z <= 3000; z += 53) {
        if (isWaterAt(x, z)) {
          expect(depthAt(x, z)).toBeGreaterThan(0);
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('accorde exactement profondeur et hauteur', () => {
    for (let x = -2000; x <= 2000; x += 211) {
      const h = heightAt(x, 900);
      expect(depthAt(x, 900)).toBeCloseTo(Math.max(0, SEA_LEVEL - h), 10);
      expect(isWaterAt(x, 900)).toBe(h < SEA_LEVEL);
    }
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test terrain`
Expected: FAIL — `slopeAt`, `isWaterAt`, `depthAt` ne sont pas exportés.

- [ ] **Step 3: Écrire l'implémentation**

Ajouter à la fin de `packages/simulation/src/world/terrain.ts` :

```ts
const SLOPE_EPS = 0.5;

/** Pente du sol en radians. Différences centrées sur ±0,5 m. */
export function slopeAt(x: number, z: number): number {
  const dx = heightAt(x + SLOPE_EPS, z) - heightAt(x - SLOPE_EPS, z);
  const dz = heightAt(x, z + SLOPE_EPS) - heightAt(x, z - SLOPE_EPS);
  return Math.atan(Math.hypot(dx, dz) / (2 * SLOPE_EPS));
}

/**
 * Mer uniquement : le littoral est dessiné par le masque continental.
 * La rivière garde ses prédicats propres (`isRiverAt`) — sa surface libre et sa
 * profondeur relèvent de la phase 4, où la géométrie d'eau est construite.
 */
export function isWaterAt(x: number, z: number): boolean {
  return heightAt(x, z) < SEA_LEVEL;
}

export function depthAt(x: number, z: number): number {
  return Math.max(0, SEA_LEVEL - heightAt(x, z));
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test terrain`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/world/terrain.ts packages/simulation/test/terrain.test.ts
git commit -m "feat(simulation): slope, sea mask and depth derived from the terrain field"
```

---

### Task 4: Biomes

**Files:**
- Create: `packages/simulation/src/world/biomes.ts`
- Test: `packages/simulation/test/biomes.test.ts`

**Interfaces:**
- Consumes: `heightAt`, `slopeAt`, `landMaskAt`, `SEA_LEVEL` de `./terrain` ; `valueNoise`, `clamp01`, `smoothstep` de `./noise`.
- Produces:
  - `type BiomeId = 'ocean' | 'beach' | 'wetland' | 'grassland' | 'forest' | 'rock' | 'alpine'`
  - `BIOME_IDS: readonly BiomeId[]`
  - `interface BiomeSample { primary: BiomeId; weights: Readonly<Record<BiomeId, number>> }`
  - `humidityAt(x: number, z: number): number` → `[0, 1]`
  - `biomeAt(x: number, z: number): BiomeSample`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/simulation/test/biomes.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { BIOME_IDS, biomeAt, humidityAt } from '../src/world/biomes';
import { heightAt, slopeAt, isWaterAt } from '../src/world/terrain';

describe('humidityAt', () => {
  it('reste dans [0, 1] et est déterministe', () => {
    for (let i = 0; i < 200; i++) {
      const v = humidityAt(i * 13.7, i * -9.1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(humidityAt(12, 34)).toBe(humidityAt(12, 34));
  });
});

describe('biomeAt', () => {
  it('rend des poids normalisés à 1', () => {
    for (let x = -900; x <= 900; x += 137) {
      for (let z = -900; z <= 900; z += 137) {
        const sample = biomeAt(x, z);
        const total = BIOME_IDS.reduce((acc, id) => acc + sample.weights[id], 0);
        expect(total).toBeCloseTo(1, 9);
      }
    }
  });

  it('ne rend jamais un poids négatif', () => {
    for (let x = -500; x <= 500; x += 71) {
      const sample = biomeAt(x, 310);
      for (const id of BIOME_IDS) expect(sample.weights[id]).toBeGreaterThanOrEqual(0);
    }
  });

  it('désigne comme primaire le biome de poids maximal', () => {
    for (let x = -400; x <= 400; x += 53) {
      const sample = biomeAt(x, -260);
      const best = BIOME_IDS.reduce((a, b) => (sample.weights[a] >= sample.weights[b] ? a : b));
      expect(sample.primary).toBe(best);
    }
  });

  it('classe le village en terre ferme, jamais en océan', () => {
    expect(biomeAt(0, -2.5).primary).not.toBe('ocean');
    expect(biomeAt(10, 10).primary).not.toBe('ocean');
    expect(biomeAt(-15, 20).primary).not.toBe('ocean');
  });

  it("appelle océan tout point sous le niveau de la mer", () => {
    let checked = 0;
    for (let x = -3000; x <= 3000 && checked < 5; x += 53) {
      for (let z = -3000; z <= 3000 && checked < 5; z += 53) {
        if (isWaterAt(x, z)) {
          expect(biomeAt(x, z).primary).toBe('ocean');
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('réserve alpine aux hautes altitudes', () => {
    for (let x = -1500; x <= 1500; x += 47) {
      for (let z = -1500; z <= 1500; z += 47) {
        if (biomeAt(x, z).primary === 'alpine') expect(heightAt(x, z)).toBeGreaterThan(45);
      }
    }
  });

  it('réserve rock aux fortes pentes', () => {
    for (let x = -1200; x <= 1200; x += 43) {
      for (let z = -1200; z <= 1200; z += 43) {
        if (biomeAt(x, z).primary === 'rock') expect(slopeAt(x, z)).toBeGreaterThan(0.45);
      }
    }
  });

  it('est déterministe', () => {
    expect(biomeAt(321, -654).primary).toBe(biomeAt(321, -654).primary);
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test biomes`
Expected: FAIL — `Failed to resolve import "../src/world/biomes"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `packages/simulation/src/world/biomes.ts` :

```ts
import { clamp01, smoothstep, valueNoise } from './noise';
import { SEA_LEVEL, heightAt, slopeAt, landMaskAt } from './terrain';

/**
 * Les biomes sont une donnée de simulation, pas une décoration (spec §6) :
 * les baies poussent où c'est humide, le silex affleure où la roche est nue.
 * Le rendu et le moteur lisent le même classement.
 */
export type BiomeId = 'ocean' | 'beach' | 'wetland' | 'grassland' | 'forest' | 'rock' | 'alpine';

export const BIOME_IDS: readonly BiomeId[] = [
  'ocean',
  'beach',
  'wetland',
  'grassland',
  'forest',
  'rock',
  'alpine',
];

export interface BiomeSample {
  readonly primary: BiomeId;
  readonly weights: Readonly<Record<BiomeId, number>>;
}

const HUMIDITY_SCALE = 1 / 900;
const HUMIDITY_SEED = 24601;

/** Le rock exige cette pente ; le test de biome s'appuie sur le même seuil. */
const ROCK_SLOPE = 0.5;
/** L'alpin exige cette altitude ; idem. */
const ALPINE_HEIGHT = 52;

export function humidityAt(x: number, z: number): number {
  return clamp01(valueNoise(x * HUMIDITY_SCALE, z * HUMIDITY_SCALE, HUMIDITY_SEED));
}

export function biomeAt(x: number, z: number): BiomeSample {
  const h = heightAt(x, z);
  const s = slopeAt(x, z);
  const land = landMaskAt(x, z);
  const wet = humidityAt(x, z);

  // Chaque score est une préférence non normalisée ; la somme les met à l'échelle.
  const ocean = h < SEA_LEVEL ? 1 + (SEA_LEVEL - h) : 0;
  const coastal = 1 - land;

  const scores: Record<BiomeId, number> = {
    ocean,
    // Plage : juste au-dessus de l'eau, plate, et proche du littoral.
    beach:
      ocean > 0
        ? 0
        : smoothstep(3.5, 0.2, h) * smoothstep(0.35, 0.05, s) * smoothstep(0.2, 0.75, coastal),
    // Marais : bas, plat, humide.
    wetland: ocean > 0 ? 0 : smoothstep(6, 0.5, h) * smoothstep(0.3, 0.05, s) * smoothstep(0.5, 0.9, wet),
    grassland: ocean > 0 ? 0 : smoothstep(0.55, 0.15, s) * smoothstep(0.75, 0.3, wet) * smoothstep(ALPINE_HEIGHT, 8, h),
    forest: ocean > 0 ? 0 : smoothstep(0.6, 0.2, s) * smoothstep(0.35, 0.8, wet) * smoothstep(ALPINE_HEIGHT, 6, h),
    rock: ocean > 0 ? 0 : smoothstep(ROCK_SLOPE, ROCK_SLOPE + 0.35, s),
    alpine: ocean > 0 ? 0 : smoothstep(ALPINE_HEIGHT, ALPINE_HEIGHT + 30, h),
  };

  let total = 0;
  for (const id of BIOME_IDS) total += scores[id];

  // Un point sans aucun score (plateau nu, humidité médiane) reste de la prairie
  // plutôt que de produire une division par zéro.
  if (total <= 0) {
    const fallback: Record<BiomeId, number> = {
      ocean: 0,
      beach: 0,
      wetland: 0,
      grassland: 1,
      forest: 0,
      rock: 0,
      alpine: 0,
    };
    return { primary: 'grassland', weights: fallback };
  }

  const weights: Record<BiomeId, number> = {
    ocean: 0,
    beach: 0,
    wetland: 0,
    grassland: 0,
    forest: 0,
    rock: 0,
    alpine: 0,
  };
  let primary: BiomeId = 'grassland';
  let best = -1;
  for (const id of BIOME_IDS) {
    const w = scores[id] / total;
    weights[id] = w;
    if (w > best) {
      best = w;
      primary = id;
    }
  }
  return { primary, weights };
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test biomes`
Expected: PASS.

Si « réserve rock aux fortes pentes » échoue, le seuil du test (`0.45`) est délibérément plus permissif que `ROCK_SLOPE` (`0.5`) parce que `rock` peut l'emporter légèrement sous le seuil quand tous les autres scores s'effondrent. Ne pas remonter le seuil du test au-dessus de `ROCK_SLOPE` : il deviendrait faux.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/world/biomes.ts packages/simulation/test/biomes.test.ts
git commit -m "feat(simulation): biome classification from height, slope, humidity and coast"
```

---

### Task 5: Revalidation du village

**Files:**
- Modify: `packages/simulation/src/content/scenario.ts` (exporter `SETTLEMENTS` et son type)
- Modify: `apps/demo/src/simulation/layout.ts:19-23` (consommer la liste du moteur au lieu de la redéclarer)
- Test: `packages/simulation/test/village-habitability.test.ts` (créé)

**Interfaces:**
- Consumes: `heightAt`, `slopeAt`, `isWaterAt`, `isRiverAt`, `landMaskAt`, `riverCenterX`, `WORLD_SIZE` (tâches 2-3) ; `biomeAt` (tâche 4) ; `DEFAULT_VILLAGE` existant.
- Produces:
  - `interface Settlement { tribe: string; x: number; z: number }` — **exporté** depuis `content/scenario.ts`
  - `SETTLEMENTS: readonly Settlement[]` — **exporté** depuis `content/scenario.ts`

**Pourquoi cette tâche existe.** La spec §6 annonce le risque : « le nouveau générateur devra conserver un plateau habitable à l'origine avec accès à l'eau, faute de quoi les agents se retrouveraient dans une falaise ou sans rivière ». Aujourd'hui rien ne le garantit — les 23 objets, 11 agents et 4 lieux de `DEFAULT_VILLAGE` sont plats **par coïncidence numérique**, parce que leurs coordonnées tombent dans le disque de rayon 5. Ce test transforme la coïncidence en contrat.

- [ ] **Step 1: Écrire le test de garde qui échoue**

Créer `packages/simulation/test/village-habitability.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_VILLAGE } from '../src/content/scenario';
import {
  WORLD_SIZE,
  heightAt,
  slopeAt,
  isWaterAt,
  isRiverAt,
  landMaskAt,
  riverCenterX,
} from '../src/world/terrain';
import { biomeAt } from '../src/world/biomes';

/** Pente maximale qu'un villageois franchit sans escalader : ~23°. */
const WALKABLE_SLOPE = 0.4;

const sites = [
  ...DEFAULT_VILLAGE.objects.map((o) => ({ label: `object ${o.type}`, x: o.x, z: o.z })),
  ...DEFAULT_VILLAGE.agents.map((a) => ({ label: `agent ${a.id}`, x: a.x, z: a.z })),
  ...DEFAULT_VILLAGE.places.map((p) => ({ label: `place ${p.name}`, x: p.x, z: p.z })),
];

describe('habitabilité du village sur le nouveau relief', () => {
  it('a bien des sites à vérifier', () => {
    expect(sites.length).toBe(23 + 11 + 4);
  });

  it('pose chaque site à l\'intérieur de la zone simulée', () => {
    for (const s of sites) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(WORLD_SIZE / 2);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(WORLD_SIZE / 2);
    }
  });

  it('pose chaque site sur la terre ferme', () => {
    for (const s of sites) {
      expect(landMaskAt(s.x, s.z), s.label).toBeGreaterThan(0.9);
    }
  });

  it('ne noie aucun site, sauf les points d\'eau qui doivent l\'être', () => {
    for (const s of sites) {
      if (s.label === 'object river_bank') continue;
      expect(isWaterAt(s.x, s.z), s.label).toBe(false);
    }
  });

  it('garde chaque site sur une pente franchissable', () => {
    for (const s of sites) {
      expect(slopeAt(s.x, s.z), s.label).toBeLessThan(WALKABLE_SLOPE);
    }
  });

  it('garde chaque site à une altitude plausible', () => {
    for (const s of sites) {
      const y = heightAt(s.x, s.z);
      expect(y, s.label).toBeGreaterThan(-1.5);
      expect(y, s.label).toBeLessThan(5);
    }
  });

  it('garde les deux points d\'eau dans le lit de la rivière', () => {
    const banks = DEFAULT_VILLAGE.objects.filter((o) => o.type === 'river_bank');
    expect(banks.length).toBe(2);
    for (const bank of banks) {
      expect(isRiverAt(bank.x, bank.z), `river_bank(${bank.x}, ${bank.z})`).toBe(true);
    }
  });

  it('laisse un chemin franchissable de chaque campement à la rivière', () => {
    // Un site accessible mais coupé par une falaise vaut un site inaccessible.
    const camps = DEFAULT_VILLAGE.places.filter((p) => p.name.startsWith('camp_'));
    expect(camps.length).toBe(3);
    for (const camp of camps) {
      const targetX = riverCenterX(camp.z);
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const x = camp.x + ((targetX - camp.x) * i) / steps;
        expect(slopeAt(x, camp.z), `${camp.name} -> rivière @x=${x.toFixed(1)}`).toBeLessThan(
          WALKABLE_SLOPE,
        );
      }
    }
  });

  it('ne classe aucun campement en biome hostile', () => {
    for (const camp of DEFAULT_VILLAGE.places.filter((p) => p.name.startsWith('camp_'))) {
      expect(['ocean', 'alpine', 'rock']).not.toContain(biomeAt(camp.x, camp.z).primary);
    }
  });
});
```

- [ ] **Step 2: Lancer le test et observer le résultat**

Run: `pnpm --filter @iwsdk/cardinal-simulation test village-habitability`

Ce test est un **garde-fou**, pas un test de développement piloté : il peut très bien passer du premier coup, ce qui est le résultat souhaité. S'il échoue, **ne pas déplacer le village** — corriger le générateur (élargir `BASIN_RADIUS`, baisser `detailAmplitude`) jusqu'à ce que le terrain accueille le village existant. Déplacer le village casserait `wolf.test.ts`, `player.test.ts` et les snapshots.

- [ ] **Step 3: Supprimer la double source de vérité des campements**

`apps/demo/src/simulation/layout.ts:19-23` redéclare littéralement les trois coordonnées de campement que `scenario.ts:44-48` garde privées. Deux sources pour un même fait : un déplacement de camp côté moteur laisserait la démo dessiner les feux à l'ancien endroit.

Dans `packages/simulation/src/content/scenario.ts`, exporter le type et la constante — remplacer `interface Settlement {` par `export interface Settlement {` et `const SETTLEMENTS` par `export const SETTLEMENTS`.

Dans `packages/simulation/src/index.ts`, ajouter à l'export de contenu :

```ts
export { SETTLEMENTS, type Settlement } from './content/scenario';
```

Dans `apps/demo/src/simulation/layout.ts`, remplacer le bloc `SETTLEMENTS` local (lignes 19-23) par une dérivation de la liste du moteur :

```ts
import { DEFAULT_VILLAGE, SETTLEMENTS as ENGINE_SETTLEMENTS } from '@iwsdk/cardinal-simulation';
import type { ScenarioAgent, ScenarioObject } from '@iwsdk/cardinal-simulation';

/** Seule la couleur appartient au rendu ; les coordonnées viennent du moteur. */
const TRIBE_COLORS: Record<string, number> = {
  Aube: 0x3b82f6,
  Rive: 0xef4444,
  Pic: 0x10b981,
};

const SETTLEMENTS: SettlementLayout[] = ENGINE_SETTLEMENTS.map((s) => ({
  tribe: s.tribe,
  x: s.x,
  z: s.z,
  color: TRIBE_COLORS[s.tribe] ?? 0xffffff,
}));
```

Conserver la ligne d'import existante de `DEFAULT_VILLAGE` si elle diffère, et garder inchangés `LayoutAgent`, `LayoutObject`, `SettlementLayout` et `VILLAGE_LAYOUT`.

- [ ] **Step 4: Vérifier que la démo compile et que le moteur passe**

Run: `pnpm --filter @iwsdk/cardinal-simulation test && pnpm --filter @iwsdk/cardinal-simulation build && pnpm --filter @iwsdk/plugin-phoenix-demo typecheck`
Expected: tests verts, build OK, 0 erreur de type.

Le `build` du moteur est indispensable **avant** le typecheck de la démo : celle-ci importe `@iwsdk/cardinal-simulation` par son `dist`, donc un export ajouté à la source seule reste invisible.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/content/scenario.ts packages/simulation/src/index.ts \
        packages/simulation/test/village-habitability.test.ts apps/demo/src/simulation/layout.ts
git commit -m "test(simulation): guard village habitability, and share settlements with the demo"
```

---

### Task 6: Surface publique et migration de la démo

**Files:**
- Modify: `packages/simulation/src/index.ts:14`
- Modify: `apps/demo/src/simulation/ProceduralTerrain.ts:60-111`
- Modify: `apps/demo/src/simulation/ProceduralRiver.ts:33`

**Interfaces:**
- Consumes: tout ce que les tâches 2, 3 et 4 produisent.
- Produces: rien de nouveau — cette tâche câble.

**Ce que cette tâche répare.** La formule de la rivière est écrite **cinq fois** dans le dépôt (trois fois dans l'ancien `terrain.ts`, une dans `ProceduralTerrain.ts:77`, une dans `ProceduralRiver.ts:33`). Les tâches 2 et 3 en ont supprimé trois ; celle-ci supprime les deux dernières. Et les seuils de couleur du terrain encodent l'ancienne plage d'altitude (roche au-dessus de 4,5 m) : sur le nouveau relief ils ne se déclencheraient plus jamais dans le bassin, laissant un sol uniformément vert.

- [ ] **Step 1: Élargir la surface publique du moteur**

Dans `packages/simulation/src/index.ts`, remplacer la ligne 14 par :

```ts
export {
  WORLD_SIZE,
  SEA_LEVEL,
  PLATEAU_RADIUS,
  BASIN_RADIUS,
  heightAt,
  getTerrainHeight,
  slopeAt,
  isWaterAt,
  depthAt,
  isRiverAt,
  isShoreAt,
  riverCenterX,
  landMaskAt,
} from './world/terrain';
export { BIOME_IDS, biomeAt, humidityAt, type BiomeId, type BiomeSample } from './world/biomes';
```

- [ ] **Step 2: Reconstruire le moteur**

Run: `pnpm --filter @iwsdk/cardinal-simulation build`
Expected: build OK. Vérifier que `packages/simulation/dist/index.d.ts` contient bien `biomeAt` :

```bash
grep -c "biomeAt" packages/simulation/dist/index.d.ts
```
Expected: un nombre supérieur à 0.

- [ ] **Step 3: Colorer le terrain par les biomes du moteur**

Dans `apps/demo/src/simulation/ProceduralTerrain.ts`, ajouter aux imports depuis `@iwsdk/cardinal-simulation` : `riverCenterX`, `biomeAt`, `BIOME_IDS`, et le type `BiomeId`.

Remplacer le bloc allant de la déclaration de palette (ligne 63) à la fin de la boucle de couleur (ligne 111) par :

```ts
    // Color palette
    const colDeepGrass = new Color(0x365314); // Dark emerald mossy grass
    const colLushGrass = new Color(0x65a30d); // Vibrant sunlit meadow grass
    const colGoldenGrass = new Color(0x84cc16); // High hill golden grass
    const colSand = new Color(0xd4a373); // Warm river shore sand
    const colDirt = new Color(0x78350f); // Rich agricultural dirt
    const colRock = new Color(0x64748b); // Mountain cliff rock

    // Une teinte par biome du moteur : le sol qu'on voit et les ressources que
    // les agents y trouvent découlent maintenant de la même classification.
    const biomeColors: Record<BiomeId, Color> = {
      ocean: new Color(0x1e3a5f),
      beach: colSand,
      wetland: new Color(0x4d7c0f),
      grassland: colLushGrass,
      forest: colDeepGrass,
      rock: colRock,
      alpine: new Color(0xe2e8f0),
    };

    // Alloué une fois : la boucle couvre 9409 sommets.
    const vertexCol = new Color();

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const y = this.getHeight(x, z);
      posAttr.setY(i, y);

      const distToRiver = Math.abs(x - riverCenterX(z));

      if (distToRiver < 2.4) {
        // Riverbed — la rivière n'est pas un biome en phase 3A.
        vertexCol.copy(colSand).lerp(colDirt, 0.4);
      } else if (distToRiver < 4.5) {
        const shoreFactor = (distToRiver - 2.4) / 2.1;
        vertexCol.copy(colSand).lerp(colLushGrass, shoreFactor);
      } else {
        const { weights } = biomeAt(x, z);
        vertexCol.setRGB(0, 0, 0);
        for (const id of BIOME_IDS) {
          const w = weights[id];
          if (w <= 0) continue;
          const c = biomeColors[id];
          vertexCol.r += c.r * w;
          vertexCol.g += c.g * w;
          vertexCol.b += c.b * w;
        }
        // Les hauteurs dorent l'herbe, comme avant, mais sans seuil en dur.
        if (y > 1.5) vertexCol.lerp(colGoldenGrass, Math.min(1, (y - 1.5) / 2.5));
      }

      colors.push(vertexCol.r, vertexCol.g, vertexCol.b);
    }
```

**Changement visible assumé :** le motif de vignoble en rangs (ancien `x < -8 && z > -12 && z < 2`) disparaît. C'était une décoration codée en dur qu'aucune donnée de simulation n'appuyait ; la spec §11 prévoit la suppression de ce fichier entier en phase 3B.

- [ ] **Step 4: Supprimer la dernière copie de la formule de rivière**

Dans `apps/demo/src/simulation/ProceduralRiver.ts`, importer `riverCenterX` depuis `@iwsdk/cardinal-simulation` et remplacer la déclaration locale de la ligne 33 par un appel à cette fonction. Supprimer la constante locale devenue inutile.

- [ ] **Step 5: Vérification complète**

Run:
```bash
pnpm typecheck && pnpm test && pnpm build && pnpm --filter @iwsdk/plugin-phoenix-demo build
```
Expected: 0 erreur de type ; suite verte (le total passe de 503 à environ 540 — noise, terrain, biomes et habitabilité s'ajoutent) ; 18 paquets construits ; build démo OK.

Le garde-fou `check-single-three` doit rester vert : aucune dépendance n'a été ajoutée.

- [ ] **Step 6: Vérification visuelle**

```bash
cd apps/demo && npx iwsdk dev up
```

Attendre `browserCommandReady: true` (`npx iwsdk dev status`), puis prendre une capture d'exécution (`browser_screenshot`, **pas** `scene_screenshot` : le rendu éditeur n'exécute pas les systèmes). Vérifier trois points et les rapporter honnêtement :

1. le sol porte des teintes contrastées de biome et non un vert uniforme ;
2. la rivière est toujours au même endroit, bordée de sable ;
3. aucune erreur nouvelle — relever la console avec `browser_get_console_logs` en ne passant que `count`, jamais `level` (un filtre de niveau masque les erreurs).

Arrêter ensuite le serveur : `npx iwsdk dev down`.

- [ ] **Step 7: Commit**

```bash
git add packages/simulation/src/index.ts apps/demo/src/simulation/ProceduralTerrain.ts \
        apps/demo/src/simulation/ProceduralRiver.ts
git commit -m "feat(demo): colour the ground from engine biomes and share one river axis"
```

---

## Ce que la phase 3A ne fait PAS

À énoncer pour qu'aucun exécutant ne s'y engage par extrapolation :

- **Pas de tuiles, pas de streaming, pas de LOD.** `ProceduralTerrain` reste un mesh unique de 64 m et 9409 sommets. Le monde kilométrique existe dans les *mathématiques* mais n'est pas encore maillé. C'est la phase 3B.
- **Pas de `scatterAt`.** Le semis déterministe de végétation (spec §8) appartient à la phase flore.
- **Pas de profondeur ni de surface de rivière.** `depthAt` ne traite que la mer ; l'eau courante est la phase 4.
- **Pas d'extension de la zone simulée.** `WORLD_SIZE` reste 64 : les agents continuent de vivre dans le bassin. L'élargir relève du sous-projet écologie & subsistance.
- **Pas de terrain dans les décisions des agents.** `Mode1` estime encore les déplacements en distance planaire (`Mode1.ts:124`), en ignorant le dénivelé. C'est correct tant que les agents restent dans le bassin ; ce serait faux dès qu'ils en sortiraient.
