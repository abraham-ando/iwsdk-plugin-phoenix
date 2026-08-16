# Phase 5 — Flore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peupler le monde d'une flore issue de la géographie — semée par une fonction que le moteur et le rendu appellent à l'identique, et rendue par instanciation à trois niveaux de détail.

**Architecture:** `scatterAt` vit dans `packages/simulation`, en mathématiques pures et sans dépendance : c'est la vérité terrain du semis. Les géométries d'arbres sont générées **hors ligne** par un script Node qui pilote ez-tree derrière un substitut de DOM, puis sérialisées en binaire compact ; l'exécution ne charge que ces géométries. `packages/world` les instancie par espèce et par niveau de détail, en suivant les tuiles déjà streamées de la phase 3B.

**Tech Stack:** TypeScript strict, vitest, `@iwsdk/core` (Three), `@dgreenheck/ez-tree` **en outil de build uniquement**.

**Spec:** `docs/superpowers/specs/2026-08-16-environnement-procedural-ecs-design.md` (§8 Flore et faune, §11 phase 5)

## Global Constraints

- `packages/simulation` conserve **zéro dépendance d'exécution**. `scatterAt` s'écrit à la main.
- **Aucun `Math.random()`** : tout semis est un hachage déterministe des coordonnées.
- **ez-tree ne part jamais dans le bundle.** Il passe en `devDependencies` : son module ES pèse 2,87 Mo gzip — dont 3,8 Mo de vingt images en base64 inutiles ici — contre 1,6 Mo pour la démo entière.
- **Importer Three depuis `@iwsdk/core`**, jamais depuis `three`. Le script de build est la seule exception : il tourne dans Node, hors du bundle.
- **Budget : 500 000 triangles visibles** en palier `low`, dont 42 000 déjà pris par le terrain.
- **Ne jamais allouer dans `update()`** ; `entity.dispose()`, jamais `destroy()`.
- TypeScript strict avec `noUncheckedIndexedAccess`.

## Faits établis par sondage, sur lesquels le plan repose

Vérifiés sur le paquet réel v1.1.0, la spec ayant d'abord été écrite depuis le site du projet :

| Fait | Valeur |
| :--- | :--- |
| ez-tree embarque Three ? | **Non** : `import * as B from "three"`, résolu vers `super-three@0.181` |
| Import dans Node ? | Échoue — `TextureLoader` exige `document`. Un leurre de quinze lignes suffit. |
| `generateLODs()` | **N'existe pas.** Le détail se règle par `options.branch.levels`. |
| `branch.levels` sur « Oak Small » | 3 → 6 806 triangles, 2 → 2 772, 1 → 1 108 |
| Préréglages disponibles | 16 (Ash, Aspen, Oak, Bush… en trois tailles) |

---

## File Structure

| Fichier | Responsabilité |
| :--- | :--- |
| `packages/simulation/src/world/scatter.ts` **(créé)** | Pur, sans dépendance : le semis déterministe d'une tuile, dérivé du biome, de la pente et d'un hachage. La vérité terrain de la flore. |
| `packages/simulation/test/scatter.test.ts` **(créé)** | Déterminisme, densité par biome, réserve du village, refus des pentes fortes. |
| `scripts/generate-flora.mjs` **(créé)** | Outil d'atelier : pilote ez-tree derrière un substitut de DOM, produit trois niveaux de détail par espèce, sérialise en binaire. Ne tourne jamais à l'exécution. |
| `apps/demo/public/flora/manifest.json` **(généré)** | Index des espèces, niveaux, décalages et comptes. Versionné. |
| `apps/demo/public/flora/*.bin` **(généré)** | Positions, normales, UV et indices en tableaux typés. Versionnés. |
| `packages/world/src/flora/floraAssets.ts` **(créé)** | Charge le manifeste et le binaire, reconstitue des `BufferGeometry`. Aucune connaissance d'ez-tree. |
| `packages/world/src/flora/components.ts` **(créé)** | Composant `FloraTile`. |
| `packages/world/src/flora/FloraSystem.ts` **(créé)** | Instancie la flore d'une tuile construite, par espèce et par niveau. |
| `packages/world/src/install.ts` **(modifié)** | Enregistre le composant et le système. |
| `apps/demo/src/simulation/ProceduralVegetation.ts` **(supprimé)** | Remplacé par la flore instanciée. |

**Pourquoi le semis vit dans le moteur et pas dans le rendu.** La spec §8 est explicite : « Sans cela, les agents bûcheronneraient sur des arbres invisibles pendant que la forêt visible resterait inerte. » `scatterAt` est donc une fonction du moteur que le rendu consomme, jamais l'inverse.

---

### Task 1: Le semis déterministe

**Files:**
- Create: `packages/simulation/src/world/scatter.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/test/scatter.test.ts`

**Interfaces:**
- Consumes: `biomeAt` et `BiomeId` de `./biomes` ; `slopeAt` de `./terrain` ; `distanceToVillage` de `./relief`.
- Produces:
  - `SCATTER_TILE: number` (`32`) — même grille que les tuiles de terrain
  - `type FloraSpecies = 'oak' | 'aspen' | 'bush'`
  - `FLORA_SPECIES: readonly FloraSpecies[]`
  - `interface ScatterItem { species: FloraSpecies; x: number; z: number; scale: number; rotationY: number }`
  - `scatterAt(tileX: number, tileZ: number): readonly ScatterItem[]`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/simulation/test/scatter.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { scatterAt, SCATTER_TILE, FLORA_SPECIES } from '../src/world/scatter';
import { biomeAt } from '../src/world/biomes';
import { slopeAt } from '../src/world/terrain';
import { distanceToVillage } from '../src/world/relief';

