# Environnement procédural ECS — Phase 2 : matériaux PBR et gestion des couleurs — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner de la matière aux surfaces : une `MaterialLibrary` qui génère procéduralement des textures PBR tuilables (albédo, normale, ORM) mises en cache et partagées, une gestion des couleurs correcte (espace de sortie, ACES Filmic, exposition pilotée par le ciel), et la migration des surfaces de la démo vers ces matériaux.

**Architecture:** Le bruit et les données de texture sont des **fonctions pures** produisant des tableaux typés — testables sans GPU ni navigateur. La `MaterialLibrary` est une mince couche qui emballe ces tableaux dans des `DataTexture` (aucun canvas requis), assigne les espaces colorimétriques et met en cache une instance de matériau par identifiant. Un composant `ProceduralMaterial` rend le choix de matière authorable ; un `ExposureSystem` relie l'exposition du renderer au modèle de ciel de la phase 1.

**Tech Stack:** TypeScript strict, vitest 3, `@iwsdk/core` (réexporte `DataTexture`, `MeshStandardMaterial`, `SRGBColorSpace`, `NoColorSpace`, `ACESFilmicToneMapping`, `RepeatWrapping` — vérifié par compilation).

**Spec:** `docs/superpowers/specs/2026-08-16-environnement-procedural-ecs-design.md` (sections 5, 10, 11 phase 2)

## Global Constraints

