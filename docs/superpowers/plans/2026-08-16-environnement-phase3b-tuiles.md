# Phase 3B — Tuiles, streaming et niveaux de détail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le maillage unique de 64 m par un ensemble de tuiles streamées autour du joueur, à trois niveaux de détail, couvrant plusieurs centaines de mètres sans dépasser le budget d'une image VR.

**Architecture:** Tout le raisonnement vit dans des fonctions pures de `packages/world/src/terrain/` : `tiling.ts` décide quelles tuiles doivent exister et à quelle résolution, `sampling.ts` échantillonne le champ de la phase 3A **en grille** (la pente se dérive des voisins au lieu de quatre requêtes ponctuelles, ce qui divise le coût par sept). Deux systèmes ECS minces s'appuient dessus : l'un maintient l'ensemble voulu, l'autre construit **au plus une tuile par image**. Les fissures entre niveaux sont masquées par des jupes verticales.

**Tech Stack:** TypeScript strict, vitest, `@iwsdk/core` (Three), `@iwsdk/cardinal-simulation` pour la vérité terrain.

**Spec:** `docs/superpowers/specs/2026-08-16-environnement-procedural-ecs-design.md` (§6, streaming en ECS)

## Global Constraints

- **Budget VR : 11–14 ms par image au total** (72–90 fps). Une tuile 33×33 échantillonnée en grille coûte **0,61 ms** (mesuré) ; une par image est donc soutenable, deux ne le sont pas.
- **Ne jamais allouer dans `update()`** (règle du dépôt, `apps/demo/CLAUDE.md`). Les tampons de travail sont alloués dans `init()` comme propriétés de classe.
- **Importer Three depuis `@iwsdk/core`, jamais depuis `three`** — un import direct crée une seconde instance de Three et casse tout silencieusement.
- `packages/world` gagne une dépendance vers `@iwsdk/cardinal-simulation` (le rendu dépend de la vérité, jamais l'inverse). `packages/simulation` conserve **zéro dépendance**.
- **`entity.dispose()`, jamais `entity.destroy()`** — `destroy` fuit la mémoire GPU.
- Les champs Vec2/Vec3/Vec4/Color se lisent par `entity.getVectorView(...)`, jamais par `setValue` (jette en elics 3.4.x).
- TypeScript strict avec `noUncheckedIndexedAccess` : tout accès indexé exige `!` ou une garde.
- Le terrain reste la **même** vérité que le moteur : toute hauteur vient de `heightAt`, jamais d'une réimplémentation.

---

## File Structure

| Fichier | Responsabilité |
| :--- | :--- |
| `packages/world/src/terrain/tiling.ts` **(créé)** | Pur, sans Three : coordonnées de tuile, anneaux, niveau de détail par anneau, ensemble voulu pour une position, **diff** entre l'existant et le voulu. |
| `packages/world/src/terrain/sampling.ts` **(créé)** | Pur, sans Three : échantillonne une tuile en grille — hauteurs, pentes dérivées des voisins, couleurs de biome. |
| `packages/world/src/terrain/geometry.ts` **(créé)** | Construit une `BufferGeometry` depuis un échantillon, jupes comprises. Seul fichier du module qui touche Three. |
| `packages/world/src/terrain/components.ts` **(créé)** | Composant `TerrainTile`. |
| `packages/world/src/terrain/TerrainStreamingSystem.ts` **(créé)** | Maintient l'ensemble de tuiles voulu selon la position du joueur. |
| `packages/world/src/terrain/TerrainMeshSystem.ts` **(créé)** | Construit au plus une tuile par image, libère les géométries retirées. |
| `packages/world/src/install.ts` **(modifié)** | Enregistre les deux systèmes et le composant. |
| `packages/world/package.json` **(modifié)** | Dépendance vers `@iwsdk/cardinal-simulation`. |

**Pourquoi cette séparation.** `tiling.ts` et `sampling.ts` contiennent toute la logique et se testent sans navigateur ni GPU ; `geometry.ts` et les deux systèmes sont assez minces pour être lus d'un coup d'œil. C'est la discipline qui a permis à `packages/world` d'atteindre 57 tests sur un domaine réputé non testable.

---

### Task 1: Pavage, anneaux et niveaux de détail

**Files:**
- Create: `packages/world/src/terrain/tiling.ts`
- Test: `packages/world/test/tiling.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `TILE_SIZE: number` (`32`)
  - `LOD_SEGMENTS: readonly number[]` (`[32, 16, 8]`)
  - `MAX_RING: number` (`3`)
  - `interface TileSpec { tx: number; tz: number; lod: number }`
  - `tileIndexFor(worldCoord: number): number`
  - `tileOriginX(tx: number): number` / `tileOriginZ(tz: number): number`
  - `tileKey(tx: number, tz: number): string`
  - `lodForRing(ring: number): number` — `-1` hors portée
  - `desiredTiles(playerX: number, playerZ: number): TileSpec[]`
  - `interface TileDiff { toBuild: TileSpec[]; toRemove: string[] }`
  - `diffTiles(current: ReadonlyMap<string, TileSpec>, desired: readonly TileSpec[]): TileDiff`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/tiling.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE,
  LOD_SEGMENTS,
  MAX_RING,
  tileIndexFor,
  tileOriginX,
  tileOriginZ,
  tileKey,
  lodForRing,
  desiredTiles,
  diffTiles,
  type TileSpec,
} from '../src/terrain/tiling';

describe('coordonnées de tuile', () => {
  it('range chaque point dans la tuile qui le contient', () => {
    expect(tileIndexFor(0)).toBe(0);
    expect(tileIndexFor(TILE_SIZE - 0.001)).toBe(0);
    expect(tileIndexFor(TILE_SIZE)).toBe(1);
    expect(tileIndexFor(-0.001)).toBe(-1);
    expect(tileIndexFor(-TILE_SIZE)).toBe(-1);
    expect(tileIndexFor(-TILE_SIZE - 0.001)).toBe(-2);
  });

  it('rend une origine cohérente avec l\'index', () => {
    for (const t of [-3, -1, 0, 2, 7]) {
      expect(tileIndexFor(tileOriginX(t))).toBe(t);
      expect(tileIndexFor(tileOriginZ(t) + TILE_SIZE / 2)).toBe(t);
    }
  });

  it('donne une clé unique par tuile', () => {
    const keys = new Set<string>();
    for (let tx = -4; tx <= 4; tx++) for (let tz = -4; tz <= 4; tz++) keys.add(tileKey(tx, tz));
    expect(keys.size).toBe(81);
  });
});

describe('niveaux de détail', () => {
  it('dégrade la résolution avec la distance, sans saut', () => {
    expect(lodForRing(0)).toBe(0);
    expect(lodForRing(1)).toBe(0);
    expect(lodForRing(MAX_RING)).toBe(LOD_SEGMENTS.length - 1);
    expect(lodForRing(MAX_RING + 1)).toBe(-1);
    let previous = 0;
    for (let ring = 0; ring <= MAX_RING; ring++) {
      const lod = lodForRing(ring);
      expect(lod).toBeGreaterThanOrEqual(previous);
      expect(lod - previous).toBeLessThanOrEqual(1); // jamais deux crans d'un coup
      previous = lod;
    }
  });

  it('déclare une résolution décroissante et paire', () => {
    for (let i = 1; i < LOD_SEGMENTS.length; i++) {
      expect(LOD_SEGMENTS[i]!).toBeLessThan(LOD_SEGMENTS[i - 1]!);
      // Chaque niveau divise le précédent : les bords s'alignent sur un sommet
      // sur deux, ce qui rend les fissures régulières et donc masquables.
      expect(LOD_SEGMENTS[i - 1]! % LOD_SEGMENTS[i]!).toBe(0);
    }
  });
});

describe('desiredTiles', () => {
  it('couvre un carré complet autour du joueur', () => {
    const tiles = desiredTiles(0, 0);
    const side = 2 * MAX_RING + 1;
    expect(tiles.length).toBe(side * side);
  });

  it('centre la pleine résolution sur le joueur', () => {
    const tiles = desiredTiles(0, 0);
    const centre = tiles.find((t) => t.tx === 0 && t.tz === 0);
    expect(centre?.lod).toBe(0);
  });

  it('suit le joueur', () => {
    const far = desiredTiles(1000, -1000);
    const centre = far.find((t) => t.lod === 0 && t.tx === tileIndexFor(1000));
    expect(centre).toBeDefined();
    expect(centre!.tz).toBe(tileIndexFor(-1000));
  });

  it('EST STABLE tant que le joueur reste dans sa tuile', () => {
    // Sinon chaque pas du joueur reconstruirait le monde entier.
    const a = desiredTiles(1, 1);
    const b = desiredTiles(TILE_SIZE - 1, TILE_SIZE - 1);
    expect(a.map((t) => tileKey(t.tx, t.tz)).sort()).toEqual(
      b.map((t) => tileKey(t.tx, t.tz)).sort(),
    );
  });

  it('ne demande jamais deux fois la même tuile', () => {
    const tiles = desiredTiles(53, -87);
    const keys = tiles.map((t) => tileKey(t.tx, t.tz));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('diffTiles', () => {
  const spec = (tx: number, tz: number, lod: number): TileSpec => ({ tx, tz, lod });

  it('demande tout quand rien n\'existe', () => {
    const desired = [spec(0, 0, 0), spec(1, 0, 1)];
    const diff = diffTiles(new Map(), desired);
    expect(diff.toBuild).toHaveLength(2);
    expect(diff.toRemove).toHaveLength(0);
  });

  it('ne redemande pas une tuile déjà au bon niveau', () => {
    const current = new Map([[tileKey(0, 0), spec(0, 0, 0)]]);
    const diff = diffTiles(current, [spec(0, 0, 0)]);
    expect(diff.toBuild).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
  });

  it('RECONSTRUIT une tuile dont le niveau de détail a changé', () => {
    // Le joueur s'approche : une tuile lointaine doit gagner en résolution.
    const current = new Map([[tileKey(2, 0), spec(2, 0, 2)]]);
    const diff = diffTiles(current, [spec(2, 0, 0)]);
    expect(diff.toBuild).toEqual([spec(2, 0, 0)]);
    expect(diff.toRemove).toEqual([tileKey(2, 0)]);
  });

  it('retire ce qui n\'est plus voulu', () => {
    const current = new Map([
      [tileKey(0, 0), spec(0, 0, 0)],
      [tileKey(9, 9), spec(9, 9, 2)],
    ]);
    const diff = diffTiles(current, [spec(0, 0, 0)]);
    expect(diff.toRemove).toEqual([tileKey(9, 9)]);
    expect(diff.toBuild).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test tiling`
Expected: FAIL — `Failed to resolve import "../src/terrain/tiling"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `packages/world/src/terrain/tiling.ts` :

```ts
/**
 * Pavage du terrain (spec §6). Pur : aucune dépendance à Three ni à l'ECS,
 * donc entièrement testable. C'est ici que vit TOUT le raisonnement du
 * streaming ; les systèmes ECS ne font qu'appliquer ces décisions.
 */

/** Côté d'une tuile, en mètres. */
export const TILE_SIZE = 32;

/**
 * Nombre de quads par côté, par niveau de détail.
 * Chaque niveau divise le précédent : les bords s'alignent alors sur un sommet
 * sur deux, ce qui rend les fissures régulières — et donc masquables par une
 * jupe de hauteur bornée.
 */
export const LOD_SEGMENTS: readonly number[] = [32, 16, 8];

/** Anneau le plus lointain encore streamé (distance de Chebyshev, en tuiles). */
export const MAX_RING = 3;

export interface TileSpec {
  readonly tx: number;
  readonly tz: number;
  readonly lod: number;
}

export interface TileDiff {
  readonly toBuild: TileSpec[];
  readonly toRemove: string[];
}

export function tileIndexFor(worldCoord: number): number {
  return Math.floor(worldCoord / TILE_SIZE);
}

export function tileOriginX(tx: number): number {
  return tx * TILE_SIZE;
}

export function tileOriginZ(tz: number): number {
  return tz * TILE_SIZE;
}

export function tileKey(tx: number, tz: number): string {
  return `${tx},${tz}`;
}

/** Les deux premiers anneaux restent en pleine résolution : c'est là qu'on marche. */
export function lodForRing(ring: number): number {
  if (ring < 0 || ring > MAX_RING) return -1;
  if (ring <= 1) return 0;
  return Math.min(ring - 1, LOD_SEGMENTS.length - 1);
}

export function desiredTiles(playerX: number, playerZ: number): TileSpec[] {
  const cx = tileIndexFor(playerX);
  const cz = tileIndexFor(playerZ);
  const tiles: TileSpec[] = [];
  for (let dz = -MAX_RING; dz <= MAX_RING; dz++) {
    for (let dx = -MAX_RING; dx <= MAX_RING; dx++) {
      // Chebyshev : des anneaux carrés, alignés sur la grille de tuiles.
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      const lod = lodForRing(ring);
      if (lod < 0) continue;
      tiles.push({ tx: cx + dx, tz: cz + dz, lod });
    }
  }
  return tiles;
}

/**
 * Différence entre ce qui existe et ce qu'il faut.
 *
 * Une tuile dont le niveau de détail change est retirée PUIS reconstruite :
 * la géométrie n'est pas redimensionnable en place, et tenter de la muter
 * laisserait des attributs de l'ancienne résolution.
 */
export function diffTiles(
  current: ReadonlyMap<string, TileSpec>,
  desired: readonly TileSpec[],
): TileDiff {
  const toBuild: TileSpec[] = [];
  const wanted = new Set<string>();

  for (const spec of desired) {
    const key = tileKey(spec.tx, spec.tz);
    wanted.add(key);
    const existing = current.get(key);
    if (existing === undefined || existing.lod !== spec.lod) toBuild.push(spec);
  }

  const toRemove: string[] = [];
  for (const [key, spec] of current) {
    const stillWanted = wanted.has(key);
    if (!stillWanted) {
      toRemove.push(key);
      continue;
    }
    // Même tuile, autre résolution : elle part aussi, pour renaître au bon niveau.
    const replacement = desired.find((d) => tileKey(d.tx, d.tz) === key);
    if (replacement !== undefined && replacement.lod !== spec.lod) toRemove.push(key);
  }

  return { toBuild, toRemove };
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test tiling`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/world/src/terrain/tiling.ts packages/world/test/tiling.test.ts
git commit -m "feat(world): pure terrain tiling, LOD rings and streaming diff"
```

---

### Task 2: Échantillonnage d'une tuile en grille

**Files:**
- Modify: `packages/simulation/src/world/biomes.ts` (extraire le cœur pur `classifyBiome`)
- Modify: `packages/simulation/src/index.ts` (exporter `classifyBiome`)
- Modify: `packages/world/package.json` (dépendance vers le moteur)
- Create: `packages/world/src/terrain/sampling.ts`
- Test: `packages/world/test/sampling.test.ts`

**Interfaces:**
- Consumes: `heightAt`, `landMaskAt`, `riverCenterX` de `@iwsdk/cardinal-simulation`.
- Produces:
  - `classifyBiome(h: number, slope: number, land: number, wet: number, distToRiver: number): BiomeSample` — **exporté par le moteur**
  - `interface TileSample { size: number; segments: number; height: Float32Array; slope: Float32Array; color: Float32Array }`
  - `sampleTile(originX: number, originZ: number, size: number, segments: number): TileSample`
  - `BIOME_RGB: Readonly<Record<BiomeId, readonly [number, number, number]>>`

**Pourquoi extraire `classifyBiome`.** `biomeAt(x, z)` recalcule la hauteur, puis la pente — laquelle appelle `heightAt` quatre fois de plus. Une tuile possède déjà toute sa grille de hauteurs : la pente s'y dérive des voisins pour presque rien. Mesuré sur une tuile 33×33 : **7,87 ms par requêtes ponctuelles contre 0,61 ms en grille**, soit sept fois moins. Sans cette extraction, une seule tuile mangerait la moitié du budget d'image.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/sampling.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { sampleTile, BIOME_RGB } from '../src/terrain/sampling';
import { heightAt, BIOME_IDS } from '@iwsdk/cardinal-simulation';

describe('sampleTile', () => {
  it('remplit des tableaux à la bonne taille', () => {
    const s = sampleTile(0, 0, 32, 8);
    const verts = 9 * 9;
    expect(s.segments).toBe(8);
    expect(s.size).toBe(32);
    expect(s.height).toHaveLength(verts);
    expect(s.slope).toHaveLength(verts);
    expect(s.color).toHaveLength(verts * 3);
  });

  it('EST EXACTEMENT le champ du moteur, jamais une réimplémentation', () => {
    // Si le rendu divergeait du moteur, les agents marcheraient sur un relief
    // que le joueur ne voit pas. C'est l'invariant central du projet.
    const segments = 8;
    const s = sampleTile(64, -32, 32, segments);
    const step = 32 / segments;
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++) {
        const expected = heightAt(64 + i * step, -32 + j * step);
        expect(s.height[j * (segments + 1) + i]).toBeCloseTo(expected, 10);
      }
    }
  });

  it('dérive une pente positive et bornée', () => {
    const s = sampleTile(300, 300, 32, 16);
    for (const v of s.slope) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(Math.PI / 2);
    }
  });

  it('accorde la pente dérivée avec le relief réel', () => {
    // Une tuile plate a une pente nulle ; une tuile accidentée non.
    const flat = sampleTile(-16, -16, 32, 8); // contient le plateau du village
    const rough = sampleTile(320, 320, 32, 8);
    const mean = (a: Float32Array) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(flat)).toBeLessThan(mean(rough));
  });

  it('produit des couleurs dans [0, 1]', () => {
    const s = sampleTile(0, 0, 32, 8);
    for (const c of s.color) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('est déterministe', () => {
    const a = sampleTile(96, -64, 32, 8);
    const b = sampleTile(96, -64, 32, 8);
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
    expect(Array.from(a.color)).toEqual(Array.from(b.color));
  });

  it('RACCORDE les tuiles voisines : le bord partagé est identique', () => {
    // Sans cela, deux tuiles adjacentes de même niveau montreraient une fente.
    const segments = 8;
    const left = sampleTile(0, 0, 32, segments);
    const right = sampleTile(32, 0, 32, segments);
    const n = segments + 1;
    for (let j = 0; j <= segments; j++) {
      expect(left.height[j * n + segments]).toBeCloseTo(right.height[j * n]!, 10);
    }
  });

  it('déclare une couleur pour chaque biome', () => {
    for (const id of BIOME_IDS) {
      const rgb = BIOME_RGB[id];
      expect(rgb, id).toBeDefined();
      expect(rgb).toHaveLength(3);
    }
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test sampling`
Expected: FAIL — le module n'existe pas, et `@iwsdk/cardinal-simulation` n'est pas encore une dépendance.

- [ ] **Step 3: Extraire le cœur pur de la classification**

Dans `packages/simulation/src/world/biomes.ts`, remplacer le corps de `biomeAt` par une délégation, et déplacer tout le calcul de scores dans une fonction qui ne reçoit que des nombres :

```ts
/**
 * Cœur pur de la classification : ne reçoit que des mesures déjà faites.
 *
 * `biomeAt` reste l'API commode pour une requête isolée. Mais échantillonner
 * une tuile par `biomeAt` recalculerait la hauteur puis la pente — qui appelle
 * `heightAt` quatre fois de plus — alors que la grille les possède déjà.
 */
export function classifyBiome(
  h: number,
  s: number,
  land: number,
  wet: number,
  distToRiver: number,
): BiomeSample {
  const coastGate = smoothstep(0.15, 0.45, 1 - land);
  const riverGate = smoothstep(RIVER_CARVE_RADIUS + 8, RIVER_CARVE_RADIUS, distToRiver);
  const inRiverValley = distToRiver < RIVER_CARVE_RADIUS;
  const ocean = h < SEA_LEVEL && !inRiverValley ? 1 + (SEA_LEVEL - h) : 0;
  const aboveShore = 1 - coastGate * smoothstep(3.0, 0.5, h);

  const BEACH_WEIGHT = 2.2;
  const WETLAND_WEIGHT = 1.4;

  const scores: Record<BiomeId, number> = {
    ocean,
    beach:
      ocean > 0
        ? 0
        : smoothstep(2.5, 0.1, h) * smoothstep(0.4, 0.08, s) * coastGate * BEACH_WEIGHT,
    wetland:
      ocean > 0
        ? 0
        : smoothstep(18, 2, h) *
          smoothstep(0.25, 0.05, s) *
          smoothstep(0.5, 0.75, wet) *
          (1 - coastGate) *
          riverGate *
          WETLAND_WEIGHT,
    grassland:
      ocean > 0
        ? 0
        : smoothstep(0.55, 0.15, s) *
          smoothstep(0.75, 0.3, wet) *
          smoothstep(ALPINE_HEIGHT, 8, h) *
          aboveShore,
    forest:
      ocean > 0
        ? 0
        : smoothstep(0.6, 0.2, s) *
          smoothstep(0.35, 0.8, wet) *
          smoothstep(ALPINE_HEIGHT, 6, h) *
          aboveShore,
    rock: ocean > 0 ? 0 : smoothstep(ROCK_SLOPE, ROCK_SLOPE + 0.35, s),
    alpine: ocean > 0 ? 0 : smoothstep(ALPINE_HEIGHT, ALPINE_HEIGHT + 30, h),
  };

  let total = 0;
  for (const id of BIOME_IDS) total += scores[id];

  if (total <= 0) {
    return {
      primary: 'grassland',
      weights: { ocean: 0, beach: 0, wetland: 0, grassland: 1, forest: 0, rock: 0, alpine: 0 },
    };
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

export function biomeAt(x: number, z: number): BiomeSample {
  return classifyBiome(
    heightAt(x, z),
    slopeAt(x, z),
    landMaskAt(x, z),
    humidityAt(x, z),
    distanceToRiver(x, z),
  );
}
```

Puis exporter depuis `packages/simulation/src/index.ts`, en ajoutant `classifyBiome` à la ligne d'export des biomes.

- [ ] **Step 4: Vérifier que le moteur est intact**

Run: `pnpm --filter @iwsdk/cardinal-simulation test && pnpm --filter @iwsdk/cardinal-simulation build`
Expected: 218 tests verts, build OK. **Aucun test ne doit changer de résultat** : l'extraction ne déplace que du code, elle ne modifie aucun seuil.

- [ ] **Step 5: Déclarer la dépendance du rendu vers le moteur**

Dans `packages/world/package.json`, ajouter au bloc `dependencies` (le créer s'il est absent) :

```json
"dependencies": {
  "@iwsdk/cardinal-simulation": "workspace:*"
}
```

Le sens est celui-ci et jamais l'inverse : le rendu dépend de la vérité. `packages/simulation` garde zéro dépendance, donc aucun cycle n'est possible.

Puis : `pnpm install`

- [ ] **Step 6: Écrire l'échantillonneur**

Créer `packages/world/src/terrain/sampling.ts` :

```ts
import {
  heightAt,
  landMaskAt,
  humidityAt,
  riverCenterX,
  classifyBiome,
  BIOME_IDS,
  type BiomeId,
} from '@iwsdk/cardinal-simulation';

/**
 * Échantillonnage d'une tuile EN GRILLE (spec §6).
 *
 * L'astuce tient en une phrase : la pente se dérive des voisins déjà calculés
 * au lieu d'être redemandée point par point. Mesuré sur une tuile 33×33,
 * 7,87 ms deviennent 0,61 ms — la différence entre un streaming impossible et
 * un streaming à une tuile par image.
 */
export interface TileSample {
  readonly size: number;
  readonly segments: number;
  readonly height: Float32Array;
  readonly slope: Float32Array;
  readonly color: Float32Array;
}

/** Teinte par biome. Le sol qu'on voit suit la classification du moteur. */
export const BIOME_RGB: Readonly<Record<BiomeId, readonly [number, number, number]>> = {
  ocean: [0.118, 0.227, 0.373],
  beach: [0.831, 0.639, 0.451],
  wetland: [0.302, 0.486, 0.059],
  grassland: [0.396, 0.639, 0.051],
  forest: [0.212, 0.325, 0.078],
  rock: [0.392, 0.455, 0.545],
  alpine: [0.886, 0.906, 0.925],
};

export function sampleTile(
  originX: number,
  originZ: number,
  size: number,
  segments: number,
): TileSample {
  const n = segments + 1;
  const step = size / segments;
  const height = new Float32Array(n * n);
  const slope = new Float32Array(n * n);
  const color = new Float32Array(n * n * 3);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      height[j * n + i] = heightAt(originX + i * step, originZ + j * step);
    }
  }

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // Différences centrées, repliées aux bords : la tuile ne connaît pas ses
      // voisines, mais un bord légèrement approché est invisible et gratuit.
      const i0 = i > 0 ? i - 1 : i;
      const i1 = i < n - 1 ? i + 1 : i;
      const j0 = j > 0 ? j - 1 : j;
      const j1 = j < n - 1 ? j + 1 : j;
      const dx = (height[j * n + i1]! - height[j * n + i0]!) / ((i1 - i0) * step);
      const dz = (height[j1 * n + i]! - height[j0 * n + i]!) / ((j1 - j0) * step);
      const s = Math.atan(Math.hypot(dx, dz));
      slope[j * n + i] = s;

      const x = originX + i * step;
      const z = originZ + j * step;
      const sample = classifyBiome(
        height[j * n + i]!,
        s,
        landMaskAt(x, z),
        humidityAt(x, z),
        Math.abs(x - riverCenterX(z)),
      );
      let r = 0;
      let g = 0;
      let b = 0;
      for (const id of BIOME_IDS) {
        const w = sample.weights[id];
        if (w <= 0) continue;
        const rgb = BIOME_RGB[id];
        r += rgb[0] * w;
        g += rgb[1] * w;
        b += rgb[2] * w;
      }
      color[(j * n + i) * 3] = r;
      color[(j * n + i) * 3 + 1] = g;
      color[(j * n + i) * 3 + 2] = b;
    }
  }

  return { size, segments, height, slope, color };
}
```

- [ ] **Step 7: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test sampling`
Expected: PASS, 8 tests.

Si « RACCORDE les tuiles voisines » échoue, ne pas relâcher la tolérance : c'est que l'origine ou le pas de la grille est décalé d'un demi-quad, et la fente serait visible en jeu.

- [ ] **Step 8: Commit**

```bash
git add packages/simulation/src/world/biomes.ts packages/simulation/src/index.ts \
        packages/world/package.json packages/world/src/terrain/sampling.ts \
        packages/world/test/sampling.test.ts pnpm-lock.yaml
git commit -m "feat(world): grid tile sampling, seven times cheaper than point queries"
```

---

### Task 3: Géométrie de tuile et jupes

**Files:**
- Create: `packages/world/src/terrain/geometry.ts`
- Test: `packages/world/test/tile-geometry.test.ts`
- Modify: `packages/world/test/mocks/iwsdk-core.ts` (ajouter les classes Three nécessaires)

**Interfaces:**
- Consumes: `TileSample` de la tâche 2.
- Produces:
  - `SKIRT_DEPTH: number` (`2.5`)
  - `buildTileGeometry(sample: TileSample, skirtDepth?: number): BufferGeometry`
  - `tileVertexCount(segments: number): number`
  - `tileTriangleCount(segments: number): number`

**Pourquoi des jupes.** Deux tuiles voisines de résolutions différentes ne partagent pas leurs sommets de bord : la tuile grossière coupe les droits là où la fine suit le relief, ce qui ouvre une **fissure** par laquelle on voit le ciel. Une jupe est un simple muret vertical suspendu au bord de chaque tuile ; il bouche la fente sans exiger la moindre coordination entre voisines. C'est la technique que la spec §6 retient pour sa robustesse.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/tile-geometry.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildTileGeometry, tileVertexCount, tileTriangleCount, SKIRT_DEPTH } from '../src/terrain/geometry';
import { sampleTile } from '../src/terrain/sampling';

describe('comptes', () => {
  it('compte la grille plus les quatre jupes', () => {
    const segments = 4;
    const n = segments + 1;
    expect(tileVertexCount(segments)).toBe(n * n + 4 * n);
    expect(tileTriangleCount(segments)).toBe(2 * segments * segments + 4 * 2 * segments);
  });
});

describe('buildTileGeometry', () => {
  const sample = sampleTile(0, 0, 32, 4);
  const geom = buildTileGeometry(sample);

  it('remplit position, normal, couleur et index', () => {
    const verts = tileVertexCount(4);
    expect(geom.getAttribute('position').count).toBe(verts);
    expect(geom.getAttribute('color').count).toBe(verts);
    expect(geom.getIndex()!.count).toBe(tileTriangleCount(4) * 3);
  });

  it('place la grille aux hauteurs échantillonnées, en repère local à la tuile', () => {
    const pos = geom.getAttribute('position');
    const n = 5;
    const step = 32 / 4;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = j * n + i;
        expect(pos.getX(v)).toBeCloseTo(i * step, 6);
        expect(pos.getZ(v)).toBeCloseTo(j * step, 6);
        expect(pos.getY(v)).toBeCloseTo(sample.height[v]!, 6);
      }
    }
  });

  it('SUSPEND la jupe sous le bord, jamais au-dessus', () => {
    // Une jupe qui remonterait percerait la surface et se verrait.
    const pos = geom.getAttribute('position');
    const n = 5;
    for (let v = n * n; v < tileVertexCount(4); v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      // Chaque sommet de jupe partage x/z avec un sommet de bord.
      let matched = false;
      for (let g = 0; g < n * n && !matched; g++) {
        if (Math.abs(pos.getX(g) - x) < 1e-6 && Math.abs(pos.getZ(g) - z) < 1e-6) {
          expect(pos.getY(v)).toBeCloseTo(pos.getY(g) - SKIRT_DEPTH, 6);
          matched = true;
        }
      }
      expect(matched, `sommet de jupe ${v} sans bord correspondant`).toBe(true);
    }
  });

  it("n'indexe aucun sommet inexistant", () => {
    const idx = geom.getIndex()!;
    const verts = tileVertexCount(4);
    for (let i = 0; i < idx.count; i++) {
      expect(idx.getX(i)).toBeGreaterThanOrEqual(0);
      expect(idx.getX(i)).toBeLessThan(verts);
    }
  });

  it('ORIENTE les jupes vers l\'extérieur de la tuile', () => {
    // Une jupe mal orientée est supprimée par le rejet des faces arrière :
    // elle existe dans les données et ne bouche rien à l'écran.
    const pos = geom.getAttribute('position');
    const idx = geom.getIndex()!;
    const n = 5;
    const centre = 32 / 2;
    const gridTris = 2 * 4 * 4;
    let checked = 0;
    for (let t = gridTris; t < tileTriangleCount(4); t++) {
      const a = idx.getX(t * 3);
      const b = idx.getX(t * 3 + 1);
      const c = idx.getX(t * 3 + 2);
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
      const ux = pos.getX(b) - ax, uy = pos.getY(b) - ay, uz = pos.getZ(b) - az;
      const vx = pos.getX(c) - ax, vy = pos.getY(c) - ay, vz = pos.getZ(c) - az;
      // Normale par produit vectoriel, composante horizontale seulement.
      const nx = uy * vz - uz * vy;
      const nz = ux * vy - uy * vx;
      const cx = (ax + pos.getX(b) + pos.getX(c)) / 3 - centre;
      const cz = (az + pos.getZ(b) + pos.getZ(c)) / 3 - centre;
      if (Math.hypot(nx, nz) < 1e-9) continue;
      expect(nx * cx + nz * cz, `triangle de jupe ${t} orienté vers l'intérieur`).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Compléter le mock de `@iwsdk/core`**

`packages/world/test/mocks/iwsdk-core.ts` ne fournit aujourd'hui que `DataTexture` et `MeshStandardMaterial`. Ajouter en fin de fichier de quoi construire une géométrie — une implémentation minimale mais **fidèle** des accesseurs utilisés :

```ts
export class BufferAttribute {
  constructor(
    public array: Float32Array | Uint32Array,
    public itemSize: number,
  ) {}
  get count(): number {
    return this.array.length / this.itemSize;
  }
  getX(i: number): number {
    return this.array[i * this.itemSize] as number;
  }
  getY(i: number): number {
    return this.array[i * this.itemSize + 1] as number;
  }
  getZ(i: number): number {
    return this.array[i * this.itemSize + 2] as number;
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array: Float32Array | number[], itemSize: number) {
    super(array instanceof Float32Array ? array : new Float32Array(array), itemSize);
  }
}

export class Uint32BufferAttribute extends BufferAttribute {
  constructor(array: Uint32Array | number[], itemSize: number) {
    super(array instanceof Uint32Array ? array : new Uint32Array(array), itemSize);
  }
}

export class BufferGeometry {
  private attributes = new Map<string, BufferAttribute>();
  private index: BufferAttribute | null = null;
  public disposed = false;
  public boundingSphere: unknown = null;
  setAttribute(name: string, attribute: BufferAttribute): this {
    this.attributes.set(name, attribute);
    return this;
  }
  getAttribute(name: string): BufferAttribute {
    const a = this.attributes.get(name);
    if (a === undefined) throw new Error(`missing attribute ${name}`);
    return a;
  }
  setIndex(attribute: BufferAttribute): this {
    this.index = attribute;
    return this;
  }
  getIndex(): BufferAttribute | null {
    return this.index;
  }
  computeVertexNormals(): void {
    // Le mock ne calcule rien : les tests d'orientation lisent les positions
    // et l'index, pas les normales produites par Three.
    const position = this.getAttribute('position');
    if (!this.attributes.has('normal')) {
      this.setAttribute('normal', new Float32BufferAttribute(new Float32Array(position.count * 3), 3));
    }
  }
  computeBoundingSphere(): void {
    this.boundingSphere = { radius: 1 };
  }
  dispose(): void {
    this.disposed = true;
  }
}

export class Mesh {
  public name = '';
  public castShadow = false;
  public receiveShadow = false;
  public position = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  constructor(
    public geometry: BufferGeometry,
    public material: unknown,
  ) {}
}
```

- [ ] **Step 3: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test tile-geometry`
Expected: FAIL — `Failed to resolve import "../src/terrain/geometry"`.

- [ ] **Step 4: Écrire la construction de géométrie**

Créer `packages/world/src/terrain/geometry.ts` :

```ts
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from '@iwsdk/core';
import type { TileSample } from './sampling';

/**
 * Profondeur de la jupe, en mètres.
 *
 * Doit dépasser la plus grande fente possible entre deux niveaux voisins :
 * une tuile grossière coupe au droit là où sa voisine fine suit le relief.
 * 2,5 m couvre confortablement l'écart observé sur ce terrain.
 */
export const SKIRT_DEPTH = 2.5;

export function tileVertexCount(segments: number): number {
  const n = segments + 1;
  return n * n + 4 * n;
}

export function tileTriangleCount(segments: number): number {
  return 2 * segments * segments + 4 * 2 * segments;
}

export function buildTileGeometry(sample: TileSample, skirtDepth = SKIRT_DEPTH): BufferGeometry {
  const { segments, size, height, color } = sample;
  const n = segments + 1;
  const step = size / segments;
  const vertexCount = tileVertexCount(segments);

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(tileTriangleCount(segments) * 3);

  // --- Grille. Repère LOCAL à la tuile : l'entité porte la translation. ---
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      positions[v * 3] = i * step;
      positions[v * 3 + 1] = height[v]!;
      positions[v * 3 + 2] = j * step;
      colors[v * 3] = color[v * 3]!;
      colors[v * 3 + 1] = color[v * 3 + 1]!;
      colors[v * 3 + 2] = color[v * 3 + 2]!;
    }
  }

  let t = 0;
  const tri = (a: number, b: number, c: number): void => {
    indices[t++] = a;
    indices[t++] = b;
    indices[t++] = c;
  };

  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      tri(a, c, b);
      tri(b, c, d);
    }
  }

  // --- Jupes. Un bord = n sommets recopiés, descendus de skirtDepth. ---
  // L'ordre des sommets de chaque bord est choisi pour que l'enroulement
  // produise une normale dirigée VERS L'EXTÉRIEUR : une jupe orientée vers
  // l'intérieur serait supprimée par le rejet des faces arrière et ne
  // boucherait donc rien, tout en existant dans les données.
  const edges: { grid: (k: number) => number; outward: 'minZ' | 'maxZ' | 'minX' | 'maxX' }[] = [
    { grid: (k) => k, outward: 'minZ' },
    { grid: (k) => (n - 1) * n + k, outward: 'maxZ' },
    { grid: (k) => k * n, outward: 'minX' },
    { grid: (k) => k * n + (n - 1), outward: 'maxX' },
  ];

  let skirtBase = n * n;
  for (const edge of edges) {
    for (let k = 0; k < n; k++) {
      const g = edge.grid(k);
      const v = skirtBase + k;
      positions[v * 3] = positions[g * 3]!;
      positions[v * 3 + 1] = positions[g * 3 + 1]! - skirtDepth;
      positions[v * 3 + 2] = positions[g * 3 + 2]!;
      colors[v * 3] = colors[g * 3]!;
      colors[v * 3 + 1] = colors[g * 3 + 1]!;
      colors[v * 3 + 2] = colors[g * 3 + 2]!;
    }
    for (let k = 0; k < segments; k++) {
      const g0 = edge.grid(k);
      const g1 = edge.grid(k + 1);
      const s0 = skirtBase + k;
      const s1 = skirtBase + k + 1;
      // minZ et maxX tournent dans un sens, maxZ et minX dans l'autre.
      if (edge.outward === 'minZ' || edge.outward === 'maxX') {
        tri(g0, s0, g1);
        tri(g1, s0, s1);
      } else {
        tri(g0, g1, s0);
        tri(g1, s1, s0);
      }
    }
    skirtBase += n;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test tile-geometry`
Expected: PASS, 6 tests.

Si « ORIENTE les jupes vers l'extérieur » échoue sur un bord précis, inverser l'ordre des deux triangles de CE bord uniquement — pas de tous. Le test nomme le triangle fautif.

- [ ] **Step 6: Commit**

```bash
git add packages/world/src/terrain/geometry.ts packages/world/test/tile-geometry.test.ts \
        packages/world/test/mocks/iwsdk-core.ts
git commit -m "feat(world): tile geometry with outward-facing skirts that hide LOD cracks"
```

---

### Task 4: Composant, streaming et construction budgétée

**Files:**
- Create: `packages/world/src/terrain/components.ts`
- Create: `packages/world/src/terrain/TerrainStreamingSystem.ts`
- Create: `packages/world/src/terrain/TerrainMeshSystem.ts`
- Modify: `packages/world/src/install.ts`
- Modify: `packages/world/src/index.ts`
- Modify: `packages/world/tsup.config.ts` (externaliser le moteur)
- Test: `packages/world/test/terrain-streaming.test.ts`

**Interfaces:**
- Consumes: `desiredTiles`, `diffTiles`, `tileKey`, `tileOriginX`, `tileOriginZ`, `TILE_SIZE`, `LOD_SEGMENTS` (tâche 1) ; `sampleTile` (tâche 2) ; `buildTileGeometry` (tâche 3).
- Produces:
  - `TerrainTile` — composant elics : `tx`, `tz`, `lod` (`Types.Int16`), `_needsBuild` (`Types.Boolean`)
  - `TerrainStreamingSystem` avec `pendingCount: number` et `lastCentreKey: string`
  - `TerrainMeshSystem` avec `builtCount: number` et `TILES_PER_FRAME: number`
  - `installCardinalWorld` rend en plus `{ terrain: { streaming, mesh } }`

**La décision de conception la plus importante de cette phase.** `EnvironmentManager` du locomoteur parcourt **tous** les environnements enregistrés à chaque image, pour la détection du sol comme pour la collision, **sans aucun tri spatial** (`ground-detector.js:46`, `collision-handler.js:33` : `for (const env of environments)`). Donner un maillage de collision à chacune des 49 tuiles imposerait 49 requêtes BVH par image. **Seules les tuiles de niveau 0 — les neuf sur lesquelles on peut réellement marcher — portent `LocomotionEnvironment`.** Les autres sont purement visuelles.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/world/test/terrain-streaming.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { TerrainTile } from '../src/terrain/components';
import { TerrainStreamingSystem } from '../src/terrain/TerrainStreamingSystem';
import { TerrainMeshSystem } from '../src/terrain/TerrainMeshSystem';
import { TILE_SIZE, MAX_RING } from '../src/terrain/tiling';

function makeRig() {
  const world = new World();
  world.registerComponent(TerrainTile);
  world.registerSystem(TerrainStreamingSystem);
  world.registerSystem(TerrainMeshSystem);
  const streaming = world.getSystem(TerrainStreamingSystem) as TerrainStreamingSystem;
  const mesh = world.getSystem(TerrainMeshSystem) as TerrainMeshSystem;
  // Le joueur : un simple porteur de position, comme XROrigin qui étend Group.
  const player = { position: { x: 0, y: 0, z: 0 } };
  (streaming as unknown as { player: unknown }).player = player;
  (mesh as unknown as { player: unknown }).player = player;
  return { world, streaming, mesh, player };
}

describe('TerrainStreamingSystem', () => {
  it('crée une entité par tuile voulue', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    const side = 2 * MAX_RING + 1;
    expect(rig.streaming.pendingCount).toBe(side * side);
  });

  it('NE FAIT RIEN tant que le joueur reste dans sa tuile', () => {
    // Sinon le monde se reconstruirait à chaque pas.
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    const after = rig.streaming.pendingCount;
    rig.player.position.x = TILE_SIZE - 1;
    rig.streaming.update(0.016, 0.016);
    expect(rig.streaming.pendingCount).toBe(after);
  });

  it('réagit quand le joueur franchit une frontière de tuile', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    const before = rig.streaming.lastCentreKey;
    rig.player.position.x = TILE_SIZE * 2 + 1;
    rig.streaming.update(0.016, 0.016);
    expect(rig.streaming.lastCentreKey).not.toBe(before);
  });
});

describe('TerrainMeshSystem', () => {
  it("ne construit qu'un nombre borné de tuiles par image", () => {
    // Le budget VR est de 11 à 14 ms au total ; une tuile 33x33 coûte 0,61 ms.
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    rig.mesh.update(0.016, 0);
    expect(rig.mesh.builtCount).toBeLessThanOrEqual(rig.mesh.TILES_PER_FRAME);
    expect(rig.mesh.builtCount).toBeGreaterThan(0);
  });

  it('finit par tout construire, image après image', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    const side = 2 * MAX_RING + 1;
    for (let frame = 0; frame < side * side + 5; frame++) rig.mesh.update(0.016, frame * 0.016);
    expect(rig.mesh.builtCount).toBe(side * side);
  });

  it('marque comme construite chaque tuile traitée', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    for (let frame = 0; frame < 60; frame++) rig.mesh.update(0.016, frame * 0.016);
    for (const entity of rig.mesh.queries.tiles.entities) {
      expect(entity.getValue(TerrainTile, '_needsBuild')).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Compléter le mock avec `LocomotionEnvironment` et `createTransformEntity`**

Ajouter à `packages/world/test/mocks/iwsdk-core.ts` un composant de locomotion
fidèle à celui d'IWSDK (`locomotion-environment.js:11-19`, trois champs) :

```ts
export const LocomotionEnvironment = createComponent(
  'LocomotionEnvironment',
  {
    type: { type: Types.String, default: 'static' },
    _envHandle: { type: Types.Float32, default: 0 },
    _initialized: { type: Types.Boolean, default: false },
  },
  'Locomotion environment',
);
```

`World` du mock vient d'elics et ne connaît pas `createTransformEntity` ; le
test l'ajoute lui-même dans `makeRig`, ce qui suffit et garde le mock honnête :

```ts
  (world as unknown as { createTransformEntity: unknown }).createTransformEntity = (
    object: unknown,
  ) => {
    const entity = world.createEntity();
    (entity as unknown as { object3D: unknown }).object3D = object;
    return entity;
  };
  world.registerComponent(LocomotionEnvironment);
```

- [ ] **Step 3: Lancer les tests et vérifier qu'ils échouent**

Run: `pnpm --filter @iwsdk/cardinal-world test terrain-streaming`
Expected: FAIL — les trois modules n'existent pas.

- [ ] **Step 4: Écrire le composant**

Créer `packages/world/src/terrain/components.ts` :

```ts
import { Types, createComponent } from '@iwsdk/core';

/**
 * Une tuile de terrain. `_needsBuild` suit la convention des composants
 * d'environnement d'IWSDK (`DomeGradient._needsUpdate`) : le système qui
 * consomme le drapeau est aussi celui qui le baisse.
 */
export const TerrainTile = createComponent(
  'TerrainTile',
  {
    tx: { type: Types.Int16, default: 0 },
    tz: { type: Types.Int16, default: 0 },
    lod: { type: Types.Int16, default: 0 },
    _needsBuild: { type: Types.Boolean, default: true },
  },
  'Streamed terrain tile',
);
```

- [ ] **Step 5: Écrire le système de streaming**

Créer `packages/world/src/terrain/TerrainStreamingSystem.ts` :

```ts
import {
  createSystem,
  Types,
  Mesh,
  BufferGeometry,
  LocomotionEnvironment,
  type Entity,
} from '@iwsdk/core';
import { TerrainTile } from './components';
import {
  desiredTiles,
  diffTiles,
  tileIndexFor,
  tileKey,
  tileOriginX,
  tileOriginZ,
  type TileSpec,
} from './tiling';

/**
 * Maintient l'ensemble de tuiles voulu autour du joueur (spec §6).
 *
 * Ne travaille que lorsque le joueur CHANGE de tuile : recalculer l'ensemble
 * à chaque image gaspillerait le budget, et le résultat serait identique.
 */
export class TerrainStreamingSystem extends createSystem(
  { tiles: { required: [TerrainTile] } },
  { material: { type: Types.Object, default: null } },
) {
  public pendingCount = 0;
  public lastCentreKey = '';

  private readonly current = new Map<string, TileSpec>();

  init(): void {
    // Alloué ici, jamais dans update() : la règle du dépôt traite toute
    // allocation par image comme un défaut.
    this.lastCentreKey = '';
    // On NE PASSE PAS par withLevelRoot : install.ts importe ce système, donc
    // lui emprunter un utilitaire créerait un cycle d'imports. Le signal se
    // lit directement, avec peek() comme l'exige la règle du dépôt.
  }

  private levelRootNow(): Entity | undefined {
    const root = this.world.activeLevel.peek() as Entity | null;
    return root ?? undefined;
  }

  update(): void {
    const player = this.player as unknown as { position: { x: number; z: number } } | undefined;
    if (player === undefined) return;

    const desired = desiredTiles(player.position.x, player.position.z);
    const centre = tileKey(tileIndexFor(player.position.x), tileIndexFor(player.position.z));
    if (centre === this.lastCentreKey) return;
    this.lastCentreKey = centre;

    const diff = diffTiles(this.current, desired);

    for (const key of diff.toRemove) {
      for (const entity of this.queries.tiles.entities) {
        const k = tileKey(entity.getValue(TerrainTile, 'tx')!, entity.getValue(TerrainTile, 'tz')!);
        if (k !== key) continue;
        // dispose(), jamais destroy() : destroy fuit la mémoire GPU.
        entity.dispose();
        break;
      }
      this.current.delete(key);
    }

    for (const spec of diff.toBuild) {
      // La tuile naît avec une géométrie VIDE : TerrainMeshSystem la remplira
      // quand le budget de l'image le permettra. Créer le maillage ici ferait
      // exploser la frame où le joueur franchit une frontière.
      const mesh = new Mesh(new BufferGeometry(), this.config.material.value);
      mesh.name = `TerrainTile ${spec.tx},${spec.tz}`;
      mesh.position.set(tileOriginX(spec.tx), 0, tileOriginZ(spec.tz));
      mesh.castShadow = false; // le sol reçoit l'ombre, il n'en projette pas

      const entity = this.world.createTransformEntity(mesh, this.levelRootNow());
      entity.addComponent(TerrainTile, {
        tx: spec.tx,
        tz: spec.tz,
        lod: spec.lod,
        _needsBuild: true,
      });

      // SEULES les tuiles de niveau 0 sont marchables. Le locomoteur parcourt
      // tous les environnements enregistrés à chaque image, sans tri spatial :
      // en donner 49 lui imposerait 49 requêtes BVH par frame.
      if (spec.lod === 0) entity.addComponent(LocomotionEnvironment);

      this.current.set(tileKey(spec.tx, spec.tz), spec);
    }

    this.pendingCount = this.current.size;
  }
}
```

- [ ] **Step 6: Écrire le système de construction budgétée**

Créer `packages/world/src/terrain/TerrainMeshSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import { TerrainTile } from './components';
import { LOD_SEGMENTS, TILE_SIZE, tileOriginX, tileOriginZ } from './tiling';
import { sampleTile } from './sampling';
import { buildTileGeometry } from './geometry';

/**
 * Construit les tuiles marquées, AU PLUS UNE PAR IMAGE (spec §6).
 *
 * Le chiffre n'est pas arbitraire : une tuile 33×33 échantillonnée en grille
 * coûte 0,61 ms mesurées, et une image VR entière en vaut 11 à 14. En
 * construire deux mangerait un dixième du budget pour le seul terrain.
 */
export class TerrainMeshSystem extends createSystem({
  tiles: { required: [TerrainTile] },
}) {
  public readonly TILES_PER_FRAME = 1;
  public builtCount = 0;

  update(): void {
    let budget = this.TILES_PER_FRAME;
    for (const entity of this.queries.tiles.entities) {
      if (budget <= 0) return;
      if (entity.getValue(TerrainTile, '_needsBuild') !== true) continue;

      const tx = entity.getValue(TerrainTile, 'tx')!;
      const tz = entity.getValue(TerrainTile, 'tz')!;
      const lod = entity.getValue(TerrainTile, 'lod')!;
      const segments = LOD_SEGMENTS[Math.min(lod, LOD_SEGMENTS.length - 1)]!;

      const sample = sampleTile(tileOriginX(tx), tileOriginZ(tz), TILE_SIZE, segments);
      const geometry = buildTileGeometry(sample);

      const object = (entity as unknown as { object3D?: { geometry?: unknown } }).object3D;
      if (object !== undefined) {
        const previous = object.geometry as { dispose?: () => void } | undefined;
        // Libérer AVANT de remplacer : un remplacement muet fuit le tampon GPU.
        // C'est le pendant de la règle « dispose(), jamais destroy() ».
        previous?.dispose?.();
        object.geometry = geometry;
      }

      entity.setValue(TerrainTile, '_needsBuild', false);
      this.builtCount++;
      budget--;
    }
  }
}
```

- [ ] **Step 7: Enregistrer dans l'installation**

Dans `packages/world/src/install.ts`, ajouter `TerrainTile` à la chaîne `registerComponent`, enregistrer les deux systèmes après `MaterialSystem`, et étendre la valeur de retour :

```ts
world.registerSystem(TerrainStreamingSystem, {
  configData: { material: terrainMaterial },
});
world.registerSystem(TerrainMeshSystem);
```

où `terrainMaterial` est un clone du matériau `grass` de la bibliothèque, avec
`vertexColors = true` — exactement le montage que `ProceduralTerrain` utilise
aujourd'hui, et pour la même raison : les autres usagers de `grass` ne veulent
pas de couleurs par sommet, donc la tuile a besoin de sa propre instance.

et rendre `{ quality, materials, colorManaged, terrain: { streaming: world.getSystem(TerrainStreamingSystem), mesh: world.getSystem(TerrainMeshSystem) } }`.

Réexporter depuis `packages/world/src/index.ts` : `TerrainTile`, `TerrainStreamingSystem`, `TerrainMeshSystem`, `TILE_SIZE`, `MAX_RING`, `LOD_SEGMENTS`, `desiredTiles`, `sampleTile`, `buildTileGeometry`, `SKIRT_DEPTH`.

Dans `packages/world/tsup.config.ts`, ajouter `'@iwsdk/cardinal-simulation'` au tableau `external` — sans quoi tsup **embarquerait le moteur entier** dans le bundle de `world`, en doublon de la copie que la démo importe déjà.

- [ ] **Step 8: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @iwsdk/cardinal-world test && pnpm --filter @iwsdk/cardinal-world typecheck`
Expected: tests verts, 0 erreur de type.

- [ ] **Step 9: Commit**

```bash
git add packages/world/src/terrain packages/world/src/install.ts packages/world/src/index.ts \
        packages/world/tsup.config.ts packages/world/test/terrain-streaming.test.ts
git commit -m "feat(world): stream terrain tiles around the player, one build per frame"
```

---

### Task 5: Migration de la démo et locomotion

**Files:**
- Modify: `apps/demo/src/index.ts` (passer le matériau de terrain à l'installation)
- Modify: `apps/demo/src/simulation/PrehistoricEnvironment3D.ts:56` (supprimer le terrain mort)
- Modify: `apps/demo/src/simulation/ProceduralGrassField.ts:63` (ne plus dériver de `ProceduralTerrain.SIZE`)
- Modify: `apps/demo/public/scenes/main.iwsdk.scene.json` (nœud `environment`)
- Delete: `apps/demo/src/scene-assets/environment-ground.scene-asset.ts`
- Modify: `apps/demo/src/assets.ts` (retirer l'entrée du manifeste)
- Delete: `apps/demo/src/simulation/ProceduralTerrain.ts`

**Interfaces:**
- Consumes: tout ce que les tâches 1 à 4 produisent.
- Produces: rien — cette tâche démonte l'ancien monde.

**Le risque de cette tâche, énoncé sans détour.** `apps/demo/CLAUDE.md:51` prévient : « `locomotion: true` sans `LocomotionEnvironment` sur un sol → **le joueur tombe à travers le monde**. » On retire le sol unique qui porte ce composant aujourd'hui pour le confier à des tuiles créées à l'exécution. Si le raccordement échoue, l'échec est spectaculaire et immédiat — ce qui est une chance : il ne peut pas passer inaperçu.

Second point à vérifier et non à supposer : dans la scène actuelle, `LocomotionEnvironment` est écrit **sans préfixe**, alors que `DomeGradient` et `IBLGradient` portent `com.iwsdk.components.`. Or `level-component-applier.js:32-36` ignore silencieusement un nom non préfixé sauf option contraire. Il faut donc **d'abord établir si la locomotion fonctionne réellement aujourd'hui**, sans quoi on attribuerait à la migration une panne préexistante.

- [ ] **Step 1: Établir l'état de référence AVANT de toucher à quoi que ce soit**

```bash
cd apps/demo && npx iwsdk dev up
```

Attendre `browserCommandReady: true`, puis relever la position du joueur après quelques secondes :

```bash
npx iwsdk ecs find --input-json '{"withComponents":["LocomotionEnvironment"],"limit":10}'
```

Noter combien d'entités portent le composant **aujourd'hui**. Si la réponse est `0`, la locomotion ne repose pas sur ce nœud et le préfixe manquant est bien le coupable : le signaler avant de continuer, car cela change la nature de la tâche. Si la réponse est `1`, l'état de référence est sain.

Arrêter le serveur : `npx iwsdk dev down`

- [ ] **Step 2: Supprimer le terrain mort de la démo**

`PrehistoricEnvironment3D.ts:56` appelle `ProceduralTerrain.createTerrain(materials)` et n'ajoute **jamais** `terrain.mesh` à la scène — le maillage visible est celui du scene-asset. Ce second terrain est 9409 sommets construits au démarrage pour la seule closure `getHeight`, soit **42 ms mesurées** de classification de biomes jetées.

Remplacer l'objet `terrain` par une simple délégation au moteur. En tête du fichier :

```ts
import { getTerrainHeight, isRiverAt } from '@iwsdk/cardinal-simulation';
```

et remplacer la ligne 56 par :

```ts
// Le terrain est désormais streamé en tuiles par @iwsdk/cardinal-world. Cette
// scène n'a besoin que de POSER des objets dessus, donc de la fonction de
// hauteur — pas d'un maillage. L'ancien appel construisait 9409 sommets qui
// n'étaient jamais ajoutés à la scène.
const terrain = {
  getHeight: getTerrainHeight,
  isRiver: isRiverAt,
  size: 64,
};
```

Adapter le type `TerrainData` de `PrehistoricSceneResult` en conséquence : retirer le champ `mesh` de l'interface, dans `ProceduralTerrain.ts` si elle y vit encore, sinon la redéclarer localement :

```ts
export interface TerrainData {
  getHeight: (x: number, z: number) => number;
  isRiver: (x: number, z: number) => boolean;
  size: number;
}
```

- [ ] **Step 3: Découpler le semis d'herbe de l'ancienne constante**

`ProceduralGrassField.ts:63` fait `const spread = ProceduralTerrain.SIZE * 0.45;`. Remplacer par une constante locale explicite, l'herbe étant un effet de proximité qui n'a aucune raison de suivre la taille du terrain :

```ts
/** L'herbe n'habille que les abords immédiats du joueur, pas tout le terrain. */
const GRASS_SPREAD = 28.8;
```

et utiliser `GRASS_SPREAD` aux lignes qui référençaient `spread`. Remplacer aussi `ProceduralTerrain.isRiver` / `ProceduralTerrain.getHeight` par les imports directs `isRiverAt` / `getTerrainHeight` de `@iwsdk/cardinal-simulation`.

- [ ] **Step 4: Câbler le matériau de terrain à l'installation**

Dans `apps/demo/src/index.ts`, là où `installCardinalWorld` est appelé, la bibliothèque de matériaux n'existe pas encore au moment de l'appel. Construire donc le matériau APRÈS, et le donner au système :

```ts
const { quality, materials, colorManaged, terrain } = installCardinalWorld(world, {
  latitudeDeg: 45,
});
console.log(
  `[demo] environment quality tier: ${quality}, colour managed: ${colorManaged}`,
);
```

`installCardinalWorld` fabrique lui-même le clone `grass` + `vertexColors` et le passe en `configData` (tâche 4, étape 7) ; la démo n'a donc rien à faire de plus que de recevoir `terrain` et de le journaliser :

```ts
console.log(`[demo] terrain tiles: ${terrain.streaming.pendingCount} pending`);
```

- [ ] **Step 5: Retirer le sol unique de la scène**

Dans `apps/demo/public/scenes/main.iwsdk.scene.json`, **supprimer entièrement** le nœud `id: "environment"` (celui qui porte `LocomotionEnvironment` et `content.asset: "environment-ground"`). Les tuiles portent désormais ce composant elles-mêmes.

Puis retirer l'entrée `'environment-ground'` de `defineAssets({...})` dans `apps/demo/src/assets.ts` et son import en tête de fichier, et supprimer les deux fichiers devenus morts :

```bash
git rm apps/demo/src/scene-assets/environment-ground.scene-asset.ts
git rm apps/demo/src/simulation/ProceduralTerrain.ts
```

- [ ] **Step 6: Vérifier la compilation et la suite**

Run:
```bash
pnpm typecheck && pnpm test && pnpm build && pnpm --filter @iwsdk/plugin-phoenix-demo build
```
Expected: 0 erreur de type ; suite verte (le total passe d'environ 560 à environ 590) ; 18 paquets ; build démo OK.

Le typecheck est ici le filet principal : supprimer `ProceduralTerrain` fera échouer tout import résiduel que ce plan aurait manqué.

- [ ] **Step 7: LA vérification qui compte — le joueur ne tombe pas**

```bash
cd apps/demo && npx iwsdk dev up
```

Après `browserCommandReady: true` :

1. **Compter les environnements de locomotion** — il doit y en avoir neuf, les tuiles de niveau 0 :
   ```bash
   npx iwsdk ecs find --input-json '{"withComponents":["LocomotionEnvironment"],"limit":60}'
   ```
2. **Compter les tuiles** — 49 attendues :
   ```bash
   npx iwsdk ecs find --input-json '{"withComponents":["TerrainTile"],"limit":60}'
   ```
3. **Vérifier que le joueur repose sur le sol** : relever sa position, qui doit rester proche de la hauteur du terrain et **ne pas décroître sans fin**. Deux relevés espacés de quelques secondes suffisent : une chute libre est immédiatement visible.
4. **Capture d'exécution** (`browser_screenshot`, jamais `scene_screenshot` — le rendu éditeur n'exécute pas les systèmes) : vérifier qu'il n'y a **aucune fissure de ciel** entre les tuiles, et que le relief s'étend bien au-delà des 64 m d'autrefois.
5. **Console complète** (`browser_get_console_logs` avec `count` seul, jamais `level` : un filtre de niveau masque les erreurs).

Arrêter le serveur : `npx iwsdk dev down`

- [ ] **Step 8: Commit**

```bash
git add -A apps/demo
git commit -m "feat(demo): replace the single 64 m ground with streamed terrain tiles"
```

---

## Ce que la phase 3B ne fait PAS

- **Pas d'horizon kilométrique.** `apps/demo/iwsdk.config.json` fixe le plan de coupe lointain à **200 m** et le plan proche à **0,001**. Les 49 tuiles couvrent 224 m, ce qui tient tout juste dans ce volume. Aller au kilomètre exigerait un rapport proche/lointain de deux millions, que le tampon de profondeur ne supporte pas : il faudrait d'abord décider d'une profondeur logarithmique ou remonter le plan proche. **C'est une décision à prendre, pas un oubli.**
- **Pas de construction en worker.** L'échantillonnage tient dans le budget d'une image ; déporter dans un worker ajouterait de la copie structurée pour un gain nul à cette échelle.
- **Pas de quadtree.** Les tuiles sont toutes de 32 m ; un vrai quadtree réduirait le nombre d'appels de dessin (49 aujourd'hui) mais complique le raccordement des bords. À reconsidérer si la mesure montre que les appels de dessin dominent.
- **Pas de streaming de la végétation ni de la faune.** Arbres, herbe et rochers restent posés autour de l'origine. Le semis déterministe `scatterAt` de la spec §8 appartient à la phase flore.
- **Pas de collision au-delà de l'anneau proche.** Marcher jusqu'au bord des neuf tuiles de niveau 0 (96 m) puis continuer ferait tomber le joueur. Tant que la zone simulée vaut 64 m, aucun agent ni objet n'existe au-delà ; ce sera à traiter quand l'écologie étendra le domaine.