describe('scatterAt', () => {
  it('est déterministe', () => {
    const a = scatterAt(3, -2);
    const b = scatterAt(3, -2);
    expect(a).toEqual(b);
  });

  it('sépare les tuiles : deux tuiles voisines ne sèment pas la même chose', () => {
    expect(scatterAt(3, -2)).not.toEqual(scatterAt(4, -2));
  });

  it('POSE CHAQUE PLANT DANS SA PROPRE TUILE', () => {
    // Un plant qui déborde serait semé deux fois, ou pas du tout, selon la
    // tuile chargée — et la forêt vue divergerait de la forêt exploitable.
    for (const [tx, tz] of [
      [0, 2],
      [-3, 1],
      [5, -4],
    ]) {
      for (const item of scatterAt(tx!, tz!)) {
        expect(item.x, `tuile ${tx},${tz}`).toBeGreaterThanOrEqual(tx! * SCATTER_TILE);
        expect(item.x).toBeLessThan((tx! + 1) * SCATTER_TILE);
        expect(item.z).toBeGreaterThanOrEqual(tz! * SCATTER_TILE);
        expect(item.z).toBeLessThan((tz! + 1) * SCATTER_TILE);
      }
    }
  });

  it('ne déclare que des espèces connues, à échelle et rotation plausibles', () => {
    for (let tx = -4; tx <= 4; tx++) {
      for (const item of scatterAt(tx, 3)) {
        expect(FLORA_SPECIES).toContain(item.species);
        expect(item.scale).toBeGreaterThan(0.4);
        expect(item.scale).toBeLessThan(2.5);
        expect(item.rotationY).toBeGreaterThanOrEqual(0);
        expect(item.rotationY).toBeLessThan(Math.PI * 2);
      }
    }
  });

  it("NE SÈME RIEN dans le plateau du village", () => {
    // Les 23 objets de DEFAULT_VILLAGE y sont calés à la main, et le garde-fou
    // d'habitabilité en dépend. Un arbre semé au milieu du foyer casserait tout.
    for (const item of [...scatterAt(0, 0), ...scatterAt(-1, -1), ...scatterAt(0, -1)]) {
      expect(distanceToVillage(item.x, item.z), `plant en (${item.x}, ${item.z})`).toBeGreaterThan(
        12,
      );
    }
  });

  it('REFUSE les pentes fortes : un arbre ne pousse pas sur une falaise', () => {
    for (let tx = -6; tx <= 6; tx += 2) {
      for (let tz = -6; tz <= 6; tz += 2) {
        for (const item of scatterAt(tx, tz)) {
          expect(slopeAt(item.x, item.z), `plant en (${item.x}, ${item.z})`).toBeLessThan(0.7);
        }
      }
    }
  });

  it("SUIT LE BIOME : la forêt porte plus d'arbres que la prairie", () => {
    let forest = 0;
    let forestTiles = 0;
    let grass = 0;
    let grassTiles = 0;
    for (let tx = -8; tx <= 8; tx++) {
      for (let tz = -8; tz <= 8; tz++) {
        const cx = (tx + 0.5) * SCATTER_TILE;
        const cz = (tz + 0.5) * SCATTER_TILE;
        const primary = biomeAt(cx, cz).primary;
        if (primary === 'forest') {
          forest += scatterAt(tx, tz).length;
          forestTiles++;
        } else if (primary === 'grassland') {
          grass += scatterAt(tx, tz).length;
          grassTiles++;
        }
      }
    }
    expect(forestTiles, 'tuiles de forêt échantillonnées').toBeGreaterThan(3);
    expect(grassTiles, 'tuiles de prairie échantillonnées').toBeGreaterThan(3);
    expect(forest / forestTiles).toBeGreaterThan(grass / grassTiles);
  });

  it('reste dans un budget raisonnable par tuile', () => {
    // Une tuile de 32 m qui rendrait cent arbres ruinerait le budget de rendu.
    for (let tx = -8; tx <= 8; tx++) {
      for (let tz = -8; tz <= 8; tz++) {
        expect(scatterAt(tx, tz).length, `tuile ${tx},${tz}`).toBeLessThanOrEqual(24);
      }
    }
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test scatter`
Expected: FAIL — `Failed to resolve import "../src/world/scatter"`.

- [ ] **Step 3: Exporter `distanceToVillage`**

Le test en a besoin, et le semis aussi. Dans `packages/simulation/src/world/relief.ts`, la fonction est déjà exportée depuis la phase 3C — vérifier d'un `grep -n "export function distanceToVillage" packages/simulation/src/world/relief.ts` et l'exporter si ce n'est pas le cas.

- [ ] **Step 4: Écrire l'implémentation**

Créer `packages/simulation/src/world/scatter.ts` :

```ts
import { biomeAt, type BiomeId } from './biomes';
import { slopeAt } from './terrain';
import { distanceToVillage } from './relief';

/**
 * Le semis appartient à la vérité terrain (spec §8).
 *
 * Le moteur y instancie les smart objects exploitables, le rendu y instancie
 * les maillages — la MÊME fonction. Sans cette discipline, les agents
 * bûcheronneraient des arbres invisibles pendant que la forêt visible
 * resterait inerte.
 */

/** Même grille que les tuiles de terrain de la phase 3B. */
export const SCATTER_TILE = 32;

export type FloraSpecies = 'oak' | 'aspen' | 'bush';

export const FLORA_SPECIES: readonly FloraSpecies[] = ['oak', 'aspen', 'bush'];

export interface ScatterItem {
  readonly species: FloraSpecies;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly rotationY: number;
}

/** Rayon autour du village où rien n'est semé : le contenu y est calé à la main. */
const VILLAGE_KEEP_OUT = 14;

/** Au-delà, la pente ne retient plus la terre. */
const MAX_SLOPE = 0.65;

/** Candidats proposés par tuile ; le biome en retient une fraction. */
const CANDIDATES = 36;

/** Densité par biome, dans [0, 1] : la fraction de candidats qui prend racine. */
const DENSITY: Readonly<Record<BiomeId, number>> = {
  ocean: 0,
  beach: 0.02,
  wetland: 0.18,
  grassland: 0.12,
  forest: 0.62,
  rock: 0.03,
  alpine: 0,
};

/** Espèce dominante par biome ; le hachage tranche entre elle et le buisson. */
const DOMINANT: Readonly<Record<BiomeId, FloraSpecies>> = {
  ocean: 'bush',
  beach: 'bush',
  wetland: 'aspen',
  grassland: 'bush',
  forest: 'oak',
  rock: 'bush',
  alpine: 'bush',
};

/** Hachage sans état, même mélange splitmix32 que le bruit du terrain. */
function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 0x1_0000_0000;
}

export function scatterAt(tileX: number, tileZ: number): readonly ScatterItem[] {
  const items: ScatterItem[] = [];
  const originX = tileX * SCATTER_TILE;
  const originZ = tileZ * SCATTER_TILE;

  for (let i = 0; i < CANDIDATES; i++) {
    // Grille perturbée : régulière assez pour ne pas s'agglutiner, désordonnée
    // assez pour ne pas se voir. Le pas reste dans la tuile par construction.
    const side = 6;
    const cell = SCATTER_TILE / side;
    const gx = i % side;
    const gz = Math.floor(i / side);
    const jitterX = hash3(tileX, tileZ, i * 3 + 1);
    const jitterZ = hash3(tileX, tileZ, i * 3 + 2);
    const x = originX + (gx + jitterX * 0.98 + 0.01) * cell;
    const z = originZ + (gz + jitterZ * 0.98 + 0.01) * cell;

    if (distanceToVillage(x, z) <= VILLAGE_KEEP_OUT) continue;
    if (slopeAt(x, z) >= MAX_SLOPE) continue;

    const biome = biomeAt(x, z).primary;
    const roll = hash3(tileX, tileZ, i * 3 + 3);
    if (roll >= DENSITY[biome]) continue;

    // Le sous-bois pousse partout ; l'espèce dominante domine sans monopoliser.
    const speciesRoll = hash3(tileX + 7717, tileZ - 3313, i);
    const species = speciesRoll < 0.72 ? DOMINANT[biome] : 'bush';

    items.push({
      species,
      x,
      z,
      scale: 0.7 + hash3(tileX - 101, tileZ + 211, i) * 1.1,
      rotationY: hash3(tileX + 5501, tileZ + 4409, i) * Math.PI * 2,
    });
  }

  return items;
}
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-simulation test scatter`
Expected: PASS, 8 tests.

Si « suit le biome » échoue faute de tuiles échantillonnées, élargir la fenêtre de balayage plutôt que relâcher l'assertion : c'est le signe que la forêt est plus loin qu'on ne croyait, pas que le semis est mauvais.

- [ ] **Step 6: Exporter et vérifier le paquet**

Dans `packages/simulation/src/index.ts`, ajouter :

```ts
export {
  scatterAt,
  SCATTER_TILE,
  FLORA_SPECIES,
  type FloraSpecies,
  type ScatterItem,
} from './world/scatter';
```

Run: `pnpm --filter @iwsdk/cardinal-simulation test && pnpm --filter @iwsdk/cardinal-simulation typecheck && pnpm --filter @iwsdk/cardinal-simulation build`
Expected: suite verte, 0 erreur, build OK.

- [ ] **Step 7: Commit**

```bash
git add packages/simulation/src/world/scatter.ts packages/simulation/src/index.ts \
        packages/simulation/test/scatter.test.ts
git commit -m "feat(simulation): deterministic flora scatter driven by biome and slope"
```

---

### Task 2: La génération hors ligne des géométries

**Files:**
- Create: `scripts/generate-flora.mjs`
- Modify: `apps/demo/package.json` (ez-tree passe en `devDependencies`)
- Modify: `package.json` (script `flora:generate`)
- Generated: `apps/demo/public/flora/manifest.json`, `apps/demo/public/flora/geometry.bin`
- Test: `scripts/__tests__/flora-manifest.test.mjs`

**Interfaces:**
- Consumes: `@dgreenheck/ez-tree` (build uniquement).
- Produces le format que la tâche 3 consomme :
  - `manifest.json` : `{ version: 1, species: [{ id, lods: [{ level, triangles, position, normal, uv, index }] }] }`, chaque champ étant `{ offset, count }` en octets et en éléments dans `geometry.bin`.

**Pourquoi hors ligne.** Le module ES d'ez-tree pèse **2,87 Mo gzip**, dont 3,8 Mo de vingt images en base64 dont nous n'avons aucun besoin — la `MaterialLibrary` produit déjà écorce et feuillage. La démo entière pèse 1,6 Mo gzip : l'importer à l'exécution la triplerait. Le paquet est un outil d'atelier.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `scripts/__tests__/flora-manifest.test.mjs` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const MANIFEST = 'apps/demo/public/flora/manifest.json';
const BIN = 'apps/demo/public/flora/geometry.bin';

test('le manifeste de flore existe et décrit le binaire', () => {
  assert.ok(existsSync(MANIFEST), `${MANIFEST} manquant : lancer pnpm flora:generate`);
  assert.ok(existsSync(BIN), `${BIN} manquant : lancer pnpm flora:generate`);

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const bin = readFileSync(BIN);

  assert.equal(manifest.version, 1);
  assert.ok(manifest.species.length >= 3, 'au moins trois espèces');

  for (const species of manifest.species) {
    assert.ok(['oak', 'aspen', 'bush'].includes(species.id), `espèce inconnue ${species.id}`);
    assert.equal(species.lods.length, 3, `${species.id} doit porter trois niveaux`);

    let previous = Infinity;
    for (const lod of species.lods) {
      // Chaque niveau est plus léger que le précédent : c'est la raison d'être
      // d'un niveau de détail.
      assert.ok(
        lod.triangles < previous,
        `${species.id} niveau ${lod.level} : ${lod.triangles} triangles, pas moins que ${previous}`,
      );
      previous = lod.triangles;

      for (const field of ['position', 'normal', 'uv', 'index']) {
        const range = lod[field];
        assert.ok(range, `${species.id} niveau ${lod.level} : champ ${field} absent`);
        assert.ok(
          range.offset + range.count * range.bytes <= bin.length,
          `${species.id}.${field} déborde du binaire`,
        );
      }
    }
  }
});

test('le niveau le plus grossier tient dans le budget', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const species of manifest.species) {
    const coarsest = species.lods[species.lods.length - 1];
    // 500 000 triangles visibles au total, terrain compris : un arbre lointain
    // qui coûterait des milliers de triangles interdirait toute forêt.
    assert.ok(
      coarsest.triangles < 2000,
      `${species.id} au niveau le plus grossier : ${coarsest.triangles} triangles`,
    );
  }
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `node --test 'scripts/__tests__/flora-manifest.test.mjs'`
Expected: FAIL — `apps/demo/public/flora/manifest.json manquant`.

- [ ] **Step 3: Écrire le script de génération**

Créer `scripts/generate-flora.mjs` :

```js
#!/usr/bin/env node
/**
 * Outil d'atelier : génère les géométries de flore hors ligne (spec §8).
 *
 * ez-tree ne part JAMAIS dans le bundle. Son module ES pèse 2,87 Mo gzip, dont
 * 3,8 Mo de vingt images en base64 dont nous n'avons aucun besoin — la
 * MaterialLibrary produit déjà écorce et feuillage. Ce script l'exécute une
 * fois et ne conserve que les tableaux de sommets.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ez-tree charge ses textures DÈS L'IMPORT, via un TextureLoader qui appelle
// document.createElementNS. Nous ne voulons aucune de ces images : un leurre
// suffit à laisser passer l'import.
globalThis.document = {
  createElementNS: () => ({
    style: {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    width: 1,
    height: 1,
  }),
  createElement: () => ({ style: {}, getContext: () => null }),
};
globalThis.self = globalThis;
globalThis.window = globalThis;

const { Tree } = await import('@dgreenheck/ez-tree');

const OUT_DIR = 'apps/demo/public/flora';
const MANIFEST = `${OUT_DIR}/manifest.json`;
const BIN = `${OUT_DIR}/geometry.bin`;

/** Espèce -> préréglage ez-tree. Trois niveaux par espèce via branch.levels. */
const SPECIES = [
  { id: 'oak', preset: 'Oak Small' },
  { id: 'aspen', preset: 'Aspen Small' },
  { id: 'bush', preset: 'Bush 1' },
];

/**
 * `generateLODs()` n'existe pas dans ez-tree : on abaisse le branchage.
 *
 * Et l'on part de 2, non de 3. À 6 806 triangles, le niveau le plus fin
 * n'autoriserait que 67 arbres dans tout le champ de vision — 500 000
 * triangles au budget, dont 42 000 pris par le terrain. Un bosquet, pas une
 * forêt. Les trois niveaux livrés sont donc 2 / 1 / 1-sans-feuilles.
 */
const LEVELS = [
  { branch: 2, leaves: 1 },
  { branch: 1, leaves: 1 },
  { branch: 1, leaves: 0 },
];

function buildTree(preset, level, seed) {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  tree.options.branch.levels = level.branch;
  if (level.leaves === 0) tree.options.leaves.count = 0;
  tree.generate();
  return tree;
}

/** Fusionne les maillages d'un arbre en un seul jeu d'attributs. */
function flatten(tree) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let base = 0;
  tree.traverse((object) => {
    const geometry = object.isMesh ? object.geometry : null;
    if (!geometry) return;
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const u = geometry.attributes.uv;
    const idx = geometry.index;
    if (!p || !idx) return;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
      uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + base);
    base += p.count;
  });
  return { positions, normals, uvs, indices };
}

const chunks = [];
let offset = 0;

function push(array, Ctor, bytes) {
  const typed = Ctor.from(array);
  const buffer = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  chunks.push(buffer);
  const range = { offset, count: typed.length, bytes };
  offset += buffer.length;
  return range;
}

const species = [];
for (const entry of SPECIES) {
  const lods = [];
  for (const [levelIndex, level] of LEVELS.entries()) {
    const tree = buildTree(entry.preset, level, 12345);
    const flat = flatten(tree);
    lods.push({
      level: levelIndex,
      triangles: flat.indices.length / 3,
      position: push(flat.positions, Float32Array, 4),
      normal: push(flat.normals, Float32Array, 4),
      uv: push(flat.uvs, Float32Array, 4),
      index: push(flat.indices, Uint32Array, 4),
    });
  }
  species.push({ id: entry.id, lods });
  const counts = lods.map((l) => l.triangles).join(' / ');
  console.log(`${entry.id.padEnd(8)} triangles par niveau : ${counts}`);
}

mkdirSync(dirname(BIN), { recursive: true });
writeFileSync(BIN, Buffer.concat(chunks));
writeFileSync(MANIFEST, `${JSON.stringify({ version: 1, species }, null, 2)}\n`);
console.log(`écrit ${BIN} (${(Buffer.concat(chunks).length / 1024).toFixed(0)} Ko) et ${MANIFEST}`);
```

- [ ] **Step 4: Déclarer le script et déplacer la dépendance**

Dans `package.json` à la racine, ajouter au bloc `scripts` :

```json
"flora:generate": "node scripts/generate-flora.mjs"
```

Dans `apps/demo/package.json`, **déplacer** `"@dgreenheck/ez-tree"` de `dependencies` vers `devDependencies`. C'est ce déplacement qui garantit qu'il ne part pas dans le bundle.

Puis : `pnpm install`

- [ ] **Step 5: Générer et vérifier**

Run: `pnpm flora:generate`
Expected: trois lignes de comptes décroissants, par exemple `oak triangles par niveau : 2772 / 1108 / 620`.

Run: `node --test 'scripts/__tests__/flora-manifest.test.mjs'`
Expected: PASS, 2 tests.

Si un niveau grossier dépasse 2 000 triangles, abaisser aussi `options.leaves.count` pour ce niveau — le feuillage est le poste le plus lourd et le moins visible de loin.

- [ ] **Step 6: Vérifier qu'ez-tree ne part pas dans le bundle**

```bash
pnpm --filter @iwsdk/plugin-phoenix-demo build
grep -rl "ez-tree\|EZTree" apps/demo/dist/assets/*.js || echo "absent du bundle, comme voulu"
```
Expected: `absent du bundle, comme voulu`.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-flora.mjs scripts/__tests__/flora-manifest.test.mjs \
        apps/demo/public/flora package.json apps/demo/package.json pnpm-lock.yaml
git commit -m "feat(build): generate flora geometry offline, keeping ez-tree out of the bundle"
```

---

### Task 3: Le chargement des géométries

**Files:**
- Create: `packages/world/src/flora/floraAssets.ts`
- Test: `packages/world/test/flora-assets.test.ts`

**Interfaces:**
- Consumes: le format de manifeste de la tâche 2.
- Produces:
  - `interface FloraLod { level: number; triangles: number; geometry: BufferGeometry }`
  - `interface FloraAsset { id: FloraSpecies; lods: FloraLod[] }`
  - `parseFloraManifest(manifest: unknown, binary: ArrayBuffer): FloraAsset[]`
  - `loadFloraAssets(baseUrl?: string): Promise<FloraAsset[]>`

**Ce module ne connaît pas ez-tree.** Il lit un manifeste et un binaire, rien d'autre. C'est ce qui permet de le tester sans navigateur et de changer un jour de générateur sans le toucher.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/flora-assets.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { parseFloraManifest } from '../src/flora/floraAssets';

/** Construit un manifeste minimal et son binaire, pour tester sans fichier. */
function makeFixture() {
  const position = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normal = Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uv = Float32Array.from([0, 0, 1, 0, 0, 1]);
  const index = Uint32Array.from([0, 1, 2]);

  const parts = [position, normal, uv, index];
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const binary = new ArrayBuffer(total);
  const view = new Uint8Array(binary);
  let offset = 0;
  const ranges: { offset: number; count: number; bytes: number }[] = [];
  for (const part of parts) {
    view.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), offset);
    ranges.push({ offset, count: part.length, bytes: 4 });
    offset += part.byteLength;
  }

  const manifest = {
    version: 1,
    species: [
      {
        id: 'oak',
        lods: [
          {
            level: 0,
            triangles: 1,
            position: ranges[0],
            normal: ranges[1],
            uv: ranges[2],
            index: ranges[3],
          },
        ],
      },
    ],
  };
  return { manifest, binary };
}