- `packages/world` n'importe **jamais** `three` directement — tout passe par `@iwsdk/core` (peer dependency). Le garde-fou `scripts/check-single-three.mjs` doit rester vert.
- **Toute la logique calculatoire est pure** : bruit, champs de hauteur, albédo, normales, ORM. Les systèmes et la bibliothèque ne font qu'appliquer.
- Les textures sont **exactement tuilables** : le bruit utilise un réseau périodique, sans quoi les coutures se voient sur les grandes surfaces.
- **Espaces colorimétriques** : albédo en `SRGBColorSpace`, normale et ORM en `NoColorSpace` (données linéaires). Une erreur ici produit le rendu « lavé » caractéristique.
- **Convention glTF pour l'ORM** : canal R = occlusion ambiante, G = rugosité, B = métallicité — une seule texture servant `aoMap`, `roughnessMap` et `metalnessMap`.
- Une **instance de matériau par identifiant**, partagée par toutes les entités ; la bibliothèque porte la responsabilité du `dispose`.
- Génération **paresseuse** : un matériau n'est calculé qu'à sa première demande (une texture 1024² RGBA pèse 4 Mo ; générer tout le catalogue d'office gaspillerait la VRAM).
- Ne jamais allouer dans `update()`.
- Messages de commit `feat(...)`/`refactor(...)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Structure de fichiers cible

```text
packages/world/src/
├── materials/
│   ├── noise.ts            (nouveau) bruit de valeur périodique, fBm — pur
│   ├── textureData.ts      (nouveau) champs de hauteur, albédo, normale, ORM — pur
│   ├── definitions.ts      (nouveau) catalogue des matières (palette, bruit, rugosité)
│   ├── MaterialLibrary.ts  (nouveau) génération DataTexture, cache, dispose
│   ├── components.ts       (nouveau) ProceduralMaterial
│   └── MaterialSystem.ts   (nouveau) applique la bibliothèque aux entités
├── core/colorManagement.ts (nouveau) espace de sortie + ACES
├── atmosphere/ExposureSystem.ts (nouveau) exposition pilotée par SkyModel
├── install.ts              (modifié) enregistre les nouveaux composants/systèmes
└── index.ts                (modifié) exports

packages/world/test/
├── mocks/iwsdk-core.ts     (modifié) stubs DataTexture/MeshStandardMaterial/constantes
├── noise.test.ts  texture-data.test.ts  material-library.test.ts
└── material-system.test.ts

apps/demo/src/simulation/
├── PrehistoricEnvironment3D.ts (modifié) matériaux depuis la bibliothèque
├── ProceduralVegetation.ts     (modifié) écorce et feuillage
└── ProceduralTerrain.ts        (modifié) détail de surface sur les couleurs de sommet
```

---

### Task 1 : Bruit périodique tuilable

**Files:**
- Create: `packages/world/src/materials/noise.ts`
- Modify: `packages/world/src/index.ts`
- Test: `packages/world/test/noise.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces :
  - `function valueNoise2D(x: number, y: number, period: number, seed: number): number` — renvoie `[0, 1]`, **périodique de pas `period`** sur les deux axes.
  - `function fbm2D(x: number, y: number, period: number, seed: number, octaves?: number, gain?: number): number` — somme d'octaves, renvoie `[0, 1]`, tuilable si `period` est une puissance de deux.
  - `function ridged2D(x: number, y: number, period: number, seed: number, octaves?: number): number` — variante à crêtes pour la roche, renvoie `[0, 1]`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/world/test/noise.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { valueNoise2D, fbm2D, ridged2D } from '../src/materials/noise';

describe('valueNoise2D', () => {
  it('stays inside [0, 1]', () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise2D(i * 0.37, i * 0.11, 8, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for the same seed and position', () => {
    expect(valueNoise2D(3.3, 7.1, 8, 42)).toBe(valueNoise2D(3.3, 7.1, 8, 42));
  });

  it('differs between seeds', () => {
    expect(valueNoise2D(3.3, 7.1, 8, 1)).not.toBe(valueNoise2D(3.3, 7.1, 8, 2));
  });

  it('TILES exactly: sampling one period away gives the same value', () => {
    const period = 8;
    for (const [x, y] of [[0, 0], [1.7, 3.2], [5.5, 0.25], [7.9, 7.9]]) {
      expect(valueNoise2D(x!, y!, period, 7)).toBeCloseTo(valueNoise2D(x! + period, y!, period, 7), 10);
      expect(valueNoise2D(x!, y!, period, 7)).toBeCloseTo(valueNoise2D(x!, y! + period, period, 7), 10);
    }
  });

  it('is continuous: neighbouring samples stay close', () => {
    let previous = valueNoise2D(0, 2, 8, 5);
    for (let x = 0.01; x < 8; x += 0.01) {
      const current = valueNoise2D(x, 2, 8, 5);
      expect(Math.abs(current - previous)).toBeLessThan(0.1);
      previous = current;
    }
  });
});

describe('fbm2D', () => {
  it('stays inside [0, 1] and tiles exactly', () => {
    const period = 16;
    for (let i = 0; i < 200; i++) {
      const x = (i * 0.53) % period;
      const y = (i * 0.29) % period;
      const v = fbm2D(x, y, period, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeCloseTo(fbm2D(x + period, y + period, period, 3), 10);
    }
  });

  it('adds detail with more octaves (higher local variance)', () => {
    const sample = (octaves: number) => {
      const values: number[] = [];
      for (let x = 0; x < 4; x += 0.05) values.push(fbm2D(x, 1.5, 16, 9, octaves));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    };
    // More octaves means more high-frequency wiggle between neighbours.
    const smooth = sample(1);
    const detailed = sample(5);
    expect(detailed).toBeGreaterThan(0);
    expect(smooth).toBeGreaterThan(0);
  });
});

describe('ridged2D', () => {
  it('stays inside [0, 1] and tiles exactly', () => {
    const period = 8;
    for (let i = 0; i < 100; i++) {
      const x = (i * 0.71) % period;
      const v = ridged2D(x, 2.5, period, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeCloseTo(ridged2D(x + period, 2.5, period, 11), 10);
    }
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `cd packages/world && pnpm vitest run noise`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`packages/world/src/materials/noise.ts` :

```ts
/**
 * Periodic value noise (spec §5). The lattice wraps on `period`, so every
 * texture generated from it tiles EXACTLY — seams on a large terrain or a
 * repeated rock face are the fastest way to destroy realism, and they are
 * impossible to fix after the fact.
 *
 * Pure and dependency-free, like packages/simulation: no Three, no npm noise
 * library, fully unit-testable.
 */

/** Deterministic hash of an integer lattice point, in [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695040888963407) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep interpolation — C1 continuous, which keeps normals clean. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Positive modulo, so negative coordinates wrap correctly. */
function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

export function valueNoise2D(x: number, y: number, period: number, seed: number): number {
  const px = wrap(x, period);
  const py = wrap(y, period);
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = smooth(px - ix);
  const fy = smooth(py - iy);

  // Lattice indices wrap on `period` — this is what makes the result tileable.
  const x0 = wrap(ix, period);
  const x1 = wrap(ix + 1, period);
  const y0 = wrap(iy, period);
  const y1 = wrap(iy + 1, period);

  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x1, y0, seed);
  const n01 = hash2(x0, y1, seed);
  const n11 = hash2(x1, y1, seed);

  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

export function fbm2D(
  x: number,
  y: number,
  period: number,
  seed: number,
  octaves = 4,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    // Frequency doubles per octave; the period doubles with it, so every
    // octave stays periodic on the ORIGINAL period.
    sum += valueNoise2D(x * frequency, y * frequency, period * frequency, seed + octave * 101) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }
  return sum / norm;
}

export function ridged2D(
  x: number,
  y: number,
  period: number,
  seed: number,
  octaves = 4,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const n = valueNoise2D(x * frequency, y * frequency, period * frequency, seed + octave * 197);
    // Fold around 0.5 and invert: creates sharp crests instead of blobs.
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += ridge * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}
```

- [ ] **Step 4 : Vérifier le passage**

Run : `pnpm vitest run noise` → 8 passed ; `pnpm typecheck`.

Si le test de tuilage échoue, la cause est presque toujours que le réseau d'une octave n'a pas été mis à l'échelle avec la fréquence (`period * frequency`) — sans quoi les octaves fines ne bouclent pas sur la même période que la grossière.

- [ ] **Step 5 : Exporter et committer**

Ajouter dans `packages/world/src/index.ts` :

```ts
export { valueNoise2D, fbm2D, ridged2D } from './materials/noise';
```

```bash
git add packages/world/src/materials/noise.ts packages/world/src/index.ts packages/world/test/noise.test.ts
git commit -m "feat(world): exactly tileable periodic value noise, fbm and ridged variants

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : Données de texture (hauteur, albédo, normale, ORM)

**Files:**
- Create: `packages/world/src/materials/textureData.ts`
- Create: `packages/world/src/materials/definitions.ts`
- Modify: `packages/world/src/index.ts`
- Test: `packages/world/test/texture-data.test.ts`

**Interfaces:**
- Consumes: `fbm2D`, `ridged2D` (Task 1).
- Produces (definitions.ts) :
  - `type MaterialId = 'rock' | 'sand' | 'grass' | 'bark' | 'foliage' | 'hide' | 'flint' | 'clay'`
  - `interface MaterialDefinition { id: MaterialId; low: [number, number, number]; high: [number, number, number]; pattern: 'fbm' | 'ridged'; frequency: number; octaves: number; roughnessLow: number; roughnessHigh: number; normalStrength: number; seed: number }`
  - `const MATERIAL_DEFINITIONS: Record<MaterialId, MaterialDefinition>`
  - `const MATERIAL_IDS: MaterialId[]`
- Produces (textureData.ts) :
  - `function generateHeightField(definition: MaterialDefinition, size: number): Float32Array` — longueur `size²`, valeurs `[0, 1]`.
  - `function generateAlbedo(definition: MaterialDefinition, height: Float32Array, size: number): Uint8Array` — RGBA, longueur `size² * 4`.
  - `function generateORM(definition: MaterialDefinition, height: Float32Array, size: number): Uint8Array` — RGBA ; R = occlusion, G = rugosité, B = métallicité (0), A = 255.
  - `function generateNormal(height: Float32Array, size: number, strength: number): Uint8Array` — RGBA tangent-space encodée `[0, 255]`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/world/test/texture-data.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  generateHeightField,
  generateAlbedo,
  generateORM,
  generateNormal,
} from '../src/materials/textureData';
import { MATERIAL_DEFINITIONS, MATERIAL_IDS } from '../src/materials/definitions';

const SIZE = 32;
const rock = MATERIAL_DEFINITIONS.rock;

describe('generateHeightField', () => {
  it('produces size² values inside [0, 1]', () => {
    const height = generateHeightField(rock, SIZE);
    expect(height).toHaveLength(SIZE * SIZE);
    for (const v of height) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(Array.from(generateHeightField(rock, SIZE))).toEqual(
      Array.from(generateHeightField(rock, SIZE)),
    );
  });

  it('TILES: the last column continues into the first', () => {
    const height = generateHeightField(rock, SIZE);
    // Wrapping right off the edge must land near the left edge value.
    for (let row = 0; row < SIZE; row++) {
      const last = height[row * SIZE + (SIZE - 1)]!;
      const first = height[row * SIZE]!;
      expect(Math.abs(last - first)).toBeLessThan(0.35);
    }
  });

  it('is not flat (there is actual structure)', () => {
    const height = generateHeightField(rock, SIZE);
    expect(Math.max(...height) - Math.min(...height)).toBeGreaterThan(0.2);
  });
});

describe('generateAlbedo', () => {
  it('produces RGBA bytes with opaque alpha', () => {
    const height = generateHeightField(rock, SIZE);
    const albedo = generateAlbedo(rock, height, SIZE);
    expect(albedo).toHaveLength(SIZE * SIZE * 4);
    for (let i = 3; i < albedo.length; i += 4) expect(albedo[i]).toBe(255);
  });

  it('stays within the material palette range', () => {
    const grass = MATERIAL_DEFINITIONS.grass;
    const height = generateHeightField(grass, SIZE);
    const albedo = generateAlbedo(grass, height, SIZE);
    // Grass is green-dominant: G above R and B on average.
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < albedo.length; i += 4) {
      r += albedo[i]!;
      g += albedo[i + 1]!;
      b += albedo[i + 2]!;
    }
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});

describe('generateORM', () => {
  it('packs occlusion in R, roughness in G and zero metalness in B', () => {
    const height = generateHeightField(rock, SIZE);
    const orm = generateORM(rock, height, SIZE);
    expect(orm).toHaveLength(SIZE * SIZE * 4);
    for (let i = 0; i < orm.length; i += 4) {
      expect(orm[i + 2]).toBe(0); // dielectric
      expect(orm[i + 3]).toBe(255);
      expect(orm[i + 1]).toBeGreaterThanOrEqual(Math.floor(rock.roughnessLow * 255) - 1);
      expect(orm[i + 1]).toBeLessThanOrEqual(Math.ceil(rock.roughnessHigh * 255) + 1);
    }
  });
});

describe('generateNormal', () => {
  it('produces RGBA bytes centred around the flat normal', () => {
    const height = generateHeightField(rock, SIZE);
    const normal = generateNormal(height, SIZE, rock.normalStrength);
    expect(normal).toHaveLength(SIZE * SIZE * 4);
    let sumB = 0;
    for (let i = 0; i < normal.length; i += 4) {
      expect(normal[i + 3]).toBe(255);
      sumB += normal[i + 2]!;
    }
    // Z points out of the surface, so blue dominates on average.
    expect(sumB / (SIZE * SIZE)).toBeGreaterThan(180);
  });

  it('is flat when the height field is flat', () => {
    const flat = new Float32Array(SIZE * SIZE).fill(0.5);
    const normal = generateNormal(flat, SIZE, 1);
    for (let i = 0; i < normal.length; i += 4) {
      expect(normal[i]).toBe(128); // x = 0
      expect(normal[i + 1]).toBe(128); // y = 0
      expect(normal[i + 2]).toBe(255); // z = 1
    }
  });
});

describe('MATERIAL_DEFINITIONS', () => {
  it('declares every id with a sane palette and roughness range', () => {
    expect(MATERIAL_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of MATERIAL_IDS) {
      const def = MATERIAL_DEFINITIONS[id];
      expect(def.id).toBe(id);
      expect(def.roughnessLow).toBeLessThan(def.roughnessHigh);
      expect(def.roughnessHigh).toBeLessThanOrEqual(1);
      expect(def.octaves).toBeGreaterThan(0);
      for (const channel of [...def.low, ...def.high]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run texture-data` → FAIL, modules introuvables.

- [ ] **Step 3 : Implémenter le catalogue**

`packages/world/src/materials/definitions.ts` :

```ts
/**
 * The material catalogue (spec §5). Each entry is a recipe, not an asset:
 * two palette colours, a noise pattern, and a roughness range. Adding a
 * material is adding a row here — no texture files, no downloads.
 */
export type MaterialId =
  | 'rock'
  | 'sand'
  | 'grass'
  | 'bark'
  | 'foliage'
  | 'hide'
  | 'flint'
  | 'clay';

export interface MaterialDefinition {
  id: MaterialId;
  /** Palette endpoints in linear-ish [0,1] RGB; height blends between them. */
  low: [number, number, number];
  high: [number, number, number];
  pattern: 'fbm' | 'ridged';
  /** Noise cycles across one texture tile. */
  frequency: number;
  octaves: number;
  roughnessLow: number;
  roughnessHigh: number;
  normalStrength: number;
  seed: number;
}

export const MATERIAL_DEFINITIONS: Record<MaterialId, MaterialDefinition> = {
  rock: {
    id: 'rock', low: [0.28, 0.27, 0.26], high: [0.55, 0.53, 0.5],
    pattern: 'ridged', frequency: 6, octaves: 5,
    roughnessLow: 0.75, roughnessHigh: 0.95, normalStrength: 2.4, seed: 101,
  },
  sand: {
    id: 'sand', low: [0.62, 0.5, 0.33], high: [0.85, 0.74, 0.55],
    pattern: 'fbm', frequency: 14, octaves: 3,
    roughnessLow: 0.82, roughnessHigh: 0.95, normalStrength: 0.7, seed: 202,
  },
  grass: {
    id: 'grass', low: [0.13, 0.26, 0.08], high: [0.38, 0.55, 0.18],
    pattern: 'fbm', frequency: 10, octaves: 4,
    roughnessLow: 0.7, roughnessHigh: 0.92, normalStrength: 1.1, seed: 303,
  },
  bark: {
    id: 'bark', low: [0.16, 0.11, 0.07], high: [0.38, 0.28, 0.19],
    pattern: 'ridged', frequency: 3, octaves: 4,
    roughnessLow: 0.78, roughnessHigh: 0.96, normalStrength: 2.8, seed: 404,
  },
  foliage: {
    id: 'foliage', low: [0.09, 0.22, 0.07], high: [0.3, 0.48, 0.16],
    pattern: 'fbm', frequency: 8, octaves: 3,
    roughnessLow: 0.6, roughnessHigh: 0.85, normalStrength: 1.4, seed: 505,
  },
  hide: {
    id: 'hide', low: [0.32, 0.22, 0.14], high: [0.58, 0.44, 0.3],
    pattern: 'fbm', frequency: 5, octaves: 3,
    roughnessLow: 0.65, roughnessHigh: 0.88, normalStrength: 1.0, seed: 606,
  },
  flint: {
    id: 'flint', low: [0.14, 0.15, 0.17], high: [0.42, 0.44, 0.48],
    pattern: 'ridged', frequency: 9, octaves: 4,
    roughnessLow: 0.28, roughnessHigh: 0.55, normalStrength: 2.0, seed: 707,
  },
  clay: {
    id: 'clay', low: [0.4, 0.24, 0.16], high: [0.66, 0.44, 0.31],
    pattern: 'fbm', frequency: 7, octaves: 3,
    roughnessLow: 0.7, roughnessHigh: 0.9, normalStrength: 0.9, seed: 808,
  },
};

export const MATERIAL_IDS = Object.keys(MATERIAL_DEFINITIONS) as MaterialId[];
```

- [ ] **Step 4 : Implémenter les générateurs**

`packages/world/src/materials/textureData.ts` :

```ts
import { fbm2D, ridged2D } from './noise';
import type { MaterialDefinition } from './definitions';

/**
 * Pure texture generation (spec §5): typed arrays in, typed arrays out.
 * No canvas, no DOM, no GPU — which is why every pixel rule here is unit
 * tested. MaterialLibrary only wraps the result in DataTexture objects.
 */

/** Grayscale structure the other maps are derived from. */
export function generateHeightField(definition: MaterialDefinition, size: number): Float32Array {
  const height = new Float32Array(size * size);
  const sample = definition.pattern === 'ridged' ? ridged2D : fbm2D;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map pixel space onto the noise period so the texture tiles exactly.
      const nx = (x / size) * definition.frequency;
      const ny = (y / size) * definition.frequency;
      height[y * size + x] = sample(nx, ny, definition.frequency, definition.seed, definition.octaves);
    }
  }
  return height;
}

const toByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

export function generateAlbedo(
  definition: MaterialDefinition,
  height: Float32Array,
  size: number,
): Uint8Array {
  const albedo = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const t = height[i]!;
    albedo[i * 4] = toByte(definition.low[0] + (definition.high[0] - definition.low[0]) * t);
    albedo[i * 4 + 1] = toByte(definition.low[1] + (definition.high[1] - definition.low[1]) * t);
    albedo[i * 4 + 2] = toByte(definition.low[2] + (definition.high[2] - definition.low[2]) * t);
    albedo[i * 4 + 3] = 255;
  }
  return albedo;
}

/** glTF convention: R = ambient occlusion, G = roughness, B = metalness. */
export function generateORM(
  definition: MaterialDefinition,
  height: Float32Array,
  size: number,
): Uint8Array {
  const orm = new Uint8Array(size * size * 4);
  const span = definition.roughnessHigh - definition.roughnessLow;
  for (let i = 0; i < size * size; i++) {
    const t = height[i]!;
    // Crevices (low height) are both rougher and more occluded.
    orm[i * 4] = toByte(0.55 + 0.45 * t);
    orm[i * 4 + 1] = toByte(definition.roughnessHigh - span * t);
    orm[i * 4 + 2] = 0;
    orm[i * 4 + 3] = 255;
  }
  return orm;
}

export function generateNormal(height: Float32Array, size: number, strength: number): Uint8Array {
  const normal = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => {
    // Wrap so the normal map tiles as cleanly as the height field.
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return height[wy * size + wx]!;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Tangent-space normal from the height gradient, then normalised.
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      normal[i] = toByte((nx / length) * 0.5 + 0.5);
      normal[i + 1] = toByte((ny / length) * 0.5 + 0.5);
      normal[i + 2] = toByte((nz / length) * 0.5 + 0.5);
      normal[i + 3] = 255;
    }
  }
  return normal;
}
```

- [ ] **Step 5 : Vérifier le passage**

Run : `pnpm vitest run texture-data` → 10 passed ; `pnpm typecheck`.

Si le test « flat » de la normale échoue d'une unité (127 au lieu de 128), c'est l'arrondi : `toByte(0.5)` doit donner 128 — vérifier que la formule est bien `v * 0.5 + 0.5` puis `Math.round(v * 255)`.

- [ ] **Step 6 : Exporter et committer**

Ajouter dans `packages/world/src/index.ts` :

```ts
export {
  MATERIAL_DEFINITIONS,
  MATERIAL_IDS,
  type MaterialId,
  type MaterialDefinition,
} from './materials/definitions';
export {
  generateHeightField,
  generateAlbedo,
  generateORM,
  generateNormal,
} from './materials/textureData';
```

```bash
git add packages/world/src/materials packages/world/src/index.ts packages/world/test/texture-data.test.ts
git commit -m "feat(world): pure PBR texture generation (height, albedo, ORM, normal)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : MaterialLibrary — DataTexture, cache et espaces colorimétriques

**Files:**
- Create: `packages/world/src/materials/MaterialLibrary.ts`
- Modify: `packages/world/test/mocks/iwsdk-core.ts` (stubs Three)
- Modify: `packages/world/src/index.ts`
- Test: `packages/world/test/material-library.test.ts`

**Interfaces:**
- Consumes: `MATERIAL_DEFINITIONS`, `MaterialId` (Task 2), les quatre générateurs (Task 2), `QualityTier` (phase 1).
- Produces :
  - `const TEXTURE_SIZE: Record<QualityTier, number>` — `{ low: 512, high: 1024 }`
  - `class MaterialLibrary`
    - `constructor(quality: QualityTier)`
    - `get(id: MaterialId): MeshStandardMaterial` — génère à la première demande, renvoie **la même instance** ensuite
    - `has(id: MaterialId): boolean`
    - `size: number` (lecture, nombre de matériaux générés)
    - `dispose(): void` — libère matériaux et textures

- [ ] **Step 1 : Étendre le mock avec des stubs Three minimaux**

Ajouter à la fin de `packages/world/test/mocks/iwsdk-core.ts` :

```ts
// --- Minimal Three stubs -------------------------------------------------
// The library only needs these to exist and to record what was assigned;
// the pixel logic itself lives in pure functions and is tested directly.

export const SRGBColorSpace = 'srgb';
export const NoColorSpace = '';
export const RepeatWrapping = 1000;
export const RGBAFormat = 1023;
export const UnsignedByteType = 1009;
export const ACESFilmicToneMapping = 4;

export class DataTexture {
  public needsUpdate = false;
  public colorSpace = '';
  public wrapS = 0;
  public wrapT = 0;
  public disposed = false;
  constructor(
    public data: Uint8Array,
    public width: number,
    public height: number,
    public format?: number,
    public type?: number,
  ) {}
  dispose(): void {
    this.disposed = true;
  }
}

export class MeshStandardMaterial {
  public map: DataTexture | null = null;
  public normalMap: DataTexture | null = null;
  public roughnessMap: DataTexture | null = null;
  public metalnessMap: DataTexture | null = null;
  public aoMap: DataTexture | null = null;
  public vertexColors = false;
  public roughness = 1;
  public metalness = 0;
  public disposed = false;
  constructor(parameters: Record<string, unknown> = {}) {
    Object.assign(this, parameters);
  }
  dispose(): void {
    this.disposed = true;
  }
}
```

- [ ] **Step 2 : Écrire les tests qui échouent**

`packages/world/test/material-library.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { MaterialLibrary, TEXTURE_SIZE } from '../src/materials/MaterialLibrary';

describe('MaterialLibrary', () => {
  it('generates a material lazily and caches the instance', () => {
    const library = new MaterialLibrary('low');
    expect(library.size).toBe(0);
    expect(library.has('rock')).toBe(false);

    const first = library.get('rock');
    expect(library.size).toBe(1);
    expect(library.has('rock')).toBe(true);

    // Same instance: sharing materials is what keeps draw calls down.
    expect(library.get('rock')).toBe(first);
    expect(library.size).toBe(1);
  });

  it('wires the three maps with glTF ORM channel sharing', () => {
    const material = new MaterialLibrary('low').get('rock') as unknown as {
      map: { width: number; colorSpace: string };
      normalMap: { colorSpace: string };
      roughnessMap: unknown;
      metalnessMap: unknown;
      aoMap: unknown;
    };
    expect(material.map).toBeTruthy();
    expect(material.normalMap).toBeTruthy();
    // One ORM texture feeds roughness, metalness and occlusion.
    expect(material.roughnessMap).toBe(material.metalnessMap);
    expect(material.roughnessMap).toBe(material.aoMap);
  });

  it('assigns colour spaces correctly (albedo sRGB, data maps linear)', () => {
    const material = new MaterialLibrary('low').get('sand') as unknown as {
      map: { colorSpace: string };
      normalMap: { colorSpace: string };
      roughnessMap: { colorSpace: string };
    };
    expect(material.map.colorSpace).toBe('srgb');
    expect(material.normalMap.colorSpace).toBe('');
    expect(material.roughnessMap.colorSpace).toBe('');
  });

  it('honours the quality tier texture size', () => {
    expect(TEXTURE_SIZE.low).toBe(512);
    expect(TEXTURE_SIZE.high).toBe(1024);
    const low = new MaterialLibrary('low').get('grass') as unknown as { map: { width: number } };
    const high = new MaterialLibrary('high').get('grass') as unknown as { map: { width: number } };
    expect(low.map.width).toBe(512);
    expect(high.map.width).toBe(1024);
  });

  it('marks textures as repeating so they tile on large surfaces', () => {
    const material = new MaterialLibrary('low').get('grass') as unknown as {
      map: { wrapS: number; wrapT: number; needsUpdate: boolean };
    };
    expect(material.map.wrapS).toBe(1000);
    expect(material.map.wrapT).toBe(1000);
    expect(material.map.needsUpdate).toBe(true);
  });

  it('dispose releases every material and texture it created', () => {
    const library = new MaterialLibrary('low');
    const material = library.get('bark') as unknown as {
      disposed: boolean;
      map: { disposed: boolean };
      normalMap: { disposed: boolean };
      roughnessMap: { disposed: boolean };
    };
    library.dispose();
    expect(material.disposed).toBe(true);
    expect(material.map.disposed).toBe(true);
    expect(material.normalMap.disposed).toBe(true);
    expect(material.roughnessMap.disposed).toBe(true);
    expect(library.size).toBe(0);
  });
});
```

- [ ] **Step 3 : Vérifier l'échec** — `pnpm vitest run material-library` → FAIL, module introuvable.

- [ ] **Step 4 : Implémenter**

`packages/world/src/materials/MaterialLibrary.ts` :

```ts
import {
  DataTexture,
  MeshStandardMaterial,
  RGBAFormat,
  UnsignedByteType,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
} from '@iwsdk/core';
import type { QualityTier } from '../core/quality';
import { MATERIAL_DEFINITIONS, type MaterialId } from './definitions';
import {
  generateHeightField,
  generateAlbedo,
  generateORM,
  generateNormal,
} from './textureData';

/** Texture resolution per quality tier (spec §5). */
export const TEXTURE_SIZE: Record<QualityTier, number> = { low: 512, high: 1024 };

/**
 * Shared, lazily generated PBR materials (spec §5).
 *
 * Two properties earn their keep: materials are generated only on first
 * request (a 1024² RGBA texture is 4 MB — generating the whole catalogue
 * up front would waste VRAM), and every entity shares one instance per id,
 * which is what keeps the draw-call budget reachable on a headset.
 *
 * The library also OWNS disposal — the code it replaces leaked a material
 * per mesh.
 */
export class MaterialLibrary {
  private readonly materials = new Map<MaterialId, MeshStandardMaterial>();
  private readonly textures: DataTexture[] = [];

  constructor(private readonly quality: QualityTier) {}

  get size(): number {
    return this.materials.size;
  }

  has(id: MaterialId): boolean {
    return this.materials.has(id);
  }

  get(id: MaterialId): MeshStandardMaterial {
    const cached = this.materials.get(id);
    if (cached !== undefined) return cached;

    const definition = MATERIAL_DEFINITIONS[id];
    const size = TEXTURE_SIZE[this.quality];
    const height = generateHeightField(definition, size);

    const albedoMap = this.makeTexture(generateAlbedo(definition, height, size), size, SRGBColorSpace);
    const normalMap = this.makeTexture(generateNormal(height, size, definition.normalStrength), size, NoColorSpace);
    const ormMap = this.makeTexture(generateORM(definition, height, size), size, NoColorSpace);

    const material = new MeshStandardMaterial({
      map: albedoMap,
      normalMap,
      // glTF convention: one ORM texture, three slots reading their channel.
      roughnessMap: ormMap,
      metalnessMap: ormMap,
      aoMap: ormMap,
      roughness: 1,
      metalness: 0,
    });
    this.materials.set(id, material);
    return material;
  }

  private makeTexture(data: Uint8Array, size: number, colorSpace: string): DataTexture {
    const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    texture.colorSpace = colorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
    this.textures.push(texture);
    return texture;
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.materials.clear();
    this.textures.length = 0;
  }
}
```

- [ ] **Step 5 : Vérifier le passage**

Run : `pnpm vitest run material-library` → 6 passed ; `pnpm typecheck` ; `pnpm build`.

Le typecheck compile contre le **vrai** `@iwsdk/core` (seul vitest utilise le mock) : si `texture.colorSpace = colorSpace` échoue sur le type, remplacer `colorSpace: string` par le type importé `ColorSpace` d'`@iwsdk/core`.

- [ ] **Step 6 : Exporter et committer**

Ajouter dans `packages/world/src/index.ts` :

```ts
export { MaterialLibrary, TEXTURE_SIZE } from './materials/MaterialLibrary';
```

```bash
git add packages/world/src/materials/MaterialLibrary.ts packages/world/src/index.ts packages/world/test
git commit -m "feat(world): shared lazily-generated PBR material library with owned disposal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : Composant, système, et gestion des couleurs

**Files:**
- Create: `packages/world/src/materials/components.ts`
- Create: `packages/world/src/materials/MaterialSystem.ts`
- Create: `packages/world/src/core/colorManagement.ts`
- Create: `packages/world/src/atmosphere/ExposureSystem.ts`
- Modify: `packages/world/src/install.ts`, `packages/world/src/index.ts`
- Test: `packages/world/test/material-system.test.ts`

**Interfaces:**
- Consumes: `MaterialLibrary` (Task 3), `MaterialId` (Task 2), `SkyModel` (phase 1), `QualityTier` (phase 1).
- Produces :
  - `const ProceduralMaterial` — champs `materialId` (`Types.String`, défaut `'rock'`), `tiling` (`Types.Float32`, défaut 1), `_needsUpdate` (`Types.Boolean`, défaut true)
  - `class MaterialSystem` — config `library` (`Types.Object`) ; applique le matériau de la bibliothèque à `entity.object3D` quand `_needsUpdate` est levé, puis le rabaisse. Expose `appliedCount: number` pour la testabilité.
  - `function applyColorManagement(renderer: unknown): void` — pose `outputColorSpace = SRGBColorSpace` et `toneMapping = ACESFilmicToneMapping` ; sans effet si le renderer est absent.
  - `class ExposureSystem` — lit `SkyModel.exposure` et écrit `renderer.toneMappingExposure`. Expose `lastExposure: number`.
  - `installCardinalWorld` gagne : enregistrement de `ProceduralMaterial`, des deux systèmes, création de la `MaterialLibrary`, appel de `applyColorManagement`, et renvoie désormais `{ quality, materials }`.

- [ ] **Step 1 : Écrire les tests qui échouent**

`packages/world/test/material-system.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { MaterialLibrary } from '../src/materials/MaterialLibrary';
import { ProceduralMaterial } from '../src/materials/components';
import { MaterialSystem } from '../src/materials/MaterialSystem';
import { SkyModel } from '../src/atmosphere/components';
import { ExposureSystem } from '../src/atmosphere/ExposureSystem';
import { applyColorManagement } from '../src/core/colorManagement';

function makeWorld(library: MaterialLibrary) {
  const world = new World();
  world.registerComponent(ProceduralMaterial).registerComponent(SkyModel);
  world.registerSystem(MaterialSystem, { configData: { library } });
  world.registerSystem(ExposureSystem);
  return {
    world,
    materials: world.getSystem(MaterialSystem) as MaterialSystem,
    exposure: world.getSystem(ExposureSystem) as ExposureSystem,
  };
}

describe('MaterialSystem', () => {
  it('applies the library material to the entity object and clears the flag', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const entity = rig.world.createEntity();
    const mesh = { material: null as unknown };
    (entity as unknown as { object3D: unknown }).object3D = mesh;
    entity.addComponent(ProceduralMaterial, { materialId: 'grass' });

    rig.materials.update(0.016, 0);
    expect(mesh.material).toBe(library.get('grass'));
    expect(entity.getValue(ProceduralMaterial, '_needsUpdate')).toBe(false);
    expect(rig.materials.appliedCount).toBe(1);
  });

  it('does not reapply on later frames', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const entity = rig.world.createEntity();
    (entity as unknown as { object3D: unknown }).object3D = { material: null };
    entity.addComponent(ProceduralMaterial, { materialId: 'rock' });

    rig.materials.update(0.016, 0);
    rig.materials.update(0.016, 0);
    rig.materials.update(0.016, 0);
    expect(rig.materials.appliedCount).toBe(1);
  });

  it('ignores an unknown material id instead of throwing', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const entity = rig.world.createEntity();
    (entity as unknown as { object3D: unknown }).object3D = { material: null };
    entity.addComponent(ProceduralMaterial, { materialId: 'unobtanium' });

    expect(() => rig.materials.update(0.016, 0)).not.toThrow();
    expect(rig.materials.appliedCount).toBe(0);
  });
});

describe('ExposureSystem', () => {
  it('drives tone mapping exposure from the sky model', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const renderer = { toneMappingExposure: 1 };
    (rig.world as unknown as { renderer: unknown }).renderer = renderer;

    const entity = rig.world.createEntity();
    entity.addComponent(SkyModel, { exposure: 0.8 });
    rig.exposure.update(0.016, 0);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.8);
    expect(rig.exposure.lastExposure).toBeCloseTo(0.8);
  });

  it('survives a world without a renderer (headless tests, workers)', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const entity = rig.world.createEntity();
    entity.addComponent(SkyModel, { exposure: 1.2 });
    expect(() => rig.exposure.update(0.016, 0)).not.toThrow();
  });
});

describe('applyColorManagement', () => {
  it('sets the output colour space and ACES tone mapping', () => {
    const renderer = { outputColorSpace: '', toneMapping: 0 };
    applyColorManagement(renderer);
    expect(renderer.outputColorSpace).toBe('srgb');
    expect(renderer.toneMapping).toBe(4); // ACESFilmicToneMapping in the mock
  });

  it('is a no-op without a renderer', () => {
    expect(() => applyColorManagement(undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm vitest run material-system` → FAIL.

- [ ] **Step 3 : Implémenter le composant**

`packages/world/src/materials/components.ts` :

```ts
import { Types, createComponent } from '@iwsdk/core';

/**
 * Declares which library material an entity wears (spec §5). Making this a
 * component is the whole point of the ECS move: material choice becomes
 * queryable and authorable instead of buried in imperative mesh code.
 */
export const ProceduralMaterial = createComponent(
  'ProceduralMaterial',
  {
    materialId: { type: Types.String, default: 'rock' },
    tiling: { type: Types.Float32, default: 1 },
    _needsUpdate: { type: Types.Boolean, default: true },
  },
  'Procedural PBR material selected from the shared MaterialLibrary',
);
```

- [ ] **Step 4 : Implémenter les systèmes et la gestion des couleurs**

`packages/world/src/materials/MaterialSystem.ts` :

```ts
import { Types, createSystem } from '@iwsdk/core';
import { ProceduralMaterial } from './components';
import { MATERIAL_DEFINITIONS, type MaterialId } from './definitions';
import type { MaterialLibrary } from './MaterialLibrary';

/** Applies shared library materials to entities that ask for one. */
export class MaterialSystem extends createSystem(
  {
    surfaces: { required: [ProceduralMaterial] },
  },
  {
    library: { type: Types.Object, default: null },
  },
) {
  public appliedCount = 0;

  public override update(_delta: number, _time: number): void {
    const library = this.config.library.value as MaterialLibrary | null;
    if (library === null) return;

    for (const entity of this.queries.surfaces.entities) {
      if (entity.getValue(ProceduralMaterial, '_needsUpdate') !== true) continue;
      entity.setValue(ProceduralMaterial, '_needsUpdate', false);

      const id = entity.getValue(ProceduralMaterial, 'materialId') as MaterialId | undefined;
      // An unknown id is a content mistake, not a crash: leave the mesh alone.
      if (id === undefined || !(id in MATERIAL_DEFINITIONS)) continue;

      const target = (entity as unknown as { object3D?: { material?: unknown } }).object3D;
      if (target === undefined) continue;
      target.material = library.get(id);
      this.appliedCount++;
    }
  }
}
```

`packages/world/src/core/colorManagement.ts` :

```ts
import { ACESFilmicToneMapping, SRGBColorSpace } from '@iwsdk/core';

/**
 * Colour management (spec §5) — the cheapest realism win available.
 * Without an explicit output colour space and a filmic tone curve, PBR
 * materials read as washed-out plastic no matter how good the textures are.
 */
export function applyColorManagement(renderer: unknown): void {
  if (renderer === null || renderer === undefined) return;
  const target = renderer as { outputColorSpace?: unknown; toneMapping?: unknown };
  target.outputColorSpace = SRGBColorSpace;
  target.toneMapping = ACESFilmicToneMapping;
}
```

`packages/world/src/atmosphere/ExposureSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import { SkyModel } from './components';

/**
 * Ties renderer exposure to the sky (spec §5). This is what makes dusk
 * darken the WHOLE scene coherently instead of only tinting the dome.
 */
export class ExposureSystem extends createSystem({
  skies: { required: [SkyModel] },
}) {
  public lastExposure = 1;

  public override update(_delta: number, _time: number): void {
    const renderer = (this.world as unknown as { renderer?: { toneMappingExposure?: number } })
      .renderer;
    for (const entity of this.queries.skies.entities) {
      const exposure = entity.getValue(SkyModel, 'exposure') ?? 1;
      this.lastExposure = exposure;
      if (renderer !== undefined) renderer.toneMappingExposure = exposure;
    }
  }
}
```

- [ ] **Step 5 : Brancher dans l'installation**

Dans `packages/world/src/install.ts` :

Ajouter aux imports :

```ts
import { MaterialLibrary } from './materials/MaterialLibrary';
import { ProceduralMaterial } from './materials/components';
import { MaterialSystem } from './materials/MaterialSystem';
import { ExposureSystem } from './atmosphere/ExposureSystem';
import { applyColorManagement } from './core/colorManagement';
```

Changer la signature de retour et le corps :

```ts
export function installCardinalWorld(
  world: World,
  options: CardinalWorldOptions = {},
): { quality: QualityTier; materials: MaterialLibrary } {
  const quality = options.quality ?? detectQuality();
  const materials = new MaterialLibrary(quality);

  world
    .registerComponent(CelestialTime)
    .registerComponent(SkyModel)
    .registerComponent(StarField)
    .registerComponent(ProceduralMaterial);

  world.registerSystem(CelestialTimeSystem);
  world.registerSystem(SkyRenderSystem, { configData: { quality } });
  world.registerSystem(StarFieldSystem);
  world.registerSystem(ExposureSystem);
  world.registerSystem(MaterialSystem, { configData: { library: materials } });

  applyColorManagement((world as unknown as { renderer?: unknown }).renderer);
```

et remplacer le `return { quality };` final par `return { quality, materials };`.

- [ ] **Step 6 : Vérifier**

Run : `pnpm vitest run` (toute la suite du paquet — 26 tests de phase 1 + les nouveaux) puis `pnpm typecheck` et `pnpm build`.

- [ ] **Step 7 : Exporter et committer**

Ajouter dans `packages/world/src/index.ts` :

```ts
export { ProceduralMaterial } from './materials/components';
export { MaterialSystem } from './materials/MaterialSystem';
export { ExposureSystem } from './atmosphere/ExposureSystem';
export { applyColorManagement } from './core/colorManagement';
```

```bash
git add packages/world/src packages/world/test/material-system.test.ts
git commit -m "feat(world): procedural material component, system, and sky-driven colour management

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 : Migration des surfaces de la démo

**Files:**
- Modify: `apps/demo/src/index.ts` (récupère la bibliothèque)
- Modify: `apps/demo/src/simulation/PrehistoricEnvironment3D.ts`
- Modify: `apps/demo/src/simulation/ProceduralVegetation.ts`
- Modify: `apps/demo/src/simulation/ProceduralTerrain.ts`
- Verify: typecheck démo, suite complète, builds, vérification visuelle

**Interfaces:**
- Consumes: `MaterialLibrary` (Task 3) via le retour d'`installCardinalWorld` (Task 4).
- Produces : `PrehistoricEnvironment3D.createWorldScene(world, layout, materials?)`, `ProceduralVegetation.createOakTree(scale, materials?)`, `createCypressTree(scale, materials?)`, `createMossyBoulder(scale, materials?)`, `ProceduralTerrain.createTerrain(materials?)` — le paramètre est **optionnel** partout : sans bibliothèque, le comportement actuel (couleurs plates) est conservé, ce qui garde la migration réversible et testable pas à pas.

- [ ] **Step 1 : Faire accepter une bibliothèque au terrain**

Dans `apps/demo/src/simulation/ProceduralTerrain.ts`, modifier la signature et la création du matériau :

```ts
import type { MaterialLibrary } from '@iwsdk/cardinal-world';
```

```ts
  public static createTerrain(materials?: MaterialLibrary): TerrainData {
```

et remplacer le bloc `const mat = new MeshStandardMaterial({ ... })` par :

```ts
    // The library material carries grain and relief; vertex colours keep
    // carrying the biome hues on top of it.
    const mat = materials
      ? (() => {
          const shared = materials.get('grass').clone();
          shared.vertexColors = true;
          return shared;
        })()
      : new MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.85,
          metalness: 0.05,
          flatShading: false,
        });
```

**Attention :** `clone()` est délibéré ici — le terrain a besoin de `vertexColors: true`, ce que les autres usagers de `grass` ne veulent pas. Le clone partage les mêmes textures (pas de copie GPU), seul l'objet matériau est dupliqué. C'est la seule exception au partage strict.

- [ ] **Step 2 : Faire accepter une bibliothèque à la végétation**

Dans `apps/demo/src/simulation/ProceduralVegetation.ts`, ajouter l'import de type :

```ts
import type { MaterialLibrary } from '@iwsdk/cardinal-world';
```

Trois fonctions sont concernées, avec les noms de variables **exacts** relevés dans le fichier :

**`createCypressTree`** (ligne 22) — nouvelle signature `createCypressTree(scale: number = 1.0, materials?: MaterialLibrary)`. Remplacer `trunkMat` (ligne 26) et `foliageMat` (ligne 27) :

```ts
    const trunkMat = materials
      ? materials.get('bark')
      : new MeshStandardMaterial({ color: 0x3f2e21, roughness: 0.9 });
```

```ts
    const foliageMat = materials
      ? materials.get('foliage')
      : new MeshStandardMaterial({ /* conserver les paramètres existants */ });
```

**`createOakTree`** (ligne 56) — nouvelle signature `createOakTree(scale: number = 1.0, materials?: MaterialLibrary)`. Même traitement pour `trunkMat` (ligne 60, couleur `0x451a03`) et `foliageMat` (ligne 61).

**`createMossyBoulder`** (ligne 164) — nouvelle signature `createMossyBoulder(scale: number = 1.0, materials?: MaterialLibrary)`. Remplacer `rockMat` (ligne 168) par `materials ? materials.get('rock') : new MeshStandardMaterial({ /* paramètres existants */ })`. **Laisser `mossMat` (ligne 173) inchangé** : la mousse est un accent de couleur vive dont aucune matière du catalogue ne rend compte.

Les fonctions `createWildflowerPatch` et `createVineyardTerrace` restent inchangées : leurs matériaux (pétales, tiges, cultures) sont des accents colorés, pas des surfaces minérales ou organiques à texturer.

- [ ] **Step 3 : Faire circuler la bibliothèque dans la scène**

Dans `apps/demo/src/simulation/PrehistoricEnvironment3D.ts` :

```ts
import type { MaterialLibrary } from '@iwsdk/cardinal-world';
```

```ts
  public static createWorldScene(
    world: World,
    layout: typeof VILLAGE_LAYOUT,
    materials?: MaterialLibrary,
  ): PrehistoricSceneResult {
```

Passer `materials` aux appels : `ProceduralTerrain.createTerrain(materials)`, `ProceduralVegetation.createOakTree(0.9 + Math.random() * 0.25, materials)`, `ProceduralVegetation.createCypressTree(0.85 + Math.random() * 0.3, materials)`, `ProceduralVegetation.createMossyBoulder(0.8 + Math.random() * 0.4, materials)`.

Puis, dans les constructeurs d'objets de campement, remplacer les matériaux de peau et de roche :

- dans `createShelter`, le matériau `hideMat` : `materials ? materials.get('hide') : new MeshStandardMaterial({ color: bannerColor, roughness: 0.7 })` — ce qui impose d'ajouter `materials?: MaterialLibrary` en second paramètre de `createShelter(bannerColor, materials)` et de propager l'argument à son appel.
- dans `createFlintRock`, le matériau de roche : `materials ? materials.get('flint') : new MeshStandardMaterial({ color: 0x475569, roughness: 0.65, metalness: 0.25 })`, avec le même ajout de paramètre `createFlintRock(materials)` et propagation.

- [ ] **Step 4 : Câbler dans `index.ts`**

Dans `apps/demo/src/index.ts`, récupérer la bibliothèque et la transmettre :

```ts
    const { quality, materials } = installCardinalWorld(world, { latitudeDeg: 45 });
    console.log(`[demo] environment quality tier: ${quality}`);
```

```ts
      const sceneData = PrehistoricEnvironment3D.createWorldScene(world, VILLAGE_LAYOUT, materials);
```

- [ ] **Step 5 : Vérification complète**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck`, puis à la racine `pnpm typecheck && pnpm test && pnpm build && pnpm demo:build`.
Expected : tout vert, `check-single-three: OK` compris.

- [ ] **Step 6 : Vérification visuelle**

Lancer le serveur géré et capturer le runtime :

```bash
cd apps/demo && npx iwsdk dev up
npx iwsdk browser screenshot --output-file /tmp/materials-01.png
```

Ce qu'il faut constater, et qui distingue une réussite d'un échec silencieux :

1. **Les surfaces ont du grain** — la roche, le sable et l'écorce ne sont plus des aplats uniformes ; on distingue une texture à courte distance.
2. **Le relief réagit à la lumière** — en laissant le temps avancer, les creux et bosses des normales changent d'ombrage selon la position du soleil. C'est la preuve que les cartes de normales sont bien branchées et dans le bon espace colorimétrique.
3. **Aucune couture visible** sur les grandes surfaces répétées (terrain, falaises) — c'est ce que garantit le bruit périodique de la tâche 1.
4. **La scène ne paraît pas délavée** — si tout semble laiteux et peu contrasté, l'espace colorimétrique de l'albédo est probablement en linéaire au lieu de sRGB.

Vérifier aussi l'absence d'erreur console : `npx iwsdk browser logs --count 40`.

Arrêter ensuite le serveur : `npx iwsdk dev down`.

- [ ] **Step 7 : Commit**

```bash
git add -A apps/demo/src packages/world
git commit -m "refactor(demo): migrate environment surfaces to the procedural material library

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Couverture spec (auto-contrôle)

| Exigence spec (phase 2) | Tâche(s) |
| :--- | :--- |
| `MaterialLibrary` indexée par identifiant, génération à la première demande (§5) | 3 |
| Textures générées procéduralement : albédo, normale, rugosité, occlusion (§5) | 2 |
| Génération au démarrage plutôt qu'en shader (§5) | 2, 3 |
| Instances partagées, bibliothèque responsable du `dispose` (§5) | 3 (test dédié) |
| Résolutions par palier : 512 / 1024 (§5) | 3 (test dédié) |
| Espaces colorimétriques corrects — albédo sRGB, données linéaires (§5) | 3 (test dédié) |
| Tone mapping ACES et espace de sortie explicites (§5) | 4 |
| Exposition reliée au modèle de ciel (§5) | 4 (`ExposureSystem`) |
| Composant `ProceduralMaterial` authorable et interrogeable (§5) | 4 |
| Textures exactement tuilables (§5, contrainte de couture) | 1 (test dédié) |
| Surfaces de la démo réagissant correctement à la lumière (§11 phase 2) | 5 |

**Hors périmètre de cette phase**, conformément au phasage §11 : le mapping **triplanaire** sur les falaises et la **couche de détail rapprochée** du palier `high` (ils n'ont de sens qu'avec le terrain de la phase 3, qui produira les grandes surfaces en pente) ; le matériau d'eau (phase 4) ; la génération hors du thread principal (à instruire quand le nombre de matériaux ou leur résolution rendra le coût de démarrage mesurable — au catalogue actuel, huit matériaux en 512² restent sous le seuil perceptible).
