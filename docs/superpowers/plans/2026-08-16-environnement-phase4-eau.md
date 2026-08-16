# Phase 4 — Surface d'eau de la rivière — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le ruban bleu uniforme par une vraie surface d'eau : profondeur portée par sommet, vagues de Gerstner, réflexion du ciel par Fresnel et écume de rive.

**Architecture:** La technique centrale de la spec §7 est de **calculer la profondeur au sommet, côté CPU, avec la fonction partagée du moteur**, et de la stocker comme attribut de géométrie. Le poste le plus coûteux d'une eau réaliste sur mobile — la passe de profondeur — disparaît : le nuanceur interpole l'attribut. Et l'eau ne peut pas diverger du terrain, puisque les deux lisent la même fonction. Le maillage et les vagues sont des fonctions pures et testées ; le nuanceur reste mince.

**Tech Stack:** TypeScript strict, vitest, `@iwsdk/core` (Three), GLSL, `@iwsdk/cardinal-simulation` pour la vérité de l'eau.

**Spec:** `docs/superpowers/specs/2026-08-16-environnement-procedural-ecs-design.md` (§7 L'eau : rivière et mer)

## Global Constraints

- **Budget VR : 11–14 ms par image au total** (72–90 fps). Le ruban est construit **une fois** ; seule une uniforme de temps change par image.
- **Ne jamais allouer dans `update()`** — les tampons de travail vivent dans `init()`.
- **Importer Three depuis `@iwsdk/core`, jamais depuis `three`.**
- **`entity.dispose()`, jamais `entity.destroy()`.**
- La surface d'eau vient de `riverSurfaceAt` et le fond de `heightAt` : **jamais d'une réimplémentation**. C'est ce qui garantit que l'eau et le terrain ne divergent pas.
- TypeScript strict avec `noUncheckedIndexedAccess`.
- Les nuanceurs ne sont pas testables unitairement : tout ce qui peut vivre en TypeScript pur y vit, et le GLSL se réduit à consommer des attributs et des uniformes.

## Portée assumée

**La mer n'est pas rendue.** Elle est à 775 m alors que le monde streamé s'arrête à 112 m : rien ne serait visible et rien ne serait vérifiable. Les 34 points de cours présents dans la zone visible portent en revanche toute la technique — profondeur, vagues, Fresnel, écume — qui s'appliquera telle quelle à la mer le jour où l'horizon s'ouvrira.

**Le niveau `high` de la table §7** (réflexion planaire, cible de réfraction, caustiques) n'est pas implémenté. `detectQuality()` rend `low` sur le matériel de développement comme sur Quest, et livrer un chemin que l'on ne peut pas voir tourner serait livrer du code non vérifié. Le niveau `low` de la table est implémenté **en entier**.

---

## File Structure

| Fichier | Responsabilité |
| :--- | :--- |
| `packages/world/src/water/waves.ts` **(créé)** | Pur, sans Three : le jeu de vagues de Gerstner et sa validation. Aucune notion de géométrie. |
| `packages/world/src/water/riverGeometry.ts` **(créé)** | Pur sauf pour `BufferGeometry` : maille le ruban depuis le cours, avec profondeur et direction d'écoulement par sommet. |
| `packages/world/src/water/WaterMaterial.ts` **(créé)** | Le nuanceur : Gerstner au sommet, profondeur/Fresnel/écume au fragment. Le seul fichier de GLSL. |
| `packages/world/src/water/components.ts` **(créé)** | Composant `WaterSurface`. |
| `packages/world/src/water/WaterSystem.ts` **(créé)** | Avance le temps, accorde la couleur de l'eau au ciel du moment. |
| `packages/world/src/install.ts` **(modifié)** | Enregistre le composant et le système, construit le ruban. |
| `apps/demo/src/simulation/ProceduralRiver.ts` **(supprimé)** | Remplacé par le module `water/`. |

**Pourquoi séparer les vagues du maillage.** Les vagues de Gerstner ont une propriété qu'il faut absolument tester — la somme des raideurs doit rester sous 1, sinon les crêtes se replient sur elles-mêmes et la surface s'auto-intersecte. C'est un défaut classique, invisible sur une capture et évident dans un casque. Isolées dans un module pur, ces vagues se vérifient sans GPU.

---

### Task 1: Les vagues de Gerstner

**Files:**
- Create: `packages/world/src/water/waves.ts`
- Test: `packages/world/test/waves.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `interface GerstnerWave { dirX: number; dirZ: number; steepness: number; wavelength: number; speed: number }`
  - `RIVER_WAVES_LOW: readonly GerstnerWave[]` — 3 vagues
  - `totalSteepness(waves: readonly GerstnerWave[]): number`
  - `gerstnerDisplacement(waves, x, z, time): { x: number; y: number; z: number }`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/waves.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  RIVER_WAVES_LOW,
  totalSteepness,
  gerstnerDisplacement,
  type GerstnerWave,
} from '../src/water/waves';

describe('jeu de vagues', () => {
  it('déclare trois vagues, comme le prévoit le niveau bas de la spec', () => {
    expect(RIVER_WAVES_LOW.length).toBe(3);
  });

  it("NE S'AUTO-INTERSECTE PAS : la somme des raideurs reste sous 1", () => {
    // Au-delà de 1, les crêtes de Gerstner se replient sur elles-mêmes et la
    // surface se retourne. Le défaut est invisible sur une capture de face et
    // saute aux yeux dans un casque.
    expect(totalSteepness(RIVER_WAVES_LOW)).toBeLessThan(1);
  });

  it('décrit des vagues plausibles : direction unitaire, longueur et vitesse positives', () => {
    for (const w of RIVER_WAVES_LOW) {
      expect(Math.hypot(w.dirX, w.dirZ)).toBeCloseTo(1, 6);
      expect(w.wavelength).toBeGreaterThan(0);
      expect(w.speed).toBeGreaterThan(0);
      expect(w.steepness).toBeGreaterThan(0);
    }
  });

  it('mêle des longueurs différentes : des vagues identiques ne feraient qu\'une', () => {
    const lengths = new Set(RIVER_WAVES_LOW.map((w) => w.wavelength));
    expect(lengths.size).toBe(RIVER_WAVES_LOW.length);
  });
});

describe('gerstnerDisplacement', () => {
  it('est nul quand il n\'y a pas de vague', () => {
    const d = gerstnerDisplacement([], 3, 4, 1.5);
    expect(d.x).toBe(0);
    expect(d.y).toBe(0);
    expect(d.z).toBe(0);
  });

  it('reste borné par la somme des amplitudes', () => {
    // Amplitude d'une vague de Gerstner : steepness x wavelength / (2 pi).
    const bound = RIVER_WAVES_LOW.reduce(
      (acc, w) => acc + (w.steepness * w.wavelength) / (2 * Math.PI),
      0,
    );
    for (let i = 0; i < 400; i++) {
      const d = gerstnerDisplacement(RIVER_WAVES_LOW, i * 0.7, i * -0.3, i * 0.05);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(bound + 1e-9);
      expect(Math.hypot(d.x, d.z)).toBeLessThanOrEqual(bound + 1e-9);
    }
  });

  it('est déterministe', () => {
    const a = gerstnerDisplacement(RIVER_WAVES_LOW, 2.5, -1.25, 3);
    const b = gerstnerDisplacement(RIVER_WAVES_LOW, 2.5, -1.25, 3);
    expect(a).toEqual(b);
  });

  it('BOUGE avec le temps : une eau figée n\'est pas de l\'eau', () => {
    const t0 = gerstnerDisplacement(RIVER_WAVES_LOW, 5, 5, 0);
    const t1 = gerstnerDisplacement(RIVER_WAVES_LOW, 5, 5, 1.7);
    expect(Math.abs(t1.y - t0.y)).toBeGreaterThan(1e-4);
  });

  it('se répète dans le temps, vague par vague', () => {
    // Une vague de Gerstner est périodique de période wavelength / speed.
    const single: GerstnerWave[] = [
      { dirX: 1, dirZ: 0, steepness: 0.3, wavelength: 4, speed: 2 },
    ];
    const period = 4 / 2;
    const a = gerstnerDisplacement(single, 1.3, 0, 0.4);
    const b = gerstnerDisplacement(single, 1.3, 0, 0.4 + period);
    expect(b.y).toBeCloseTo(a.y, 9);
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test waves`
Expected: FAIL — `Failed to resolve import "../src/water/waves"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `packages/world/src/water/waves.ts` :

```ts
/**
 * Vagues de Gerstner (spec §7).
 *
 * Ce module est pur et sans Three parce qu'il porte une propriété que l'on ne
 * peut pas vérifier autrement : la SOMME DES RAIDEURS doit rester sous 1. Au
 * delà, les crêtes se replient sur elles-mêmes et la surface se retourne —
 * défaut invisible sur une capture de face, criant dans un casque.
 *
 * Le nuanceur reprend exactement ces mêmes formules ; ce fichier en est la
 * référence testable.
 */

export interface GerstnerWave {
  /** Direction de propagation, unitaire. */
  readonly dirX: number;
  readonly dirZ: number;
  /** Raideur dans [0, 1[. Leur somme borne la cambrure de la crête. */
  readonly steepness: number;
  /** Longueur d'onde en mètres. */
  readonly wavelength: number;
  /** Vitesse de phase en mètres par seconde. */
  readonly speed: number;
}

/**
 * Trois vagues, comme le prescrit le niveau `low` de la table §7 pour Quest.
 * Longueurs distinctes et directions décorrélées : trois vagues identiques
 * n'en feraient qu'une, plus haute.
 */
export const RIVER_WAVES_LOW: readonly GerstnerWave[] = [
  { dirX: 1, dirZ: 0, steepness: 0.18, wavelength: 3.1, speed: 1.1 },
  { dirX: 0.7071, dirZ: 0.7071, steepness: 0.12, wavelength: 1.7, speed: 0.8 },
  { dirX: -0.3162, dirZ: 0.9487, steepness: 0.08, wavelength: 0.9, speed: 0.55 },
];

export function totalSteepness(waves: readonly GerstnerWave[]): number {
  let sum = 0;
  for (const w of waves) sum += w.steepness;
  return sum;
}

/**
 * Déplacement de Gerstner en un point. Les vagues déplacent aussi
 * HORIZONTALEMENT : c'est ce qui creuse les creux et affûte les crêtes, et ce
 * qui distingue Gerstner d'une simple somme de sinus.
 */
export function gerstnerDisplacement(
  waves: readonly GerstnerWave[],
  x: number,
  z: number,
  time: number,
): { x: number; y: number; z: number } {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (const w of waves) {
    const k = (2 * Math.PI) / w.wavelength;
    const amplitude = w.steepness / k;
    const phase = k * (w.dirX * x + w.dirZ * z) - w.speed * k * time;
    const cosine = Math.cos(phase);
    dx += w.dirX * amplitude * cosine;
    dz += w.dirZ * amplitude * cosine;
    dy += amplitude * Math.sin(phase);
  }
  return { x: dx, y: dy, z: dz };
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test waves`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/world/src/water/waves.ts packages/world/test/waves.test.ts
git commit -m "feat(world): Gerstner wave set with a tested self-intersection bound"
```

---

### Task 2: Le ruban d'eau et sa profondeur

**Files:**
- Create: `packages/world/src/water/riverGeometry.ts`
- Test: `packages/world/test/river-geometry.test.ts`

**Interfaces:**
- Consumes: `getRiverCourse`, `riverSurfaceAt`, `heightAt` de `@iwsdk/cardinal-simulation` ; `BufferGeometry`, `Float32BufferAttribute`, `Uint32BufferAttribute` de `@iwsdk/core`.
- Produces:
  - `RIVER_COLUMNS: number` (`7`)
  - `WATER_EDGE_LIFT: number` (`0.02`)
  - `buildRiverGeometry(): BufferGeometry` — attributs `position`, `aDepth`, `aFlow`, `index`
  - `riverVertexCount(points: number, columns?: number): number`

**La technique centrale de la spec.** La profondeur est calculée **au sommet, côté CPU**, comme `riverSurfaceAt − heightAt`, et stockée dans l'attribut `aDepth`. Le nuanceur l'interpole gratuitement. On supprime ainsi le poste le plus coûteux d'une eau réaliste sur mobile — la passe ou cible de rendu de profondeur — et surtout **on rend la divergence impossible** : l'eau et le terrain lisent la même fonction du moteur.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/river-geometry.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  buildRiverGeometry,
  riverVertexCount,
  RIVER_COLUMNS,
  WATER_EDGE_LIFT,
} from '../src/water/riverGeometry';
import { getRiverCourse, riverSurfaceAt, heightAt } from '@iwsdk/cardinal-simulation';

describe('buildRiverGeometry', () => {
  const geom = buildRiverGeometry();
  const course = getRiverCourse();

  it('maille une rangée par point de cours', () => {
    expect(riverVertexCount(course.points.length)).toBe(course.points.length * RIVER_COLUMNS);
    expect(geom.getAttribute('position').count).toBe(riverVertexCount(course.points.length));
  });

  it('porte la profondeur et l\'écoulement par sommet', () => {
    const verts = riverVertexCount(course.points.length);
    expect(geom.getAttribute('aDepth').count).toBe(verts);
    expect(geom.getAttribute('aFlow').count).toBe(verts);
  });

  it('POSE LA NAPPE À LA HAUTEUR DU MOTEUR, jamais à une réimplémentation', () => {
    // Si la surface d'eau divergeait de riverSurfaceAt, la rivière flotterait
    // au-dessus de son lit ou disparaîtrait dedans.
    const pos = geom.getAttribute('position');
    for (let row = 0; row < course.points.length; row += 7) {
      const centre = row * RIVER_COLUMNS + Math.floor(RIVER_COLUMNS / 2);
      const p = course.points[row]!;
      expect(pos.getY(centre)).toBeCloseTo(riverSurfaceAt(p.x, p.z) + WATER_EDGE_LIFT, 5);
    }
  });

  it('rend une profondeur positive, nulle aux berges et maximale au centre', () => {
    const depth = geom.getAttribute('aDepth');
    for (let i = 0; i < depth.count; i++) expect(depth.getX(i)).toBeGreaterThanOrEqual(0);

    for (let row = 0; row < course.points.length; row += 11) {
      const base = row * RIVER_COLUMNS;
      const centre = depth.getX(base + Math.floor(RIVER_COLUMNS / 2));
      expect(depth.getX(base), `berge gauche, rangée ${row}`).toBeLessThanOrEqual(centre);
      expect(depth.getX(base + RIVER_COLUMNS - 1), `berge droite`).toBeLessThanOrEqual(centre);
    }
  });

  it('accorde la profondeur avec le terrain du moteur', () => {
    const pos = geom.getAttribute('position');
    const depth = geom.getAttribute('aDepth');
    for (let i = 0; i < pos.count; i += 13) {
      const expected = Math.max(0, pos.getY(i) - WATER_EDGE_LIFT - heightAt(pos.getX(i), pos.getZ(i)));
      expect(depth.getX(i)).toBeCloseTo(expected, 4);
    }
  });

  it("porte une direction d'écoulement unitaire", () => {
    const flow = geom.getAttribute('aFlow');
    for (let i = 0; i < flow.count; i += 17) {
      expect(Math.hypot(flow.getX(i), flow.getY(i))).toBeCloseTo(1, 4);
    }
  });

  it('indexe deux triangles par quad, sans sommet inexistant', () => {
    const idx = geom.getIndex()!;
    const rows = course.points.length;
    expect(idx.count).toBe((rows - 1) * (RIVER_COLUMNS - 1) * 6);
    const verts = riverVertexCount(rows);
    for (let i = 0; i < idx.count; i += 7) {
      expect(idx.getX(i)).toBeGreaterThanOrEqual(0);
      expect(idx.getX(i)).toBeLessThan(verts);
    }
  });

  it('ne produit aucun NaN', () => {
    for (const name of ['position', 'aDepth', 'aFlow']) {
      const a = geom.getAttribute(name);
      for (let i = 0; i < a.array.length; i++) {
        expect(Number.isFinite(a.array[i] as number), `${name}[${i}]`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test river-geometry`
Expected: FAIL — le module n'existe pas.

- [ ] **Step 3: Compléter le mock avec les accesseurs manquants**

Le mock de `@iwsdk/core` expose déjà `BufferGeometry`, `Float32BufferAttribute` et `Uint32BufferAttribute` (phase 3B). Il lui manque l'accès brut au tableau pour le test de NaN — vérifier que `BufferAttribute` expose bien `array` en public ; c'est le cas depuis la phase 3B, aucune modification n'est nécessaire.

- [ ] **Step 4: Écrire l'implémentation**

Créer `packages/world/src/water/riverGeometry.ts` :

```ts
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from '@iwsdk/core';
import { getRiverCourse, riverSurfaceAt, heightAt } from '@iwsdk/cardinal-simulation';

/**
 * Le ruban d'eau (spec §7).
 *
 * LA PROFONDEUR EST CALCULÉE AU SOMMET, CÔTÉ CPU, avec la fonction du moteur,
 * puis stockée comme attribut. Le nuanceur l'interpole gratuitement. On
 * supprime ainsi le poste le plus coûteux d'une eau réaliste sur mobile — la
 * cible de rendu de profondeur — et l'on rend surtout la divergence
 * impossible : l'eau et le terrain lisent la même fonction.
 */

/** Colonnes de sommets en travers du lit. Impair, pour avoir un axe. */
export const RIVER_COLUMNS = 7;

/** La nappe est posée un rien au-dessus de sa hauteur exacte, pour ne pas
 *  lutter contre le lit dans le tampon de profondeur. */
export const WATER_EDGE_LIFT = 0.02;

/** Le ruban déborde un peu du lit, pour que l'écume ait où mourir. */
const WIDTH_MARGIN = 1.25;

export function riverVertexCount(points: number, columns = RIVER_COLUMNS): number {
  return points * columns;
}

export function buildRiverGeometry(): BufferGeometry {
  const course = getRiverCourse();
  const rows = course.points.length;
  const cols = RIVER_COLUMNS;
  const count = riverVertexCount(rows, cols);

  const positions = new Float32Array(count * 3);
  const depths = new Float32Array(count);
  const flows = new Float32Array(count * 2);
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);

  for (let row = 0; row < rows; row++) {
    const p = course.points[row]!;
    // Tangente : la direction de l'écoulement, prise sur les points voisins.
    const previous = course.points[Math.max(0, row - 1)]!;
    const next = course.points[Math.min(rows - 1, row + 1)]!;
    let tx = next.x - previous.x;
    let tz = next.z - previous.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // Perpendiculaire : la direction en travers du lit.
    const px = -tz;
    const pz = tx;

    const surface = riverSurfaceAt(p.x, p.z) + WATER_EDGE_LIFT;
    const half = p.width * WIDTH_MARGIN;

    for (let col = 0; col < cols; col++) {
      const t = (col / (cols - 1)) * 2 - 1; // -1 (berge) .. +1 (berge)
      const x = p.x + px * half * t;
      const z = p.z + pz * half * t;
      const v = row * cols + col;

      positions[v * 3] = x;
      positions[v * 3 + 1] = surface;
      positions[v * 3 + 2] = z;
      // La profondeur vient du MOTEUR, pas d'un profil inventé.
      depths[v] = Math.max(0, surface - WATER_EDGE_LIFT - heightAt(x, z));
      flows[v * 2] = tx;
      flows[v * 2 + 1] = tz;
    }
  }

  let i = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[i++] = a;
      indices[i++] = c;
      indices[i++] = b;
      indices[i++] = b;
      indices[i++] = c;
      indices[i++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new Float32BufferAttribute(depths, 1));
  geometry.setAttribute('aFlow', new Float32BufferAttribute(flows, 2));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test river-geometry`
Expected: PASS, 8 tests.

Si « profondeur nulle aux berges » échoue, `WIDTH_MARGIN` est trop faible : le ruban ne dépasse pas le lit et ses bords sont encore dans l'eau.

- [ ] **Step 6: Commit**

```bash
git add packages/world/src/water/riverGeometry.ts packages/world/test/river-geometry.test.ts
git commit -m "feat(world): river ribbon carrying CPU-computed depth per vertex"
```

---

### Task 3: Le nuanceur d'eau

**Files:**
- Create: `packages/world/src/water/WaterMaterial.ts`
- Modify: `packages/world/test/mocks/iwsdk-core.ts`
- Test: `packages/world/test/water-material.test.ts`

**Interfaces:**
- Consumes: `RIVER_WAVES_LOW`, `GerstnerWave` de `./waves`.
- Produces:
  - `WATER_UNIFORM_NAMES: readonly string[]`
  - `buildWaterUniforms(waves: readonly GerstnerWave[]): Record<string, { value: unknown }>`
  - `waterVertexShader(waveCount: number): string`
  - `waterFragmentShader(): string`
  - `createWaterMaterial(waves?: readonly GerstnerWave[]): ShaderMaterial`

**Ce que ce fichier ne peut pas prouver.** Un nuanceur ne se teste pas unitairement : il faut un GPU pour le compiler. Le plan répond à cela en poussant **tout ce qui peut vivre en TypeScript** dans les tâches 1 et 2, et en ne laissant ici que la consommation d'attributs et d'uniformes. Ce qui reste vérifiable — qu'aucune uniforme utilisée ne soit absente des déclarations — l'est ci-dessous : un nom mal orthographié ne lève rien, il vaut zéro à l'exécution et l'eau devient noire ou immobile sans un mot.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/water-material.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  WATER_UNIFORM_NAMES,
  buildWaterUniforms,
  waterVertexShader,
  waterFragmentShader,
} from '../src/water/WaterMaterial';
import { RIVER_WAVES_LOW } from '../src/water/waves';

describe('uniformes', () => {
  const uniforms = buildWaterUniforms(RIVER_WAVES_LOW);

  it('déclare exactement les uniformes annoncées', () => {
    expect(Object.keys(uniforms).sort()).toEqual([...WATER_UNIFORM_NAMES].sort());
  });

  it('aplatit cinq flottants par vague', () => {
    const packed = uniforms.uWaves!.value as number[];
    expect(packed.length).toBe(RIVER_WAVES_LOW.length * 5);
  });

  it('part à temps nul', () => {
    expect(uniforms.uTime!.value).toBe(0);
  });
});

describe('sources GLSL', () => {
  const vertex = waterVertexShader(RIVER_WAVES_LOW.length);
  const fragment = waterFragmentShader();

  it("n'utilise AUCUNE uniforme non déclarée", () => {
    const source = `${vertex}\n${fragment}`;
    const used = new Set(
      [...source.matchAll(/\buniform\s+\w+\s+(\w+)/g)].map((m) => (m[1] as string).replace(/\[.*/, '')),
    );
    for (const name of used) {
      expect(WATER_UNIFORM_NAMES, `uniforme ${name} utilisée mais non déclarée`).toContain(name);
    }
    expect(used.size).toBeGreaterThan(3);
  });

  it('consomme les attributs que la géométrie fournit', () => {
    expect(vertex).toContain('aDepth');
    expect(vertex).toContain('aFlow');
  });

  it('transmet la profondeur au fragment', () => {
    expect(vertex).toMatch(/varying\s+float\s+vDepth/);
    expect(fragment).toMatch(/varying\s+float\s+vDepth/);
  });

  it('déroule une itération par vague déclarée', () => {
    // GLSL ES 1.0 exige des bornes de boucle constantes, et le nombre de
    // vagues dépend du niveau de qualité : la boucle est donc déroulée.
    const three = waterVertexShader(3);
    const one = waterVertexShader(1);
    expect(three.length).toBeGreaterThan(one.length);
    expect(three).toContain('uWaves[10]');
    expect(one).not.toContain('uWaves[5]');
  });

  it('calcule un Fresnel de Schlick et une écume de rive', () => {
    expect(fragment).toContain('fresnel');
    expect(fragment).toContain('foam');
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test water-material`
Expected: FAIL — le module n'existe pas.

- [ ] **Step 3: Compléter le mock**

Ajouter à la fin de `packages/world/test/mocks/iwsdk-core.ts` :

```ts
export const DoubleSide = 2;

export class Color {
  public r = 1;
  public g = 1;
  public b = 1;
  constructor(hex = 0xffffff) {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
  }
  setRGB(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }
}

export class ShaderMaterial {
  public uniforms: Record<string, { value: unknown }> = {};
  public vertexShader = '';
  public fragmentShader = '';
  public transparent = false;
  public side = 0;
  public depthWrite = true;
  public disposed = false;
  constructor(parameters: Record<string, unknown> = {}) {
    Object.assign(this, parameters);
  }
  dispose(): void {
    this.disposed = true;
  }
}
```

- [ ] **Step 4: Écrire l'implémentation**

Créer `packages/world/src/water/WaterMaterial.ts` :

```ts
import { ShaderMaterial, DoubleSide, Color } from '@iwsdk/core';
import { RIVER_WAVES_LOW, type GerstnerWave } from './waves';

/**
 * Le nuanceur d'eau (spec §7, niveau `low`).
 *
 * Tout ce qui pouvait être testé vit ailleurs — les vagues dans `waves.ts`, la
 * profondeur dans `riverGeometry.ts`. Il ne reste ici que la consommation
 * d'attributs et d'uniformes, un nuanceur exigeant un GPU pour être compilé.
 *
 * Le niveau `high` de la table §7 — réflexion planaire, cible de réfraction,
 * caustiques — n'est pas implémenté : `detectQuality()` rend `low` aussi bien
 * sur le matériel de développement que sur Quest, et livrer un chemin que nul
 * ne peut voir tourner serait livrer du code non vérifié.
 */

export const WATER_UNIFORM_NAMES: readonly string[] = [
  'uTime',
  'uWaves',
  'uShallowColor',
  'uDeepColor',
  'uSkyColor',
  'uFoamWidth',
  'uOpacity',
];

/** Cinq flottants par vague : direction, raideur, longueur, vitesse. */
export function buildWaterUniforms(
  waves: readonly GerstnerWave[],
): Record<string, { value: unknown }> {
  const packed: number[] = [];
  for (const w of waves) packed.push(w.dirX, w.dirZ, w.steepness, w.wavelength, w.speed);
  return {
    uTime: { value: 0 },
    uWaves: { value: packed },
    uShallowColor: { value: new Color(0x6fb3c9) },
    uDeepColor: { value: new Color(0x0b3d5c) },
    uSkyColor: { value: new Color(0x87b6de) },
    uFoamWidth: { value: 0.28 },
    uOpacity: { value: 0.86 },
  };
}

export function waterVertexShader(waveCount: number): string {
  // La boucle est DÉROULÉE : GLSL ES 1.0 exige des bornes constantes, et le
  // nombre de vagues dépend du niveau de qualité.
  let unrolled = '';
  for (let i = 0; i < waveCount; i++) {
    const b = i * 5;
    unrolled += `
  {
    vec2 dir = vec2(uWaves[${b}], uWaves[${b + 1}]);
    float steepness = uWaves[${b + 2}];
    float wavelength = uWaves[${b + 3}];
    float speed = uWaves[${b + 4}];
    float k = 6.2831853 / wavelength;
    float amplitude = steepness / k;
    float phase = k * dot(dir, position.xz) - speed * k * uTime;
    displaced.x += shore * dir.x * amplitude * cos(phase);
    displaced.z += shore * dir.y * amplitude * cos(phase);
    displaced.y += shore * amplitude * sin(phase);
  }`;
  }

  return `
uniform float uTime;
uniform float uWaves[${waveCount * 5}];
attribute float aDepth;
attribute vec2 aFlow;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vec3 displaced = position;
  // Les vagues s'éteignent près de la berge : une crête sur trois centimètres
  // d'eau flotterait dans le vide.
  float shore = smoothstep(0.0, 0.35, aDepth);
${unrolled}
  vDepth = aDepth;
  vFlow = aFlow;
  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vWorldNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
}

export function waterFragmentShader(): string {
  return `
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uSkyColor;
uniform float uFoamWidth;
uniform float uOpacity;
uniform float uTime;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  // Réfraction du pauvre : la couleur s'assombrit avec la profondeur, ce qui
  // remplace une cible de réfraction pour un coût nul.
  float t = clamp(vDepth / 1.4, 0.0, 1.0);
  vec3 body = mix(uShallowColor, uDeepColor, t);

  // Fresnel de Schlick : l'eau réfléchit le ciel d'autant plus qu'on la
  // regarde de biais.
  float cosTheta = clamp(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
  vec3 colour = mix(body, uSkyColor, fresnel);

  // Écume de rive, tirée de la SEULE profondeur — sans passe supplémentaire.
  float foam = 1.0 - smoothstep(0.0, uFoamWidth, vDepth);
  float ripple = 0.5 + 0.5 * sin(uTime * 3.0 + vFlow.x * 6.0 + vFlow.y * 4.0);
  colour = mix(colour, vec3(0.93, 0.96, 0.98), foam * (0.55 + 0.45 * ripple));

  // Le bord du ruban s'efface : une arête franche trahirait la géométrie.
  float alpha = uOpacity * smoothstep(0.0, 0.06, vDepth);
  gl_FragColor = vec4(colour, clamp(alpha + foam * 0.4, 0.0, 1.0));
}
`;
}

export function createWaterMaterial(
  waves: readonly GerstnerWave[] = RIVER_WAVES_LOW,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: buildWaterUniforms(waves),
    vertexShader: waterVertexShader(waves.length),
    fragmentShader: waterFragmentShader(),
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });
}
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test water-material`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/world/src/water/WaterMaterial.ts packages/world/test/water-material.test.ts \
        packages/world/test/mocks/iwsdk-core.ts
git commit -m "feat(world): water shader with depth gradient, Schlick fresnel and shoreline foam"
```

---

### Task 4: Câblage ECS et remplacement de l'ancienne rivière

**Files:**
- Create: `packages/world/src/water/components.ts`
- Create: `packages/world/src/water/WaterSystem.ts`
- Modify: `packages/world/src/install.ts`
- Modify: `packages/world/src/index.ts`
- Modify: `apps/demo/src/simulation/PrehistoricEnvironment3D.ts`
- Delete: `apps/demo/src/simulation/ProceduralRiver.ts`
- Test: `packages/world/test/water-system.test.ts`

**Interfaces:**
- Consumes: `createWaterMaterial`, `buildRiverGeometry`, `SkyModel`.
- Produces:
  - `WaterSurface` — composant elics, champ `_needsBuild` (`Types.Boolean`)
  - `WaterSystem` avec `elapsed: number` et `MAX_DELTA`
  - `installCardinalWorld` rend en plus `water: WaterSystem`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/water-system.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { WaterSurface } from '../src/water/components';
import { WaterSystem } from '../src/water/WaterSystem';
import { SkyModel } from '../src/atmosphere/components';
import { createWaterMaterial } from '../src/water/WaterMaterial';

function makeRig() {
  const world = new World();
  world.registerComponent(WaterSurface).registerComponent(SkyModel);
  world.registerSystem(WaterSystem);
  const system = world.getSystem(WaterSystem) as WaterSystem;
  const material = createWaterMaterial();
  const entity = world.createEntity();
  (entity as unknown as { object3D: unknown }).object3D = { material };
  entity.addComponent(WaterSurface, {});
  return { world, system, material, entity };
}

describe('WaterSystem', () => {
  it("AVANCE LE TEMPS : sans cela l'eau est un miroir figé", () => {
    const rig = makeRig();
    rig.system.update(0.016, 0);
    rig.system.update(0.016, 0.016);
    expect(rig.system.elapsed).toBeCloseTo(0.032, 6);
    expect(rig.material.uniforms.uTime!.value).toBeCloseTo(0.032, 6);
  });

  it("n'accumule pas un delta absurde si une image saute", () => {
    // Un onglet réveillé après une minute enverrait un delta géant, et l'eau
    // sauterait d'un coup au lieu de couler.
    const rig = makeRig();
    rig.system.update(45, 45);
    expect(rig.system.elapsed).toBeLessThan(1);
  });

  it("accorde la couleur réfléchie au ciel du moment", () => {
    // Une eau qui reste bleu ciel à minuit trahit toute la scène.
    const rig = makeRig();
    const sky = rig.world.createEntity();
    sky.addComponent(SkyModel, { exposure: 0.2 });
    rig.system.update(0.016, 0);
    const tint = rig.material.uniforms.uSkyColor!.value as { r: number };
    expect(tint.r).toBeCloseTo(0.53 * 0.2, 5);
  });

  it('survit à une entité sans matériau', () => {
    const world = new World();
    world.registerComponent(WaterSurface).registerComponent(SkyModel);
    world.registerSystem(WaterSystem);
    const system = world.getSystem(WaterSystem) as WaterSystem;
    const entity = world.createEntity();
    entity.addComponent(WaterSurface, {});
    expect(() => system.update(0.016, 0)).not.toThrow();
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test water-system`
Expected: FAIL — les modules n'existent pas.

- [ ] **Step 3: Écrire le composant**

Créer `packages/world/src/water/components.ts` :

```ts
import { Types, createComponent } from '@iwsdk/core';

/** Marque une entité comme surface d'eau animée (spec §7). */
export const WaterSurface = createComponent(
  'WaterSurface',
  {
    _needsBuild: { type: Types.Boolean, default: true },
  },
  'Animated water surface',
);
```

- [ ] **Step 4: Écrire le système**

Créer `packages/world/src/water/WaterSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import { WaterSurface } from './components';
import { SkyModel } from '../atmosphere/components';

/** Au-delà, on considère que l'image a sauté plutôt que ralenti. */
const MAX_DELTA = 0.1;

/**
 * Anime la nappe (spec §7).
 *
 * Le seul travail par image est d'avancer une uniforme de temps et d'accorder
 * la couleur réfléchie au ciel du moment : une eau qui reste bleu ciel à
 * minuit trahit toute la scène. La géométrie, elle, est construite une fois.
 */
export class WaterSystem extends createSystem({
  surfaces: { required: [WaterSurface] },
  sky: { required: [SkyModel] },
}) {
  public elapsed = 0;

  public override update(delta: number, _time: number): void {
    // Un onglet réveillé après une minute enverrait un delta géant, et l'eau
    // sauterait d'un coup au lieu de couler.
    this.elapsed += Math.min(delta, MAX_DELTA);

    let skyTint = 1;
    for (const entity of this.queries.sky.entities) {
      skyTint = entity.getValue(SkyModel, 'exposure') ?? 1;
      break;
    }

    for (const entity of this.queries.surfaces.entities) {
      const object = (entity as unknown as { object3D?: { material?: unknown } }).object3D;
      const material = object?.material as
        | { uniforms?: Record<string, { value: unknown }> }
        | undefined;
      const uniforms = material?.uniforms;
      if (uniforms === undefined) continue;

      const time = uniforms.uTime;
      if (time !== undefined) time.value = this.elapsed;

      // La couleur du ciel réfléchi suit l'exposition : au crépuscule, l'eau
      // s'assombrit avec le reste du monde.
      const sky = uniforms.uSkyColor?.value as
        | { setRGB: (r: number, g: number, b: number) => void }
        | undefined;
      if (sky !== undefined) sky.setRGB(0.53 * skyTint, 0.71 * skyTint, 0.87 * skyTint);
    }
  }
}
```

- [ ] **Step 5: Câbler l'installation**

Dans `packages/world/src/install.ts` : importer `Mesh` depuis `@iwsdk/core`, plus `WaterSurface`, `WaterSystem`, `buildRiverGeometry`, `createWaterMaterial` ; ajouter `.registerComponent(WaterSurface)` à la chaîne de composants ; enregistrer `world.registerSystem(WaterSystem);` après `TerrainMeshSystem` ; et, dans le rappel `withLevelRoot`, créer la nappe :

```ts
    if (!root.hasComponent(WaterSurface)) {
      const water = new Mesh(buildRiverGeometry(), createWaterMaterial());
      water.name = 'RiverSurface';
      water.castShadow = false;
      water.receiveShadow = false;
      const surface = world.createTransformEntity(water, root);
      surface.addComponent(WaterSurface, {});
    }
```

Étendre la valeur de retour et son type avec `water: world.getSystem(WaterSystem) as WaterSystem`.

Réexporter depuis `packages/world/src/index.ts` :

```ts
export { WaterSurface } from './water/components';
export { WaterSystem } from './water/WaterSystem';
export {
  createWaterMaterial,
  buildWaterUniforms,
  waterVertexShader,
  waterFragmentShader,
  WATER_UNIFORM_NAMES,
} from './water/WaterMaterial';
export { buildRiverGeometry, riverVertexCount, RIVER_COLUMNS } from './water/riverGeometry';
export {
  RIVER_WAVES_LOW,
  totalSteepness,
  gerstnerDisplacement,
  type GerstnerWave,
} from './water/waves';
```

- [ ] **Step 6: Supprimer l'ancienne rivière de la démo**

`apps/demo/src/simulation/ProceduralRiver.ts` étire un plan de 56 m sur les 1685 m du cours — 35 m par segment — et anime une couleur au lieu d'une surface. Le module `water/` le remplace intégralement.

Dans `apps/demo/src/simulation/PrehistoricEnvironment3D.ts`, retirer l'import de `ProceduralRiver`, la ligne `const river = new ProceduralRiver();`, la ligne `const riverMesh = river.createRiver();`, le `root.add(riverMesh);`, et toute exposition de `river` dans le résultat. Si `CardinalSimulationSystem` appelle `updateWater`, retirer cet appel : l'animation appartient désormais à `WaterSystem`.

Puis :

```bash
git rm apps/demo/src/simulation/ProceduralRiver.ts
```

- [ ] **Step 7: Vérification complète**

Run:
```bash
pnpm typecheck && pnpm test && pnpm build && pnpm --filter @iwsdk/plugin-phoenix-demo build
```
Expected: 0 erreur de type ; suite verte (le total passe d'environ 611 à environ 640) ; 18 paquets ; build démo OK.

- [ ] **Step 8: Vérification en session réelle**

C'est ici que le nuanceur est enfin vérifié — rien avant ne peut le faire.

```bash
cd apps/demo && npx iwsdk dev up
```

Après `browserCommandReady: true`, mettre la simulation en pause, forcer midi, puis relever et **rapporter honnêtement** :

1. **La console d'abord** (`npx iwsdk browser logs`, `count` seul et jamais `level`) : une erreur de compilation GLSL y apparaît en toutes lettres et rend le maillage invisible. C'est le premier échec possible et le plus probable.
2. La rivière est visible et **descend** au lieu d'être plate.
3. L'écume marque la rive.
4. Le joueur ne tombe pas — relever `positionRelativeToXROrigin` d'une tuile proche, qui doit rester de l'ordre du mètre.
5. `npx iwsdk scene render-stats` : les appels de dessin ne montent que de 1.

Arrêter : `npx iwsdk dev down`

- [ ] **Step 9: Commit**

```bash
git add -A packages apps
git commit -m "feat(world): animated river surface replaces the flat blue ribbon"
```

---

## Ce que la phase 4 ne fait PAS

- **Pas de mer.** Elle est à 775 m alors que le monde streamé s'arrête à 112 m : rien ne serait visible, donc rien ne serait vérifiable. La technique construite ici s'y appliquera sans changement.
- **Pas de niveau `high`.** Réflexion planaire, cible de réfraction et caustiques attendent un matériel où `detectQuality()` rende `high` — sans quoi ce serait du code non vérifié.
- **Pas de flottaison ni de nage.** Les agents traversent la rivière au ralenti (`navigation.ts`), sans que l'eau les porte.
- **Pas d'écume dynamique** sur les obstacles ni sur les crêtes : l'écume vient de la seule profondeur, ce que la table §7 prescrit au niveau bas.
- **Pas de son.**