describe('parseFloraManifest', () => {
  it('reconstitue une géométrie par niveau', () => {
    const { manifest, binary } = makeFixture();
    const assets = parseFloraManifest(manifest, binary);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.id).toBe('oak');
    expect(assets[0]!.lods).toHaveLength(1);
  });

  it('restitue EXACTEMENT les sommets écrits', () => {
    // Une erreur d'un octet dans les décalages passerait inaperçue à l'écran
    // sous forme d'arbres tordus ; ici elle échoue franchement.
    const { manifest, binary } = makeFixture();
    const geom = parseFloraManifest(manifest, binary)[0]!.lods[0]!.geometry;
    const pos = geom.getAttribute('position');
    expect(pos.count).toBe(3);
    expect(pos.getX(1)).toBeCloseTo(1, 6);
    expect(pos.getY(2)).toBeCloseTo(1, 6);
    expect(geom.getIndex()!.count).toBe(3);
  });

  it('porte les trois attributs et un index', () => {
    const { manifest, binary } = makeFixture();
    const geom = parseFloraManifest(manifest, binary)[0]!.lods[0]!.geometry;
    for (const name of ['position', 'normal', 'uv']) {
      expect(() => geom.getAttribute(name), name).not.toThrow();
    }
    expect(geom.getIndex()).not.toBeNull();
  });

  it('REFUSE un manifeste de version inconnue', () => {
    // Un format qui change sans que le lecteur le sache produirait des
    // géométries silencieusement fausses.
    const { manifest, binary } = makeFixture();
    expect(() => parseFloraManifest({ ...manifest, version: 99 }, binary)).toThrow(/version/i);
  });

  it('REFUSE une plage qui déborde du binaire', () => {
    const { manifest, binary } = makeFixture();
    const broken = structuredClone(manifest);
    broken.species[0]!.lods[0]!.position.offset = binary.byteLength;
    expect(() => parseFloraManifest(broken, binary)).toThrow(/déborde|overflow/i);
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test flora-assets`
Expected: FAIL — le module n'existe pas.

- [ ] **Step 3: Écrire l'implémentation**

Créer `packages/world/src/flora/floraAssets.ts` :

```ts
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from '@iwsdk/core';
import type { FloraSpecies } from '@iwsdk/cardinal-simulation';

/**
 * Lecture des géométries de flore générées hors ligne (spec §8).
 *
 * Ce module ne connaît PAS ez-tree : il lit un manifeste et un binaire. C'est
 * ce qui permet de le tester sans navigateur, et de changer un jour de
 * générateur sans y toucher.
 */

const SUPPORTED_VERSION = 1;

interface Range {
  readonly offset: number;
  readonly count: number;
  readonly bytes: number;
}

export interface FloraLod {
  readonly level: number;
  readonly triangles: number;
  readonly geometry: BufferGeometry;
}

export interface FloraAsset {
  readonly id: FloraSpecies;
  readonly lods: FloraLod[];
}

function slice(binary: ArrayBuffer, range: Range, label: string): { f32: Float32Array } {
  const end = range.offset + range.count * range.bytes;
  if (end > binary.byteLength) {
    throw new Error(`flore : la plage ${label} déborde du binaire (${end} > ${binary.byteLength})`);
  }
  return { f32: new Float32Array(binary.slice(range.offset, end)) };
}

export function parseFloraManifest(manifest: unknown, binary: ArrayBuffer): FloraAsset[] {
  const doc = manifest as { version?: number; species?: unknown[] };
  if (doc.version !== SUPPORTED_VERSION) {
    throw new Error(
      `flore : version de manifeste ${String(doc.version)} non prise en charge (attendu ${SUPPORTED_VERSION})`,
    );
  }

  const assets: FloraAsset[] = [];
  for (const raw of doc.species ?? []) {
    const entry = raw as { id: FloraSpecies; lods: (Record<string, Range> & { level: number; triangles: number })[] };
    const lods: FloraLod[] = [];
    for (const lod of entry.lods) {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(slice(binary, lod.position, `${entry.id}.position`).f32, 3),
      );
      geometry.setAttribute(
        'normal',
        new Float32BufferAttribute(slice(binary, lod.normal, `${entry.id}.normal`).f32, 3),
      );
      geometry.setAttribute(
        'uv',
        new Float32BufferAttribute(slice(binary, lod.uv, `${entry.id}.uv`).f32, 2),
      );
      const indexEnd = lod.index.offset + lod.index.count * lod.index.bytes;
      if (indexEnd > binary.byteLength) {
        throw new Error(`flore : la plage ${entry.id}.index déborde du binaire`);
      }
      geometry.setIndex(
        new Uint32BufferAttribute(new Uint32Array(binary.slice(lod.index.offset, indexEnd)), 1),
      );
      geometry.computeBoundingSphere();
      lods.push({ level: lod.level, triangles: lod.triangles, geometry });
    }
    assets.push({ id: entry.id, lods });
  }
  return assets;
}

export async function loadFloraAssets(baseUrl = '/flora'): Promise<FloraAsset[]> {
  const [manifest, binary] = await Promise.all([
    fetch(`${baseUrl}/manifest.json`).then((r) => r.json()),
    fetch(`${baseUrl}/geometry.bin`).then((r) => r.arrayBuffer()),
  ]);
  return parseFloraManifest(manifest, binary);
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test flora-assets`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/world/src/flora/floraAssets.ts packages/world/test/flora-assets.test.ts
git commit -m "feat(world): read offline-generated flora geometry, ez-tree unknown to the runtime"
```

---

### Task 4: L'instanciation par tuile

**Files:**
- Create: `packages/world/src/flora/components.ts`
- Create: `packages/world/src/flora/FloraSystem.ts`
- Modify: `packages/world/src/install.ts`
- Modify: `packages/world/src/index.ts`
- Modify: `packages/world/test/mocks/iwsdk-core.ts` (`InstancedMesh`, `Matrix4`, `Object3D`)
- Modify: `apps/demo/src/simulation/PrehistoricEnvironment3D.ts`
- Delete: `apps/demo/src/simulation/ProceduralVegetation.ts`
- Test: `packages/world/test/flora-system.test.ts`

**Interfaces:**
- Consumes: `scatterAt`, `SCATTER_TILE`, `FLORA_SPECIES` du moteur ; `FloraAsset` de la tâche 3 ; `TerrainTile` de la phase 3B.
- Produces:
  - `FloraTile` — composant elics, champs `tx`, `tz` (`Types.Int16`), `_needsPlant` (`Types.Boolean`)
  - `FloraSystem` avec `plantedTiles: number`, `instanceCount: number`, `lastLevelNear: number`, `lastLevelFar: number`
  - `lodForRing(ring: number): number` réutilisé de `terrain/tiling`

- [ ] **Step 1: Compléter le mock**

Ajouter à `packages/world/test/mocks/iwsdk-core.ts` :

```ts
export class Matrix4 {
  public elements = new Float32Array(16);
  compose(): this {
    return this;
  }
  makeRotationY(): this {
    return this;
  }
}

export class InstancedMesh {
  public count = 0;
  public instanceMatrix = { needsUpdate: false };
  public name = '';
  public castShadow = false;
  public receiveShadow = false;
  public disposed = false;
  private matrices: Matrix4[] = [];
  constructor(
    public geometry: BufferGeometry,
    public material: unknown,
    public capacity: number,
  ) {}
  setMatrixAt(index: number, matrix: Matrix4): void {
    this.matrices[index] = matrix;
  }
  getMatrixAt(index: number, target: Matrix4): void {
    const m = this.matrices[index];
    if (m !== undefined) target.elements.set(m.elements);
  }
  dispose(): void {
    this.disposed = true;
  }
}
```

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `packages/world/test/flora-system.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { FloraTile } from '../src/flora/components';
import { FloraSystem } from '../src/flora/FloraSystem';
import { scatterAt } from '@iwsdk/cardinal-simulation';

function makeRig() {
  const world = new World();
  world.registerComponent(FloraTile);
  (world as unknown as { createTransformEntity: unknown }).createTransformEntity = (
    object: unknown,
  ) => {
    const entity = world.createEntity();
    (entity as unknown as { object3D: unknown }).object3D = object;
    const raw = entity as unknown as { dispose?: () => void; destroy: () => void };
    raw.dispose = () => raw.destroy();
    return entity;
  };
  (world as unknown as { activeLevel: unknown }).activeLevel = { peek: () => null };

  // Un jeu d'assets minimal : une géométrie par espèce et par niveau.
  const assets = ['oak', 'aspen', 'bush'].map((id) => ({
    id,
    lods: [0, 1, 2].map((level) => ({ level, triangles: 100, geometry: {} })),
  }));
  world.registerSystem(FloraSystem, { configData: { assets, material: null } });
  const system = world.getSystem(FloraSystem) as FloraSystem;
  return { world, system };
}

describe('FloraSystem', () => {
  it('plante une tuile marquée et baisse son drapeau', () => {
    const rig = makeRig();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: 4, tz: -3, _needsPlant: true });
    rig.system.update(0.016, 0);
    expect(entity.getValue(FloraTile, '_needsPlant')).toBe(false);
    expect(rig.system.plantedTiles).toBe(1);
  });

  it("PLANTE EXACTEMENT ce que le moteur a semé", () => {
    // Si le rendu semait autre chose que scatterAt, les agents bûcheronneraient
    // des arbres invisibles — c'est précisément ce que la spec §8 interdit.
    const rig = makeRig();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: 4, tz: -3, _needsPlant: true });
    rig.system.update(0.016, 0);
    expect(rig.system.instanceCount).toBe(scatterAt(4, -3).length);
  });

  it('ne replante pas une tuile déjà plantée', () => {
    const rig = makeRig();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: 1, tz: 1, _needsPlant: true });
    rig.system.update(0.016, 0);
    const after = rig.system.plantedTiles;
    rig.system.update(0.016, 0.016);
    rig.system.update(0.016, 0.032);
    expect(rig.system.plantedTiles).toBe(after);
  });

  it('CHOISIT UN NIVEAU PLUS GROSSIER AU LOIN', () => {
    // Sans cela, le budget de 500 000 triangles n'autoriserait que quelques
    // dizaines d'arbres dans tout le champ de vision.
    const rig = makeRig();
    const near = rig.world.createEntity();
    near.addComponent(FloraTile, { tx: 0, tz: 0, _needsPlant: true });
    const far = rig.world.createEntity();
    far.addComponent(FloraTile, { tx: 3, tz: 3, _needsPlant: true });
    rig.system.update(0.016, 0);
    expect(rig.system.lastLevelNear).toBeLessThan(rig.system.lastLevelFar);
  });

  it('survit à une tuile vide sans rien planter', () => {
    const rig = makeRig();
    // Une tuile de haute montagne ne porte aucune flore.
    const empty = [...Array(200).keys()]
      .map((i) => ({ tx: i - 100, tz: 60 }))
      .find((t) => scatterAt(t.tx, t.tz).length === 0);
    expect(empty, 'aucune tuile vide trouvée pour le test').toBeDefined();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: empty!.tx, tz: empty!.tz, _needsPlant: true });
    expect(() => rig.system.update(0.016, 0)).not.toThrow();
    expect(entity.getValue(FloraTile, '_needsPlant')).toBe(false);
  });
});
```

- [ ] **Step 3: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test flora-system`
Expected: FAIL — les modules n'existent pas.

- [ ] **Step 4: Écrire le composant**

Créer `packages/world/src/flora/components.ts` :

```ts
import { Types, createComponent } from '@iwsdk/core';

/** La flore d'une tuile de terrain (spec §8). */
export const FloraTile = createComponent(
  'FloraTile',
  {
    tx: { type: Types.Int16, default: 0 },
    tz: { type: Types.Int16, default: 0 },
    _needsPlant: { type: Types.Boolean, default: true },
  },
  'Instanced flora for one terrain tile',
);
```

- [ ] **Step 5: Écrire le système**

Créer `packages/world/src/flora/FloraSystem.ts` :

```ts
import { createSystem, Types, InstancedMesh, Matrix4, Object3D } from '@iwsdk/core';
import { scatterAt, heightAt, SCATTER_TILE, type FloraSpecies } from '@iwsdk/cardinal-simulation';
import { lodForRing } from '../terrain/tiling';
import { FloraTile } from './components';
import type { FloraAsset } from './floraAssets';

/**
 * Instancie la flore d'une tuile (spec §8).
 *
 * Une `InstancedMesh` par espèce et par tuile : le semis vient du MOTEUR, si
 * bien que la forêt vue et la forêt exploitable sont la même par construction.
 */
export class FloraSystem extends createSystem(
  { tiles: { required: [FloraTile] } },
  {
    assets: { type: Types.Object, default: null },
    material: { type: Types.Object, default: null },
  },
) {
  public plantedTiles = 0;
  public instanceCount = 0;
  /** Derniers niveaux choisis, pour que les tests puissent les constater. */
  public lastLevelNear = 0;
  public lastLevelFar = 0;

  /** Alloués une fois : la règle du dépôt traite toute allocation par image comme un défaut. */
  private readonly matrix = new Matrix4();
  private readonly dummy = new Object3D();

  public override update(_delta: number, _time: number): void {
    const assets = this.config.assets.value as FloraAsset[] | null;
    if (assets === null) return;

    const player = this.player as unknown as { position: { x: number; z: number } } | undefined;
    const centreX = Math.floor((player?.position.x ?? 0) / SCATTER_TILE);
    const centreZ = Math.floor((player?.position.z ?? 0) / SCATTER_TILE);

    for (const entity of this.queries.tiles.entities) {
      if (entity.getValue(FloraTile, '_needsPlant') !== true) continue;

      const tx = entity.getValue(FloraTile, 'tx')!;
      const tz = entity.getValue(FloraTile, 'tz')!;
      const items = scatterAt(tx, tz);

      // Un regroupement par espèce : une InstancedMesh ne porte qu'une géométrie.
      const bySpecies = new Map<FloraSpecies, typeof items>();
      for (const item of items) {
        const list = bySpecies.get(item.species);
        if (list === undefined) bySpecies.set(item.species, [item]);
        else (list as ReturnType<typeof scatterAt>[number][]).push(item);
      }

      // Le niveau de détail suit l'anneau, comme le terrain. Ce n'est pas une
      // optimisation différable : au niveau le plus fin, le budget de 500 000
      // triangles n'autoriserait que quelques dizaines d'arbres en tout.
      const ring = Math.max(Math.abs(tx - centreX), Math.abs(tz - centreZ));
      const level = Math.min(Math.max(0, lodForRing(ring)), 2);

      for (const [species, group] of bySpecies) {
        const asset = assets.find((a) => a.id === species);
        if (asset === undefined || asset.lods.length === 0) continue;
        const lod = asset.lods[Math.min(level, asset.lods.length - 1)]!;
        const mesh = new InstancedMesh(lod.geometry, this.config.material.value, group.length);
        mesh.name = `Flora ${species} ${tx},${tz}`;
        mesh.castShadow = false; // la flore reçoit l'ombre, elle n'en projette pas
        mesh.receiveShadow = true;

        for (let i = 0; i < group.length; i++) {
          const item = group[i]!;
          this.dummy.position.set(item.x, heightAt(item.x, item.z), item.z);
          this.dummy.rotation.set(0, item.rotationY, 0);
          this.dummy.scale.set(item.scale, item.scale, item.scale);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(i, this.dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.world.createTransformEntity(mesh, undefined);
        this.instanceCount += group.length;
      }

      if (ring <= 1) this.lastLevelNear = level;
      else this.lastLevelFar = level;

      entity.setValue(FloraTile, '_needsPlant', false);
      this.plantedTiles++;
    }
  }
}
```

- [ ] **Step 6: Compléter le mock avec `Object3D`**

Le système utilise un objet tampon pour composer les matrices. Ajouter à `packages/world/test/mocks/iwsdk-core.ts` :

```ts
export class Object3D {
  public position = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  public rotation = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  public scale = { x: 1, y: 1, z: 1, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  public matrix = new Matrix4();
  updateMatrix(): void {}
}
```

- [ ] **Step 7: Câbler l'installation**

Dans `packages/world/src/install.ts` : importer `FloraTile`, `FloraSystem`, `loadFloraAssets` ; ajouter `.registerComponent(FloraTile)` à la chaîne ; enregistrer le système après `TerrainMeshSystem` avec un matériau cloné de `foliage` :

```ts
  const floraMaterial = materials.get('foliage').clone();
  world.registerSystem(FloraSystem, {
    configData: { assets: null, material: floraMaterial },
  });
  // Les géométries arrivent du réseau : le système reste inerte jusque-là,
  // ce qui est correct — une tuile non plantée le sera au chargement suivant.
  void loadFloraAssets().then((assets) => {
    const system = world.getSystem(FloraSystem) as FloraSystem;
    system.config.assets.value = assets;
  });
```

Dans `TerrainMeshSystem`, après avoir construit une tuile, lui adjoindre sa flore :

```ts
      if (!entity.hasComponent(FloraTile)) {
        entity.addComponent(FloraTile, { tx, tz, _needsPlant: true });
      }
```

Réexporter depuis `packages/world/src/index.ts` : `FloraTile`, `FloraSystem`, `parseFloraManifest`, `loadFloraAssets`, `type FloraAsset`, `type FloraLod`.

- [ ] **Step 8: Supprimer l'ancienne végétation**

`apps/demo/src/simulation/ProceduralVegetation.ts` fabrique cyprès, chênes, fleurs, vignoble et rochers à la main, un `Group` par plant, sans instanciation. La flore instanciée le remplace pour les arbres.

Dans `apps/demo/src/simulation/PrehistoricEnvironment3D.ts`, retirer les appels `createCypressTree` et `createOakTree` ainsi que les boucles qui les posent, en **conservant** `createWildflowerPatch` et `createMossyBoulder` — fleurs et rochers ne relèvent pas de la phase 5. Déplacer ces deux méthodes dans le fichier appelant si `ProceduralVegetation` devient vide ; sinon le conserver amputé.

- [ ] **Step 9: Vérification complète**

Run:
```bash
pnpm --filter @iwsdk/cardinal-simulation build && pnpm --filter @iwsdk/cardinal-world build \
  && pnpm typecheck && pnpm test && pnpm build && pnpm --filter @iwsdk/plugin-phoenix-demo build
```
Expected: 0 erreur de type ; suite verte (le total passe d'environ 644 à environ 665) ; 18 paquets ; build démo OK.

- [ ] **Step 10: Vérification en session réelle**

```bash
cd apps/demo && npx iwsdk dev up
```

Attendre `browserCommandReady: true`, mettre la simulation en pause, forcer midi, puis relever et **rapporter honnêtement** :

1. **La console d'abord** (`npx iwsdk browser logs`, `count` seul, jamais `level`) : un échec de `fetch` sur `/flora/manifest.json` s'y voit, et la flore serait alors simplement absente.
2. `npx iwsdk ecs find --input-json '{"withComponents":["FloraTile"],"limit":60}'` : autant de tuiles de flore que de tuiles de terrain.
3. `npx iwsdk scene render-stats` : les triangles montent, **et rester sous 500 000**. C'est le chiffre à surveiller.
4. La capture montre des arbres répartis, plus denses en forêt qu'en prairie, et **aucun dans le village**.
5. Le joueur ne tombe pas — `positionRelativeToXROrigin` d'une tuile proche.

Arrêter : `npx iwsdk dev down`

- [ ] **Step 11: Commit**

```bash
git add -A packages apps
git commit -m "feat(world): instanced flora seeded by the engine, one mesh per species and tile"
```

---

## Ce que la phase 5 ne fait PAS

- **Pas de smart objects semés.** `scatterAt` est la vérité partagée, mais le moteur n'y instancie pas encore d'objets exploitables : la zone simulée fait 64 m et les agents n'atteindraient pas la forêt. Cela vient avec l'écologie, qui élargit le domaine.
- **Pas de fondu entre niveaux.** Le passage d'un niveau au suivant est net au franchissement d'un anneau. Un fondu par transparence coûterait un tri par profondeur que le budget ne porte pas.
- **Pas d'herbe ni de sous-bois.** `ProceduralGrassField` reste en place ; sa densité par biome relève d'un travail distinct.
- **Pas de vent.** Les arbres ne bougent pas.
- **Pas de collision.** On traverse les arbres, comme aujourd'hui.
