# Personnages procéduraux — étape 1 : le noyau pur

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire `@iwsdk/cardinal-character`, paquet sans aucune dépendance qui décrit une famille d'êtres vivants, tire et croise des génomes, et compile un génome plus un âge en une pose de repos, des influences de morphs et des tons de surface.

**Architecture:** Trois modules étanches. `family/` décrit ce qu'est une espèce — rôles d'os, chaînes, courbes de proportion, catalogue de gènes. `genome/` tire, croise, sérialise. `compile/` est une fonction pure qui prend une liaison de rig mesurée et rend une description de ce qu'il faudra écrire, sans jamais toucher un objet Three. Le paquet ne rend rien à l'écran et c'est voulu : `cardinal-simulation` a commencé exactement ainsi.

**Tech Stack:** TypeScript 5.9, tsup (ESM + `.d.ts`), vitest, Node ≥ 20.19. **Zéro dépendance runtime.**

**Spec:** `docs/superpowers/specs/2026-08-17-personnages-proceduraux-design.md`

## Global Constraints

- **Zéro dépendance runtime.** `package.json` ne déclare aucune `dependencies`. Un `import` depuis `three`, `@iwsdk/core` ou `@iwsdk/cardinal-simulation` est un échec de tâche.
- **Tout est pur et déterministe.** Aucun `Math.random()`, aucun `Date.now()`, aucun accès au système de fichiers dans `src/`. Toute stochasticité passe par un `RngLike` injecté.
- **Aucune échelle non uniforme sur un os.** Les longueurs passent par des translations. L'échelle uniforme sur un os est admise (c'est une similitude, elle ne cisaille pas) et sert la taille de tête et la taille globale.
- **Les gènes sont normalisés dans `[0,1]`.** Jamais de mètres dans un génome.
- **Commentaires en français**, comme `packages/simulation` et `packages/world`. Les descriptions de tests aussi.
- **`noUncheckedIndexedAccess` est actif** via `tsconfig.base.json` : tout accès indexé doit être gardé ou suffixé de `!` avec une raison.
- Node local mesuré : **22.12**. Ne pas écrire de script qui importe un `.ts` à l'exécution (le type-stripping natif n'existe qu'à partir de 22.18) — les scripts importent `dist/`.

## Résultat de sonde déjà acquis

La spec §13 posait la question « les clips écrasent-ils la morphologie ? ». **Elle est tranchée**, par inspection du conteneur glTF de quatre clips réels de `readyplayerme/animation-library` :

| Clip | Pistes de translation | Réellement variables |
| :--- | :--- | :--- |
| `M_Walk_001` | 1 | `Hips` seul, amplitude 3,21 m |
| `M_Standing_Idle_001` | 1 | `Hips` seul |
| `F_Talking_Variations_001` | 1 | `Hips` seul |
| `F_Dances_001` | 17 | `Hips` seul (21 cm) — **les 16 autres sont constantes à 10⁻⁶ m près** |

Conclusion : les pistes de translation sur les os non-racines réencodent les décalages du rig source et ne portent aucun mouvement. Elles écraseraient la morphologie, mais **peuvent être retirées sans perte**. La tâche 11 encode cette règle. Aucune interception après le mixer n'est nécessaire.

La seconde sonde de la spec §13 — quel chemin de montage UIKitML pour `@iwsdk/core@0.5.3` — ne bloque que l'étape 4 et est reportée au plan des panneaux.

---

## Structure des fichiers

```text
packages/character/
  package.json              nom, exports, scripts — aucune dependencies
  tsconfig.json             étend tsconfig.base.json
  tsup.config.ts            une entrée ESM, dts, platform neutral
  vitest.config.ts          globals, environnement node
  src/
    index.ts                surface publique du paquet
    family/
      types.ts              FamilyDescriptor, GeneDef, ChainDef, Curve
      proportions.ts        evalCurve — interpolation linéaire par morceaux
      humanoid.ts           le descripteur HUMANOID
      registry.ts           registerFamily, getFamily, validateDescriptor
    genome/
      types.ts              Genome, RngLike
      create.ts             createGenome, defaultGenome, centeredDraw
      breed.ts              breed
      serialize.ts          packGenome, unpackGenome
    compile/
      types.ts              RigBinding, CompiledCharacter, BoneRest
      compile.ts            compile
      memo.ts               compileMemoized, genomeKey
      clips.ts              shouldStripTranslationTrack — la règle de la sonde
    presets/
      types.ts              Preset, loadPreset
      metiers.ts            les huit archétypes
  test/
    proportions.test.ts     tâche 2
    registry.test.ts        tâche 3
    genome-create.test.ts   tâche 4
    breed.test.ts           tâche 5
    serialize.test.ts       tâche 6
    compile.test.ts         tâche 7
    invariants.test.ts      tâche 8
    memo.test.ts            tâche 9
    vectors.test.ts         tâche 10
    clips.test.ts           tâche 11
    presets.test.ts         tâche 12
scripts/
  generate-character-vectors.mjs   tâche 10 — importe dist/, jamais src/
fixtures/
  character_vectors.tsv            tâche 10 — généré, commité
```

---

### Task 1: Échafaudage du paquet

**Files:**
- Create: `packages/character/package.json`
- Create: `packages/character/tsconfig.json`
- Create: `packages/character/tsup.config.ts`
- Create: `packages/character/vitest.config.ts`
- Create: `packages/character/src/index.ts`
- Create: `packages/character/test/smoke.test.ts`
- Modify: `package.json` (racine) — chaînes `build`, `test`, `typecheck`

**Interfaces:**
- Consumes: rien
- Produces: le paquet `@iwsdk/cardinal-character` avec `ENGINE_NAME: string` exporté, et les commandes `pnpm --filter @iwsdk/cardinal-character {build,test,typecheck}`

- [ ] **Step 1: Installer les dépendances de l'espace de travail**

Le worktree n'a pas de `node_modules`. Sans cette étape, aucune commande suivante ne fonctionne.

```bash
pnpm install --frozen-lockfile
```

- [ ] **Step 2: Écrire `packages/character/package.json`**

```json
{
  "name": "@iwsdk/cardinal-character",
  "version": "0.1.0",
  "description": "Génome, hérédité et compilation morphologique des êtres vivants du stack Cardinal",
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

Il n'y a **pas** de bloc `dependencies`, et il ne doit jamais y en avoir.

- [ ] **Step 3: Écrire les trois fichiers de configuration**

`packages/character/tsconfig.json` :

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

`packages/character/tsup.config.ts` :

```ts
import { defineConfig } from 'tsup';

// Une seule entrée, ESM, sans dépendance externe à exclure : le paquet n'en a
// aucune. `platform: neutral` interdit toute résolution de module Node, ce qui
// fait échouer la construction si quelqu'un importe `node:fs` par accident.
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

`packages/character/vitest.config.ts` :

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

- [ ] **Step 4: Écrire le test de fumée**

`packages/character/test/smoke.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { ENGINE_NAME } from '../src/index';

describe('paquet', () => {
  it('expose son nom', () => {
    expect(ENGINE_NAME).toBe('@iwsdk/cardinal-character');
  });
});
```

- [ ] **Step 5: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/index"`.

- [ ] **Step 6: Écrire la surface publique minimale**

`packages/character/src/index.ts` :

```ts
export const ENGINE_NAME = '@iwsdk/cardinal-character';
```

- [ ] **Step 7: Lancer le test pour le voir passer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : 1 test passant.

- [ ] **Step 8: Brancher le paquet sur les chaînes de la racine**

Dans le `package.json` de la racine, insérer `@iwsdk/cardinal-character` **en tête** des trois chaînes, avant `@iwsdk/cardinal-simulation`, puisque rien ne dépend de lui mais que `cardinal-world` en dépendra à l'étape 2 :

- `build` : `pnpm --filter @iwsdk/cardinal-character build && pnpm --filter @iwsdk/cardinal-simulation build && …`
- `test` : après `node --test 'scripts/__tests__/**/*.test.mjs'`, ajouter `pnpm --filter @iwsdk/cardinal-character test && …`
- `typecheck` : `pnpm --filter @iwsdk/cardinal-character typecheck && …`

- [ ] **Step 9: Vérifier la construction et le typage**

```bash
pnpm --filter @iwsdk/cardinal-character build && pnpm --filter @iwsdk/cardinal-character typecheck
```

Attendu : `dist/index.js` et `dist/index.d.ts` produits, aucune erreur de typage.

- [ ] **Step 10: Commit**

```bash
git add packages/character package.json
git commit -m "feat(character): scaffold @iwsdk/cardinal-character, zero-dependency core"
```

---

### Task 2: Courbes de proportion

Le seul mécanisme qui rend un bébé crédible plutôt qu'un adulte réduit. Il vient en premier parce que le compilateur et le descripteur en dépendent tous les deux.

**Files:**
- Create: `packages/character/src/family/types.ts`
- Create: `packages/character/src/family/proportions.ts`
- Test: `packages/character/test/proportions.test.ts`

**Interfaces:**
- Consumes: rien
- Produces: `type Curve = ReadonlyArray<readonly [number, number]>` ; `evalCurve(curve: Curve, x: number): number`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/proportions.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { evalCurve } from '../src/family/proportions';

const HEAD_TO_BODY = [
  [0, 0.25],
  [3, 0.2],
  [12, 0.15],
  [18, 0.133],
] as const;

describe('evalCurve', () => {
  it('rend la valeur exacte à chaque nœud', () => {
    expect(evalCurve(HEAD_TO_BODY, 0)).toBeCloseTo(0.25, 10);
    expect(evalCurve(HEAD_TO_BODY, 3)).toBeCloseTo(0.2, 10);
    expect(evalCurve(HEAD_TO_BODY, 12)).toBeCloseTo(0.15, 10);
    expect(evalCurve(HEAD_TO_BODY, 18)).toBeCloseTo(0.133, 10);
  });

  it('interpole linéairement entre deux nœuds', () => {
    // Milieu de [0, 3] : (0.25 + 0.2) / 2
    expect(evalCurve(HEAD_TO_BODY, 1.5)).toBeCloseTo(0.225, 10);
  });

  it('borne aux deux extrémités au lieu d extrapoler', () => {
    // Un vieillard n a pas une tête qui rétrécit indéfiniment.
    expect(evalCurve(HEAD_TO_BODY, -5)).toBeCloseTo(0.25, 10);
    expect(evalCurve(HEAD_TO_BODY, 90)).toBeCloseTo(0.133, 10);
  });

  it('décroît de la naissance à l âge adulte', () => {
    let previous = Infinity;
    for (let age = 0; age <= 18; age += 0.5) {
      const value = evalCurve(HEAD_TO_BODY, age);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('rejette une courbe vide plutôt que de rendre NaN', () => {
    expect(() => evalCurve([], 5)).toThrow('courbe vide');
  });

  it('supporte une courbe à un seul nœud', () => {
    expect(evalCurve([[10, 0.7]], 0)).toBeCloseTo(0.7, 10);
    expect(evalCurve([[10, 0.7]], 99)).toBeCloseTo(0.7, 10);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/family/proportions"`.

- [ ] **Step 3: Écrire les types de famille**

`packages/character/src/family/types.ts` :

```ts
/** Courbe affine par morceaux, en paires (abscisse, ordonnée) triées. */
export type Curve = ReadonlyArray<readonly [number, number]>;

export type GeneGroup = 'structure' | 'face' | 'surface';

export interface GeneDef {
  /** Ce que coûte l'application du gène : `structure` recompile, les autres non. */
  group: GeneGroup;
  /** Part de la valeur qui vient des parents. 0 = tirage indépendant. */
  heritability: number;
  /** Biais du mélange : 0 tire vers la mère, 1 vers le père, 0.5 est neutre. */
  dominance: number;
  /** Amplitude maximale de la mutation, en unités de gène. */
  mutationRate: number;
  /** Gène atténué chez l'autre sexe. Absent = non lié au sexe. */
  sexLinked?: 'f' | 'm';
}

export interface ChainDef {
  /** Os de départ, exclu de la mise à l'échelle : il porte la chaîne. */
  from: string;
  /** Os terminal, inclus. */
  to: string;
  /** Gène qui pilote la longueur de cette chaîne. */
  gene: string;
  /** Couple (départ, terminal) du côté opposé, mis à l'échelle à l'identique. */
  mirror?: readonly [string, string];
}

export interface MorphDef {
  aliases: readonly string[];
  range: readonly [number, number];
}

export interface FamilyDescriptor {
  id: string;
  /** Rôle sémantique → alias acceptés, dans l'ordre de préférence. */
  bones: Readonly<Record<string, readonly string[]>>;
  chains: Readonly<Record<string, ChainDef>>;
  morphs: Readonly<Record<string, MorphDef>>;
  proportions: {
    /** Rapport tête/corps selon l'âge. */
    headToBody: Curve;
    /** Rapport membres/tronc selon l'âge. */
    limbToTorso: Curve;
    /** Taille globale selon l'âge, 1 à l'âge adulte. */
    bodyScale: Curve;
  };
  slots: Readonly<Record<string, string>>;
  genes: Readonly<Record<string, GeneDef>>;
  /** Âge auquel les courbes valent leur référence adulte. */
  adultAge: number;
}
```

- [ ] **Step 4: Écrire l'implémentation minimale**

`packages/character/src/family/proportions.ts` :

```ts
import type { Curve } from './types';

/**
 * Interpolation affine par morceaux, bornée aux deux bouts.
 *
 * Bornée et non extrapolée : une courbe de proportion décrit une plage d'âges
 * observée, et prolonger sa pente au-delà produirait des monstres — un
 * nourrisson à tête négative, un vieillard à tête de fourmi.
 */
export function evalCurve(curve: Curve, x: number): number {
  if (curve.length === 0) throw new Error('evalCurve: courbe vide');

  const first = curve[0]!;
  if (x <= first[0]) return first[1];

  const last = curve[curve.length - 1]!;
  if (x >= last[0]) return last[1];

  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (x <= b[0]) {
      const span = b[0] - a[0];
      if (span === 0) return b[1];
      return a[1] + (b[1] - a[1]) * ((x - a[0]) / span);
    }
  }

  return last[1];
}
```

- [ ] **Step 5: Lancer le test pour le voir passer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : 7 tests passants.

- [ ] **Step 6: Commit**

```bash
git add packages/character/src/family packages/character/test/proportions.test.ts
git commit -m "feat(character): piecewise proportion curves, clamped rather than extrapolated"
```

---

### Task 3: Descripteur humanoïde et registre validant

**Files:**
- Create: `packages/character/src/family/humanoid.ts`
- Create: `packages/character/src/family/registry.ts`
- Test: `packages/character/test/registry.test.ts`
- Modify: `packages/character/src/index.ts`

**Interfaces:**
- Consumes: `FamilyDescriptor`, `Curve` (tâche 2)
- Produces: `HUMANOID: FamilyDescriptor` ; `registerFamily(d: FamilyDescriptor): void` ; `getFamily(id: string): FamilyDescriptor` ; `validateDescriptor(d: FamilyDescriptor): string[]` (liste vide = valide)

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/registry.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { getFamily, registerFamily, validateDescriptor } from '../src/family/registry';
import type { FamilyDescriptor } from '../src/family/types';

describe('HUMANOID', () => {
  it('est un descripteur valide', () => {
    expect(validateDescriptor(HUMANOID)).toEqual([]);
  });

  it('déclare un gène pour chaque chaîne', () => {
    for (const chain of Object.values(HUMANOID.chains)) {
      expect(HUMANOID.genes[chain.gene]).toBeDefined();
    }
  });

  it('ne déclare que des rôles d os connus dans ses chaînes', () => {
    for (const chain of Object.values(HUMANOID.chains)) {
      expect(HUMANOID.bones[chain.from]).toBeDefined();
      expect(HUMANOID.bones[chain.to]).toBeDefined();
    }
  });

  it('reconnaît les conventions RPM et Mixamo pour la tête', () => {
    const alias = HUMANOID.bones['head']!;
    expect(alias).toContain('Head');
    expect(alias).toContain('mixamorig:Head');
  });
});

/** Descripteur volontairement cassé : rôle d os inconnu ET gène inexistant. */
const broken: FamilyDescriptor = {
  ...HUMANOID,
  id: 'cassé',
  chains: { bras: { from: 'inconnu', to: 'handL', gene: 'absent' } },
};

describe('validateDescriptor', () => {
  it('nomme précisément ce qui manque, sans dégrader en silence', () => {
    const problems = validateDescriptor(broken);
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toContain('inconnu');
    expect(problems.join(' ')).toContain('absent');
  });
});

describe('registre', () => {
  it('rend une famille enregistrée', () => {
    registerFamily(HUMANOID);
    expect(getFamily('humanoid')).toBe(HUMANOID);
  });

  it('refuse d enregistrer un descripteur invalide', () => {
    expect(() => registerFamily(broken)).toThrow('cassé');
  });

  it('lève sur une famille inconnue plutôt que de rendre undefined', () => {
    expect(() => getFamily('licorne')).toThrow('licorne');
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/family/humanoid"`.

- [ ] **Step 3: Écrire le descripteur humanoïde**

`packages/character/src/family/humanoid.ts` :

```ts
import type { FamilyDescriptor } from './types';

/**
 * Squelette humanoïde. Les alias couvrent les conventions rencontrées dans ce
 * dépôt : Ready Player Me, Mixamo, et la nomenclature de la spécification
 * d'origine. C'est la généralisation de la méthode d'AvatarMeshBinder, qui
 * fait déjà exactement cela pour les visèmes.
 */
export const HUMANOID: FamilyDescriptor = {
  id: 'humanoid',
  adultAge: 18,

  bones: {
    root: ['Hips', 'Root', 'mixamorig:Hips', 'Armature'],
    spine: ['Spine', 'Bone_Spine', 'mixamorig:Spine'],
    chest: ['Spine2', 'Chest', 'Bone_Chest', 'mixamorig:Spine2'],
    neck: ['Neck', 'mixamorig:Neck'],
    head: ['Head', 'mixamorig:Head', 'j_bip_c_head'],
    shoulderL: ['LeftShoulder', 'Bone_Clavicle_L', 'mixamorig:LeftShoulder'],
    upperArmL: ['LeftArm', 'Bone_Arm_L', 'mixamorig:LeftArm'],
    foreArmL: ['LeftForeArm', 'mixamorig:LeftForeArm'],
    handL: ['LeftHand', 'mixamorig:LeftHand'],
    shoulderR: ['RightShoulder', 'Bone_Clavicle_R', 'mixamorig:RightShoulder'],
    upperArmR: ['RightArm', 'Bone_Arm_R', 'mixamorig:RightArm'],
    foreArmR: ['RightForeArm', 'mixamorig:RightForeArm'],
    handR: ['RightHand', 'mixamorig:RightHand'],
    upLegL: ['LeftUpLeg', 'mixamorig:LeftUpLeg'],
    legL: ['LeftLeg', 'mixamorig:LeftLeg'],
    footL: ['LeftFoot', 'mixamorig:LeftFoot'],
    upLegR: ['RightUpLeg', 'mixamorig:RightUpLeg'],
    legR: ['RightLeg', 'mixamorig:RightLeg'],
    footR: ['RightFoot', 'mixamorig:RightFoot'],
  },

  chains: {
    arm: { from: 'shoulderL', to: 'handL', gene: 'armLength', mirror: ['shoulderR', 'handR'] },
    leg: { from: 'upLegL', to: 'footL', gene: 'legLength', mirror: ['upLegR', 'footR'] },
    torso: { from: 'root', to: 'neck', gene: 'torsoLength' },
  },

  morphs: {
    jawWidth: { aliases: ['jawWidth', 'Jaw_Width', 'jawForward'], range: [-1, 1] },
    noseSize: { aliases: ['noseSize', 'Nose_Size'], range: [-1, 1] },
    eyeScale: { aliases: ['eyeScale', 'eyesClosed', 'Eye_Scale'], range: [-1, 1] },
    cheekbone: { aliases: ['cheekbone', 'cheekPuff', 'Cheek_Bone'], range: [-1, 1] },
    bodyMass: { aliases: ['bodyMass', 'Corpulence', 'weight'], range: [0, 1] },
  },

  // Un nourrisson mesure environ 50 cm pour 1,75 m adulte, et sa tête occupe
  // le quart de sa hauteur contre un septième et demi chez l'adulte. Aucune
  // combinaison d'échelles d'os ne produit cela : c'est pourquoi l'âge est un
  // paramètre d'évaluation et non un gène.
  proportions: {
    headToBody: [
      [0, 0.25],
      [3, 0.2],
      [12, 0.15],
      [18, 0.133],
    ],
    limbToTorso: [
      [0, 0.62],
      [12, 0.88],
      [18, 1.0],
    ],
    bodyScale: [
      [0, 0.28],
      [3, 0.52],
      [12, 0.8],
      [18, 1.0],
      [70, 0.98],
    ],
  },

  slots: { rightHand: 'handR', leftHand: 'handL', back: 'chest', head: 'head' },

  genes: {
    stature: { group: 'structure', heritability: 0.9, dominance: 0.5, mutationRate: 0.04 },
    armLength: { group: 'structure', heritability: 0.85, dominance: 0.5, mutationRate: 0.04 },
    legLength: { group: 'structure', heritability: 0.85, dominance: 0.5, mutationRate: 0.04 },
    torsoLength: { group: 'structure', heritability: 0.85, dominance: 0.5, mutationRate: 0.04 },
    shoulderWidth: {
      group: 'structure',
      heritability: 0.8,
      dominance: 0.6,
      mutationRate: 0.05,
      sexLinked: 'm',
    },
    jawWidth: { group: 'face', heritability: 0.7, dominance: 0.5, mutationRate: 0.06, sexLinked: 'm' },
    noseSize: { group: 'face', heritability: 0.75, dominance: 0.5, mutationRate: 0.06 },
    eyeScale: { group: 'face', heritability: 0.7, dominance: 0.5, mutationRate: 0.06 },
    cheekbone: { group: 'face', heritability: 0.7, dominance: 0.5, mutationRate: 0.06 },
    bodyMass: { group: 'face', heritability: 0.5, dominance: 0.5, mutationRate: 0.1 },
    skinTone: { group: 'surface', heritability: 0.95, dominance: 0.5, mutationRate: 0.02 },
    hairTone: { group: 'surface', heritability: 0.9, dominance: 0.4, mutationRate: 0.03 },
    hairStyle: { group: 'surface', heritability: 0.2, dominance: 0.5, mutationRate: 0.3 },
  },
};
```

- [ ] **Step 4: Écrire le registre validant**

`packages/character/src/family/registry.ts` :

```ts
import type { FamilyDescriptor } from './types';

const families = new Map<string, FamilyDescriptor>();

/**
 * Rend la liste des problèmes. Vide = valide.
 *
 * Une liste plutôt qu'un booléen : un asset rejeté doit dire précisément ce
 * qui manque. Un échec silencieux qui laisse la vérification verte coûte plus
 * cher qu'un rejet bruyant — c'est la leçon de RoomChannel compilé
 * conditionnellement.
 */
export function validateDescriptor(descriptor: FamilyDescriptor): string[] {
  const problems: string[] = [];

  for (const [name, chain] of Object.entries(descriptor.chains)) {
    for (const role of [chain.from, chain.to]) {
      if (descriptor.bones[role] === undefined) {
        problems.push(`chaîne "${name}" : rôle d'os "${role}" non déclaré`);
      }
    }
    if (descriptor.genes[chain.gene] === undefined) {
      problems.push(`chaîne "${name}" : gène "${chain.gene}" non déclaré`);
    }
    if (chain.mirror !== undefined) {
      for (const role of chain.mirror) {
        if (descriptor.bones[role] === undefined) {
          problems.push(`chaîne "${name}" : rôle miroir "${role}" non déclaré`);
        }
      }
    }
  }

  for (const [key, gene] of Object.entries(descriptor.genes)) {
    for (const [field, value] of [
      ['heritability', gene.heritability],
      ['dominance', gene.dominance],
      ['mutationRate', gene.mutationRate],
    ] as const) {
      if (!(value >= 0 && value <= 1)) {
        problems.push(`gène "${key}" : ${field} hors de [0,1] (${value})`);
      }
    }
  }

  return problems;
}

export function registerFamily(descriptor: FamilyDescriptor): void {
  const problems = validateDescriptor(descriptor);
  if (problems.length > 0) {
    throw new Error(
      `registerFamily: descripteur "${descriptor.id}" invalide —\n  ${problems.join('\n  ')}`,
    );
  }
  families.set(descriptor.id, descriptor);
}

export function getFamily(id: string): FamilyDescriptor {
  const found = families.get(id);
  if (found === undefined) {
    throw new Error(`getFamily: famille "${id}" inconnue — appelez registerFamily d'abord`);
  }
  return found;
}
```

Ce module **n'importe aucune famille et n'en enregistre aucune**. Un
auto-enregistrement créerait un cycle d'imports entre `registry` et `humanoid`,
et surtout obligerait à modifier le registre chaque fois qu'on ajoute une espèce.
L'enregistrement se fait depuis `src/index.ts`, à l'étape suivante.

- [ ] **Step 5: Exporter et enregistrer depuis la surface publique**

`packages/character/src/index.ts` :

```ts
export const ENGINE_NAME = '@iwsdk/cardinal-character';

export type {
  Curve,
  GeneDef,
  GeneGroup,
  ChainDef,
  MorphDef,
  FamilyDescriptor,
} from './family/types';
export { evalCurve } from './family/proportions';
export { HUMANOID } from './family/humanoid';
export { registerFamily, getFamily, validateDescriptor } from './family/registry';

import { HUMANOID } from './family/humanoid';
import { registerFamily } from './family/registry';

// Les familles fournies par le paquet s'enregistrent ici, et non dans leur
// propre module : `registry` ne doit connaître aucune famille, sinon ajouter
// une espèce voudrait dire modifier le registre.
registerFamily(HUMANOID);
```

- [ ] **Step 6: Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : tous passants. Si `registry.test.ts` échoue sur `getFamily('humanoid')`, c'est que l'import de `../src/index` manque dans le test — l'ajouter en tête.

- [ ] **Step 7: Commit**

```bash
git add packages/character/src packages/character/test/registry.test.ts
git commit -m "feat(character): humanoid descriptor and a registry that rejects loudly"
```

---

### Task 4: Tirage d'un génome

**Files:**
- Create: `packages/character/src/genome/types.ts`
- Create: `packages/character/src/genome/create.ts`
- Test: `packages/character/test/genome-create.test.ts`
- Modify: `packages/character/src/index.ts`

**Interfaces:**
- Consumes: `FamilyDescriptor` (tâche 3)
- Produces: `interface RngLike { next(): number }` ; `interface Genome { family: string; genes: Record<string, number> }` ; `createGenome(family: FamilyDescriptor, rng: RngLike): Genome` ; `defaultGenome(family: FamilyDescriptor): Genome` ; `centeredDraw(rng: RngLike): number`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/genome-create.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { createGenome, defaultGenome, centeredDraw } from '../src/genome/create';
import type { RngLike } from '../src/genome/types';

/** Rng de test : suite fournie, rebouclée. Aucune dépendance au moteur. */
function fakeRng(values: number[]): RngLike {
  let i = 0;
  return { next: () => values[i++ % values.length]! };
}

describe('defaultGenome', () => {
  it('met chaque gène de la famille à 0.5', () => {
    const g = defaultGenome(HUMANOID);
    expect(Object.keys(g.genes).sort()).toEqual(Object.keys(HUMANOID.genes).sort());
    for (const value of Object.values(g.genes)) expect(value).toBe(0.5);
  });

  it('porte l identifiant de sa famille', () => {
    expect(defaultGenome(HUMANOID).family).toBe('humanoid');
  });
});

describe('centeredDraw', () => {
  it('rend 0.5 au centre et reste borné aux extrêmes', () => {
    expect(centeredDraw(fakeRng([0.5, 0.5]))).toBeCloseTo(0.5, 10);
    expect(centeredDraw(fakeRng([0, 0]))).toBe(0);
    expect(centeredDraw(fakeRng([0.999999, 0.999999]))).toBeLessThan(1);
  });

  it('concentre la population autour du centre', () => {
    // Un tirage uniforme peuplerait le village de géants et de nains.
    const rng = makeCountingRng(20250817);
    let extremes = 0;
    for (let i = 0; i < 10000; i++) {
      const v = centeredDraw(rng);
      if (v < 0.15 || v > 0.85) extremes++;
    }
    // Bates n=2 : P(|X-0.5| > 0.35) = 2 * 0.15^2 = 4.5 %.
    expect(extremes / 10000).toBeLessThan(0.07);
  });
});

describe('createGenome', () => {
  it('produit un gène par gène déclaré, tous dans [0,1]', () => {
    const g = createGenome(HUMANOID, makeCountingRng(7));
    expect(Object.keys(g.genes).sort()).toEqual(Object.keys(HUMANOID.genes).sort());
    for (const value of Object.values(g.genes)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('est déterministe : même graine, même génome', () => {
    const a = createGenome(HUMANOID, makeCountingRng(42));
    const b = createGenome(HUMANOID, makeCountingRng(42));
    expect(a).toEqual(b);
  });

  it('diffère d une graine à l autre', () => {
    const a = createGenome(HUMANOID, makeCountingRng(1));
    const b = createGenome(HUMANOID, makeCountingRng(2));
    expect(a).not.toEqual(b);
  });
});

/** Générateur déterministe local — le paquet n en fournit pas, par conception. */
function makeCountingRng(seed: number): RngLike {
  let h = seed >>> 0;
  return {
    next() {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
    },
  };
}
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/genome/create"`.

- [ ] **Step 3: Écrire les types du génome**

`packages/character/src/genome/types.ts` :

```ts
/**
 * Contrat minimal de générateur aléatoire.
 *
 * Structurel et non importé : le paquet n'a aucune dépendance, et le `Rng`
 * xorshift128 de `@iwsdk/cardinal-simulation` le satisfait sans rien changer.
 * C'est ce qui permet à l'hérédité d'être rejouable depuis la graine du monde.
 */
export interface RngLike {
  /** Flottant uniforme dans [0, 1). */
  next(): number;
}

export interface Genome {
  readonly family: string;
  readonly genes: Readonly<Record<string, number>>;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
```

- [ ] **Step 4: Écrire le tirage**

`packages/character/src/genome/create.ts` :

```ts
import type { FamilyDescriptor } from '../family/types';
import { clamp01, type Genome, type RngLike } from './types';

/**
 * Tirage centré (Bates n=2) : moyenne 0.5, extrêmes rares.
 *
 * Un tirage uniforme donnerait autant de géants que de gens ordinaires, ce qui
 * ne ressemble à aucune population réelle. Deux uniformes moyennés suffisent à
 * produire une cloche crédible sans coûter un calcul de gaussienne.
 */
export function centeredDraw(rng: RngLike): number {
  return (rng.next() + rng.next()) / 2;
}

/** Le centre de la famille : tous les gènes à 0.5. Sert de référence et de test. */
export function defaultGenome(family: FamilyDescriptor): Genome {
  const genes: Record<string, number> = {};
  for (const key of Object.keys(family.genes)) genes[key] = 0.5;
  return { family: family.id, genes };
}

export function createGenome(family: FamilyDescriptor, rng: RngLike): Genome {
  const genes: Record<string, number> = {};
  // Ordre trié : le tirage doit être reproductible quel que soit l'ordre
  // d'insertion des clés dans le descripteur.
  for (const key of Object.keys(family.genes).sort()) {
    genes[key] = clamp01(centeredDraw(rng));
  }
  return { family: family.id, genes };
}
```

- [ ] **Step 5: Exporter depuis la surface publique**

Ajouter à `packages/character/src/index.ts` :

```ts
export type { Genome, RngLike } from './genome/types';
export { clamp01 } from './genome/types';
export { createGenome, defaultGenome, centeredDraw } from './genome/create';
```

- [ ] **Step 6: Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : tous passants.

- [ ] **Step 7: Commit**

```bash
git add packages/character/src/genome packages/character/src/index.ts packages/character/test/genome-create.test.ts
git commit -m "feat(character): centred genome draw over an injected rng contract"
```

---

### Task 5: Hérédité

Le cœur de la ressemblance familiale. Une fonction pure, déterministe depuis la graine du monde.

**Files:**
- Create: `packages/character/src/genome/breed.ts`
- Test: `packages/character/test/breed.test.ts`
- Modify: `packages/character/src/index.ts`

**Interfaces:**
- Consumes: `Genome`, `RngLike`, `centeredDraw`, `clamp01`, `FamilyDescriptor`
- Produces: `breed(family: FamilyDescriptor, mother: Genome, father: Genome, rng: RngLike, sex: 'f' | 'm'): Genome`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/breed.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { breed } from '../src/genome/breed';
import { createGenome } from '../src/genome/create';
import type { FamilyDescriptor } from '../src/family/types';
import type { Genome, RngLike } from '../src/genome/types';
// Rng local : le paquet n'en fournit aucun, par conception — c'est le moteur
// de simulation qui injecte le sien.

function makeCountingRng(seed: number): RngLike {
  let h = seed >>> 0;
  return {
    next() {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
    },
  };
}

/** Famille jouet : un seul gène, entièrement héritable, sans mutation. */
const PUR: FamilyDescriptor = {
  ...HUMANOID,
  id: 'pur',
  chains: {},
  genes: { taille: { group: 'structure', heritability: 1, dominance: 0.5, mutationRate: 0 } },
};

const g = (family: string, genes: Record<string, number>): Genome => ({ family, genes });

describe('breed', () => {
  it('est déterministe : mêmes parents, même graine, même enfant', () => {
    const mère = createGenome(HUMANOID, makeCountingRng(1));
    const père = createGenome(HUMANOID, makeCountingRng(2));
    const a = breed(HUMANOID, mère, père, makeCountingRng(99), 'f');
    const b = breed(HUMANOID, mère, père, makeCountingRng(99), 'f');
    expect(a).toEqual(b);
  });

  it('sans mutation ni dérive, l enfant reste ENTRE ses parents', () => {
    for (let seed = 0; seed < 200; seed++) {
      const enfant = breed(PUR, g('pur', { taille: 0.2 }), g('pur', { taille: 0.8 }),
        makeCountingRng(seed), 'f');
      expect(enfant.genes['taille']!).toBeGreaterThanOrEqual(0.2);
      expect(enfant.genes['taille']!).toBeLessThanOrEqual(0.8);
    }
  });

  it('deux parents identiques donnent un enfant identique', () => {
    const enfant = breed(PUR, g('pur', { taille: 0.37 }), g('pur', { taille: 0.37 }),
      makeCountingRng(5), 'm');
    expect(enfant.genes['taille']!).toBeCloseTo(0.37, 10);
  });

  it('une héritabilité nulle décorrèle l enfant de ses parents', () => {
    const libre: FamilyDescriptor = {
      ...PUR,
      genes: { taille: { group: 'structure', heritability: 0, dominance: 0.5, mutationRate: 0 } },
    };
    const rng = makeCountingRng(11);
    let différents = 0;
    for (let i = 0; i < 500; i++) {
      const enfant = breed(libre, g('pur', { taille: 1 }), g('pur', { taille: 1 }), rng, 'f');
      if (Math.abs(enfant.genes['taille']! - 1) > 0.1) différents++;
    }
    expect(différents).toBeGreaterThan(400);
  });

  it('reste toujours dans [0,1], même avec des parents extrêmes et de la mutation', () => {
    const volatil: FamilyDescriptor = {
      ...PUR,
      genes: { taille: { group: 'structure', heritability: 1, dominance: 0.5, mutationRate: 1 } },
    };
    const rng = makeCountingRng(3);
    for (let i = 0; i < 2000; i++) {
      const v = breed(volatil, g('pur', { taille: 1 }), g('pur', { taille: 0 }), rng, 'm')
        .genes['taille']!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('sur mille enfants, la moyenne converge vers la moyenne parentale', () => {
    const rng = makeCountingRng(2026);
    let somme = 0;
    for (let i = 0; i < 1000; i++) {
      somme += breed(PUR, g('pur', { taille: 0.3 }), g('pur', { taille: 0.7 }), rng, 'f')
        .genes['taille']!;
    }
    expect(somme / 1000).toBeCloseTo(0.5, 1);
  });

  it('atténue un gène lié au sexe chez l autre sexe', () => {
    const lié: FamilyDescriptor = {
      ...PUR,
      genes: {
        taille: { group: 'structure', heritability: 1, dominance: 0.5, mutationRate: 0, sexLinked: 'm' },
      },
    };
    const parents = [g('pur', { taille: 1 }), g('pur', { taille: 1 })] as const;
    const garçon = breed(lié, parents[0], parents[1], makeCountingRng(8), 'm').genes['taille']!;
    const fille = breed(lié, parents[0], parents[1], makeCountingRng(8), 'f').genes['taille']!;
    expect(garçon).toBeCloseTo(1, 10);
    expect(fille).toBeLessThan(garçon);
    expect(fille).toBeGreaterThan(0.5);
  });

  it('refuse de croiser deux familles différentes', () => {
    expect(() => breed(HUMANOID, g('humanoid', {}), g('canid', {}), makeCountingRng(1), 'f'))
      .toThrow('familles différentes');
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/genome/breed"`.

- [ ] **Step 3: Écrire l'hérédité**

`packages/character/src/genome/breed.ts` :

```ts
import type { FamilyDescriptor } from '../family/types';
import { centeredDraw } from './create';
import { clamp01, type Genome, type RngLike } from './types';

/**
 * Croise deux génomes. Fonction pure : mêmes parents, même graine, même enfant,
 * à jamais. C'est ce qui permet à une naissance d'entrer dans le journal
 * rejouable de SimKernel sans stocker le résultat.
 *
 * Quatre étapes par gène, dans cet ordre :
 *   1. mélange des allèles parentaux, biaisé par `dominance` ;
 *   2. part non héritée, tirée indépendamment selon `heritability` ;
 *   3. mutation bornée par `mutationRate` ;
 *   4. atténuation d'un gène lié au sexe chez l'autre sexe.
 */
export function breed(
  family: FamilyDescriptor,
  mother: Genome,
  father: Genome,
  rng: RngLike,
  sex: 'f' | 'm',
): Genome {
  if (mother.family !== father.family) {
    throw new Error(
      `breed: familles différentes — "${mother.family}" et "${father.family}"`,
    );
  }

  const genes: Record<string, number> = {};

  // Ordre trié : le résultat ne doit pas dépendre de l'ordre des clés.
  for (const key of Object.keys(family.genes).sort()) {
    const def = family.genes[key]!;
    const m = mother.genes[key] ?? 0.5;
    const f = father.genes[key] ?? 0.5;

    // 1. Mélange. `dominance` déplace l'espérance du tirage vers un parent
    //    sans jamais sortir de l'intervalle qu'ils délimitent.
    const t = clamp01(rng.next() + (def.dominance - 0.5));
    const blended = m + (f - m) * t;

    // 2. Part non héritée.
    const independent = centeredDraw(rng);
    let value = independent + (blended - independent) * def.heritability;

    // 3. Mutation symétrique et bornée.
    if (def.mutationRate > 0) {
      value += (rng.next() * 2 - 1) * def.mutationRate;
    }

    // 4. Gène lié au sexe : ramené à mi-chemin du centre chez l'autre sexe.
    if (def.sexLinked !== undefined && def.sexLinked !== sex) {
      value = 0.5 + (value - 0.5) * 0.5;
    }

    genes[key] = clamp01(value);
  }

  return { family: mother.family, genes };
}
```

- [ ] **Step 4: Exporter**

Ajouter à `packages/character/src/index.ts` :

```ts
export { breed } from './genome/breed';
```

- [ ] **Step 5: Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : tous passants. Si « l enfant reste ENTRE ses parents » échoue, vérifier que `t` est bien borné par `clamp01` — un `dominance` de 0.6 ferait autrement sortir `t` de `[0,1]` et donc extrapoler au-delà des parents.

- [ ] **Step 6: Commit**

```bash
git add packages/character/src/genome/breed.ts packages/character/src/index.ts packages/character/test/breed.test.ts
git commit -m "feat(character): deterministic heredity with dominance, drift and sex linkage"
```

---

### Task 6: Sérialisation compacte

Trente gènes en trente octets, pour que le génome tienne sur le fil binaire existant sans travail de protocole.

**Files:**
- Create: `packages/character/src/genome/serialize.ts`
- Test: `packages/character/test/serialize.test.ts`
- Modify: `packages/character/src/index.ts`

**Interfaces:**
- Consumes: `Genome`, `FamilyDescriptor`
- Produces: `GENOME_FORMAT_VERSION: number` ; `packGenome(family: FamilyDescriptor, genome: Genome): Uint8Array` ; `unpackGenome(family: FamilyDescriptor, bytes: Uint8Array): Genome`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/serialize.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { defaultGenome } from '../src/genome/create';
import { GENOME_FORMAT_VERSION, packGenome, unpackGenome } from '../src/genome/serialize';

describe('packGenome', () => {
  it('produit deux octets d en-tête plus un octet par gène', () => {
    const bytes = packGenome(HUMANOID, defaultGenome(HUMANOID));
    expect(bytes.length).toBe(2 + Object.keys(HUMANOID.genes).length);
  });

  it('place la version puis le nombre de gènes en tête', () => {
    const bytes = packGenome(HUMANOID, defaultGenome(HUMANOID));
    expect(bytes[0]).toBe(GENOME_FORMAT_VERSION);
    expect(bytes[1]).toBe(Object.keys(HUMANOID.genes).length);
  });

  it('tient sous cinquante octets pour un humain', () => {
    // Le budget annoncé : trente octets contre cent vingt en float32.
    expect(packGenome(HUMANOID, defaultGenome(HUMANOID)).length).toBeLessThan(50);
  });
});

describe('aller-retour', () => {
  it('restitue chaque gène à moins d un pas de quantification', () => {
    const original = {
      family: 'humanoid',
      genes: Object.fromEntries(
        Object.keys(HUMANOID.genes).map((k, i) => [k, (i * 7919) % 1000 / 1000]),
      ),
    };
    const restored = unpackGenome(HUMANOID, packGenome(HUMANOID, original));
    for (const key of Object.keys(HUMANOID.genes)) {
      expect(restored.genes[key]!).toBeCloseTo(original.genes[key]!, 2);
      expect(Math.abs(restored.genes[key]! - original.genes[key]!)).toBeLessThanOrEqual(1 / 255);
    }
  });

  it('restitue exactement les bornes', () => {
    const extrêmes = {
      family: 'humanoid',
      genes: Object.fromEntries(Object.keys(HUMANOID.genes).map((k, i) => [k, i % 2])),
    };
    const restored = unpackGenome(HUMANOID, packGenome(HUMANOID, extrêmes));
    for (const [key, value] of Object.entries(extrêmes.genes)) {
      expect(restored.genes[key]!).toBe(value);
    }
  });

  it('est stable quel que soit l ordre d insertion des clés', () => {
    const clés = Object.keys(HUMANOID.genes);
    const avant = { family: 'humanoid', genes: Object.fromEntries(clés.map((k) => [k, 0.25])) };
    const après = {
      family: 'humanoid',
      genes: Object.fromEntries([...clés].reverse().map((k) => [k, 0.25])),
    };
    expect(packGenome(HUMANOID, avant)).toEqual(packGenome(HUMANOID, après));
  });
});

describe('rejets', () => {
  it('refuse une version inconnue', () => {
    const bytes = packGenome(HUMANOID, defaultGenome(HUMANOID));
    bytes[0] = 99;
    expect(() => unpackGenome(HUMANOID, bytes)).toThrow('version');
  });

  it('refuse un nombre de gènes qui ne correspond pas à la famille', () => {
    const bytes = packGenome(HUMANOID, defaultGenome(HUMANOID));
    bytes[1] = 3;
    expect(() => unpackGenome(HUMANOID, bytes)).toThrow('gènes');
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/genome/serialize"`.

- [ ] **Step 3: Écrire la sérialisation**

`packages/character/src/genome/serialize.ts` :

```ts
import type { FamilyDescriptor } from '../family/types';
import type { Genome } from './types';

export const GENOME_FORMAT_VERSION = 1;

/**
 * Un gène tient sur un octet.
 *
 * 256 pas sur [0,1] placent l'erreur maximale à 0.2 % d'un gène, très en deçà
 * du seuil de perception sur une largeur d'épaules. Trente gènes tiennent donc
 * en trente octets contre cent vingt en float32 — la même arithmétique que les
 * trames de 33 octets et la compression de quaternion sur 32 bits.
 *
 * L'ordre est celui des clés triées du descripteur, jamais celui de l'objet :
 * deux génomes égaux doivent produire des octets égaux.
 */
export function packGenome(family: FamilyDescriptor, genome: Genome): Uint8Array {
  const keys = Object.keys(family.genes).sort();
  const bytes = new Uint8Array(2 + keys.length);
  bytes[0] = GENOME_FORMAT_VERSION;
  bytes[1] = keys.length;
  for (let i = 0; i < keys.length; i++) {
    const value = genome.genes[keys[i]!] ?? 0.5;
    bytes[2 + i] = Math.round((value < 0 ? 0 : value > 1 ? 1 : value) * 255);
  }
  return bytes;
}

export function unpackGenome(family: FamilyDescriptor, bytes: Uint8Array): Genome {
  if (bytes[0] !== GENOME_FORMAT_VERSION) {
    throw new Error(
      `unpackGenome: version ${bytes[0]} inconnue, attendu ${GENOME_FORMAT_VERSION}`,
    );
  }
  const keys = Object.keys(family.genes).sort();
  if (bytes[1] !== keys.length) {
    throw new Error(
      `unpackGenome: ${bytes[1]} gènes encodés, la famille "${family.id}" en déclare ${keys.length}`,
    );
  }
  const genes: Record<string, number> = {};
  for (let i = 0; i < keys.length; i++) {
    genes[keys[i]!] = bytes[2 + i]! / 255;
  }
  return { family: family.id, genes };
}
```

- [ ] **Step 4: Exporter**

Ajouter à `packages/character/src/index.ts` :

```ts
export { GENOME_FORMAT_VERSION, packGenome, unpackGenome } from './genome/serialize';
```

- [ ] **Step 5: Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : tous passants.

- [ ] **Step 6: Commit**

```bash
git add packages/character/src/genome/serialize.ts packages/character/src/index.ts packages/character/test/serialize.test.ts
git commit -m "feat(character): one byte per gene, stable ordering, loud on layout drift"
```

---

### Task 7: Le compilateur

**Files:**
- Create: `packages/character/src/compile/types.ts`
- Create: `packages/character/src/compile/compile.ts`
- Test: `packages/character/test/compile.test.ts`
- Modify: `packages/character/src/index.ts`

**Interfaces:**
- Consumes: `FamilyDescriptor`, `Genome`, `evalCurve`
- Produces:
  - `type Vec3 = readonly [number, number, number]`
  - `interface BoneRest { role: string; position: Vec3; parentRole: string | null }`
  - `interface RigBinding { family: string; bones: Record<string, BoneRest>; morphIndex: Record<string, number>; restHeightMeters: number }`
  - `interface CompiledBone { role: string; position: Vec3; scale: number }`
  - `interface CompiledCharacter { family: string; restPose: CompiledBone[]; rebindSkeleton: boolean; morphs: Record<string, number>; surface: { skinTone: number; hairTone: number; hairStyle: number }; stats: { heightMeters: number } }`
  - `compile(family: FamilyDescriptor, genome: Genome, age: number, binding: RigBinding): CompiledCharacter`

**Deux précisions par rapport à la spec §7.1**, décidées ici et à reporter dans la spec :

1. `CompiledBone` porte un `scale` **uniforme**. La spec interdisait toute échelle ; l'interdiction ne vaut en réalité que pour l'échelle **non uniforme**, seule à cisailler. Une échelle uniforme est une similitude, et c'est le seul moyen d'obtenir la tête d'un nourrisson sans clé de forme dédiée que les rigs RPM ne fournissent pas.
2. `surface` porte des scalaires normalisés et non des RGBA. La conversion en couleur appartient à `MaterialLibrary` de `cardinal-world` ; un paquet sans dépendance n'a pas à embarquer une rampe colorimétrique.

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/compile.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { defaultGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import type { RigBinding } from '../src/compile/types';

/**
 * Liaison de test : un humanoïde d un mètre soixante-quinze, bras et jambes
 * alignés sur des axes simples pour que les longueurs soient lisibles.
 */
function binding(): RigBinding {
  const os = (role: string, parentRole: string | null, p: readonly [number, number, number]) =>
    [role, { role, parentRole, position: p }] as const;
  return {
    family: 'humanoid',
    restHeightMeters: 1.75,
    morphIndex: { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 },
    bones: Object.fromEntries([
      os('root', null, [0, 0.95, 0]),
      os('spine', 'root', [0, 0.12, 0]),
      os('chest', 'spine', [0, 0.14, 0]),
      os('neck', 'chest', [0, 0.16, 0]),
      os('head', 'neck', [0, 0.09, 0]),
      os('shoulderL', 'chest', [0.05, 0.05, 0]),
      os('upperArmL', 'shoulderL', [0.13, 0, 0]),
      os('foreArmL', 'upperArmL', [0.27, 0, 0]),
      os('handL', 'foreArmL', [0.25, 0, 0]),
      os('shoulderR', 'chest', [-0.05, 0.05, 0]),
      os('upperArmR', 'shoulderR', [-0.13, 0, 0]),
      os('foreArmR', 'upperArmR', [-0.27, 0, 0]),
      os('handR', 'foreArmR', [-0.25, 0, 0]),
      os('upLegL', 'root', [0.09, -0.05, 0]),
      os('legL', 'upLegL', [0, -0.44, 0]),
      os('footL', 'legL', [0, -0.42, 0]),
      os('upLegR', 'root', [-0.09, -0.05, 0]),
      os('legR', 'upLegR', [0, -0.44, 0]),
      os('footR', 'legR', [0, -0.42, 0]),
    ]),
  };
}

const norme = (v: readonly [number, number, number]) => Math.hypot(v[0], v[1], v[2]);
const trouve = (c: ReturnType<typeof compile>, role: string) =>
  c.restPose.find((b) => b.role === role)!;

describe('compile — génome neutre', () => {
  it('laisse un adulte médian identique à son rig de repos', () => {
    const c = compile(HUMANOID, defaultGenome(HUMANOID), 18, binding());
    for (const bone of c.restPose) {
      const original = binding().bones[bone.role]!;
      expect(norme(bone.position)).toBeCloseTo(norme(original.position), 6);
      expect(bone.scale).toBeCloseTo(1, 6);
    }
  });

  it('rend la hauteur du rig de repos', () => {
    const c = compile(HUMANOID, defaultGenome(HUMANOID), 18, binding());
    expect(c.stats.heightMeters).toBeCloseTo(1.75, 3);
  });

  it('demande toujours un recalcul des matrices inverses', () => {
    expect(compile(HUMANOID, defaultGenome(HUMANOID), 18, binding()).rebindSkeleton).toBe(true);
  });
});

describe('compile — invariants géométriques', () => {
  it('n émet JAMAIS d échelle non uniforme : le scale est un scalaire', () => {
    const c = compile(HUMANOID, defaultGenome(HUMANOID), 6, binding());
    for (const bone of c.restPose) {
      expect(typeof bone.scale).toBe('number');
      expect(Number.isFinite(bone.scale)).toBe(true);
      expect(bone.scale).toBeGreaterThan(0);
    }
  });

  it('conserve la direction de chaque os et n en change que la longueur', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, armLength: 1 } };
    const c = compile(HUMANOID, g, 18, binding());
    const avant = binding().bones['foreArmL']!.position;
    const après = trouve(c, 'foreArmL').position;
    // Colinéaires et de même sens : produit vectoriel nul, produit scalaire positif.
    const croix = Math.hypot(
      avant[1] * après[2] - avant[2] * après[1],
      avant[2] * après[0] - avant[0] * après[2],
      avant[0] * après[1] - avant[1] * après[0],
    );
    expect(croix).toBeCloseTo(0, 9);
    expect(avant[0] * après[0] + avant[1] * après[1] + avant[2] * après[2]).toBeGreaterThan(0);
  });
});

describe('compile — les gènes agissent', () => {
  it('un gène de bras à 1 allonge le bras, à 0 le raccourcit', () => {
    const base = defaultGenome(HUMANOID).genes;
    const court = compile(HUMANOID, { family: 'humanoid', genes: { ...base, armLength: 0 } }, 18, binding());
    const long = compile(HUMANOID, { family: 'humanoid', genes: { ...base, armLength: 1 } }, 18, binding());
    expect(norme(trouve(long, 'foreArmL').position))
      .toBeGreaterThan(norme(trouve(court, 'foreArmL').position));
  });

  it('applique la chaîne miroir à l identique', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, armLength: 0.9 } };
    const c = compile(HUMANOID, g, 18, binding());
    expect(norme(trouve(c, 'foreArmL').position))
      .toBeCloseTo(norme(trouve(c, 'foreArmR').position), 9);
  });

  it('ne touche pas à l os de départ d une chaîne', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, armLength: 1 } };
    const c = compile(HUMANOID, g, 18, binding());
    expect(norme(trouve(c, 'shoulderL').position))
      .toBeCloseTo(norme(binding().bones['shoulderL']!.position), 9);
  });
});

describe('compile — l âge', () => {
  it('un nourrisson est bien plus petit qu un adulte', () => {
    const g = defaultGenome(HUMANOID);
    const bébé = compile(HUMANOID, g, 0, binding());
    const adulte = compile(HUMANOID, g, 18, binding());
    expect(bébé.stats.heightMeters).toBeLessThan(adulte.stats.heightMeters * 0.35);
  });

  it('la tête d un nourrisson est proportionnellement bien plus grosse', () => {
    const g = defaultGenome(HUMANOID);
    const bébé = trouve(compile(HUMANOID, g, 0, binding()), 'head');
    const adulte = trouve(compile(HUMANOID, g, 18, binding()), 'head');
    // 0.25 / 0.133 ≈ 1.88
    expect(bébé.scale / adulte.scale).toBeGreaterThan(1.7);
    expect(bébé.scale / adulte.scale).toBeLessThan(2.1);
  });

  it('la taille croît de façon monotone jusqu à l âge adulte', () => {
    const g = defaultGenome(HUMANOID);
    let précédente = 0;
    for (let age = 0; age <= 18; age += 1) {
      const h = compile(HUMANOID, g, age, binding()).stats.heightMeters;
      expect(h).toBeGreaterThanOrEqual(précédente);
      précédente = h;
    }
  });
});

describe('compile — visage et surface', () => {
  it('ne rend que les morphs déclarés ET présents dans la liaison', () => {
    const b = binding();
    delete (b.morphIndex as Record<string, number>)['cheekbone'];
    const c = compile(HUMANOID, defaultGenome(HUMANOID), 18, b);
    expect(Object.keys(c.morphs)).not.toContain('cheekbone');
    expect(Object.keys(c.morphs)).toContain('jawWidth');
  });

  it('projette un gène [0,1] dans la plage déclarée du morph', () => {
    const base = defaultGenome(HUMANOID).genes;
    // jawWidth a pour plage [-1, 1] : un gène à 0 doit donner -1, à 1 donner 1.
    const bas = compile(HUMANOID, { family: 'humanoid', genes: { ...base, jawWidth: 0 } }, 18, binding());
    const haut = compile(HUMANOID, { family: 'humanoid', genes: { ...base, jawWidth: 1 } }, 18, binding());
    expect(bas.morphs['jawWidth']).toBeCloseTo(-1, 6);
    expect(haut.morphs['jawWidth']).toBeCloseTo(1, 6);
  });

  it('reporte les tons de surface tels quels, sans les convertir en couleur', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, skinTone: 0.8 } };
    expect(compile(HUMANOID, g, 18, binding()).surface.skinTone).toBeCloseTo(0.8, 6);
  });
});

describe('compile — rejets', () => {
  it('refuse une liaison d une autre famille', () => {
    const b = { ...binding(), family: 'canid' };
    expect(() => compile(HUMANOID, defaultGenome(HUMANOID), 18, b)).toThrow('canid');
  });

  it('refuse une liaison à laquelle il manque un os de chaîne', () => {
    const b = binding();
    delete (b.bones as Record<string, unknown>)['foreArmL'];
    expect(() => compile(HUMANOID, defaultGenome(HUMANOID), 18, b)).toThrow('foreArmL');
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/compile/compile"`.

- [ ] **Step 3: Écrire les types de compilation**

`packages/character/src/compile/types.ts` :

```ts
export type Vec3 = readonly [number, number, number];

/** Un os tel que mesuré dans le rig source, avant toute morphologie. */
export interface BoneRest {
  role: string;
  /** Translation locale par rapport au parent, en mètres. */
  position: Vec3;
  parentRole: string | null;
}

/**
 * Ce que le pont Three mesure sur un asset réel et passe au compilateur.
 * Aucun objet Three ne franchit cette frontière : c'est ce qui garde le
 * compilateur testable en Node et comparable par vecteurs dorés.
 */
export interface RigBinding {
  family: string;
  bones: Readonly<Record<string, BoneRest>>;
  /** Clé de morph de la famille → index dans morphTargetInfluences. */
  morphIndex: Readonly<Record<string, number>>;
  /** Hauteur du personnage adulte médian dans le rig source. */
  restHeightMeters: number;
}

export interface CompiledBone {
  role: string;
  position: Vec3;
  /** Échelle UNIFORME. Une similitude ne cisaille pas ; une échelle par axe si. */
  scale: number;
}

export interface CompiledCharacter {
  family: string;
  restPose: CompiledBone[];
  /** Toujours vrai : la pose de repos a changé, les matrices inverses aussi. */
  rebindSkeleton: boolean;
  morphs: Record<string, number>;
  /** Scalaires normalisés. La conversion en couleur appartient au pont. */
  surface: { skinTone: number; hairTone: number; hairStyle: number };
  stats: { heightMeters: number };
}
```

- [ ] **Step 4: Écrire le compilateur**

`packages/character/src/compile/compile.ts` :

```ts
import { evalCurve } from '../family/proportions';
import type { ChainDef, FamilyDescriptor } from '../family/types';
import type { Genome } from '../genome/types';
import type { CompiledBone, CompiledCharacter, RigBinding, Vec3 } from './types';

/** Plage d'action d'un gène de longueur : ±25 % autour du rig source. */
const LENGTH_SPAN = 0.5;

function lengthFactor(gene: number): number {
  return 1 - LENGTH_SPAN / 2 + gene * LENGTH_SPAN;
}

/** Remonte de `to` jusqu'à `from` exclu, et rend les rôles du plus proche au plus loin. */
function chainRoles(binding: RigBinding, from: string, to: string, label: string): string[] {
  const roles: string[] = [];
  let cursor: string | null = to;
  while (cursor !== null && cursor !== from) {
    const bone = binding.bones[cursor];
    if (bone === undefined) {
      throw new Error(`compile: chaîne "${label}" — os "${cursor}" absent de la liaison`);
    }
    roles.push(cursor);
    cursor = bone.parentRole;
  }
  if (cursor === null) {
    throw new Error(`compile: chaîne "${label}" — "${to}" ne descend pas de "${from}"`);
  }
  return roles;
}

function scaled(position: Vec3, factor: number): Vec3 {
  return [position[0] * factor, position[1] * factor, position[2] * factor];
}

/**
 * Compile un génome et un âge en une pose de repos, des influences de morphs et
 * des tons de surface.
 *
 * Les longueurs passent par des TRANSLATIONS, les volumes par des morphs, et
 * l'échelle n'est employée qu'uniformément — sur la tête, dont aucun rig RPM ne
 * fournit la clé de forme. Multiplier la translation locale d'un os revient
 * exactement à allonger le segment qui le sépare de son parent, sans toucher à
 * son orientation. C'est ce qui rend le cisaillement impossible par
 * construction plutôt que par vigilance.
 */
export function compile(
  family: FamilyDescriptor,
  genome: Genome,
  age: number,
  binding: RigBinding,
): CompiledCharacter {
  if (binding.family !== family.id) {
    throw new Error(
      `compile: liaison de famille "${binding.family}" pour le descripteur "${family.id}"`,
    );
  }

  const gene = (key: string): number => genome.genes[key] ?? 0.5;

  const adult = family.adultAge;
  const bodyScale = evalCurve(family.proportions.bodyScale, age);
  const limbRatio =
    evalCurve(family.proportions.limbToTorso, age) /
    evalCurve(family.proportions.limbToTorso, adult);
  const headRatio =
    evalCurve(family.proportions.headToBody, age) /
    evalCurve(family.proportions.headToBody, adult);

  // La stature module toutes les chaînes ensemble ; les gènes de chaîne
  // modulent ensuite chacune indépendamment.
  const stature = lengthFactor(gene('stature'));

  const factors = new Map<string, number>();
  for (const [label, chain] of Object.entries(family.chains) as Array<[string, ChainDef]>) {
    const own = lengthFactor(gene(chain.gene));
    // Un enfant a les membres courts par rapport au tronc : le rapport ne
    // s'applique qu'aux chaînes de membres, jamais au tronc lui-même.
    const ageFactor = label === 'torso' ? 1 : limbRatio;
    const factor = stature * own * ageFactor;

    for (const role of chainRoles(binding, chain.from, chain.to, label)) {
      factors.set(role, factor);
    }
    if (chain.mirror !== undefined) {
      for (const role of chainRoles(binding, chain.mirror[0], chain.mirror[1], `${label} (miroir)`)) {
        factors.set(role, factor);
      }
    }
  }

  const restPose: CompiledBone[] = [];
  for (const bone of Object.values(binding.bones)) {
    const factor = factors.get(bone.role) ?? 1;
    restPose.push({
      role: bone.role,
      position: scaled(bone.position, factor),
      // La racine porte l'échelle globale du corps, la tête son rapport propre.
      scale: bone.role === 'root' ? bodyScale : bone.role === 'head' ? headRatio : 1,
    });
  }

  const morphs: Record<string, number> = {};
  for (const [key, def] of Object.entries(family.morphs)) {
    if (binding.morphIndex[key] === undefined) continue;
    const [lo, hi] = def.range;
    morphs[key] = lo + gene(key) * (hi - lo);
  }

  return {
    family: family.id,
    restPose,
    rebindSkeleton: true,
    morphs,
    surface: {
      skinTone: gene('skinTone'),
      hairTone: gene('hairTone'),
      hairStyle: gene('hairStyle'),
    },
    stats: { heightMeters: binding.restHeightMeters * bodyScale * stature },
  };
}
```

- [ ] **Step 5: Exporter**

Ajouter à `packages/character/src/index.ts` :

```ts
export type {
  Vec3,
  BoneRest,
  RigBinding,
  CompiledBone,
  CompiledCharacter,
} from './compile/types';
export { compile } from './compile/compile';
```

- [ ] **Step 6: Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : tous passants. Si « laisse un adulte médian identique » échoue, vérifier que `lengthFactor(0.5)` vaut bien exactement 1.

- [ ] **Step 7: Commit**

```bash
git add packages/character/src/compile packages/character/src/index.ts packages/character/test/compile.test.ts
git commit -m "feat(character): pure compiler, lengths by translation and never by shear"
```

---

### Task 8: Invariants sur dix mille génomes

La spec §12 exige ce test nommément. Il est ce qui autorise à dire que le cisaillement est impossible par construction, plutôt que de l'espérer.

**Files:**
- Create: `packages/character/test/invariants.test.ts`

**Interfaces:**
- Consumes: `compile`, `createGenome`, `HUMANOID`, `RigBinding` (tâche 7)
- Produces: rien — c'est un test

- [ ] **Step 1: Écrire le test**

`packages/character/test/invariants.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { createGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import type { RigBinding } from '../src/compile/types';
import type { RngLike } from '../src/genome/types';

function makeCountingRng(seed: number): RngLike {
  let h = seed >>> 0;
  return {
    next() {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
    },
  };
}

function binding(): RigBinding {
  const os = (role: string, parentRole: string | null, p: readonly [number, number, number]) =>
    [role, { role, parentRole, position: p }] as const;
  return {
    family: 'humanoid',
    restHeightMeters: 1.75,
    morphIndex: { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 },
    bones: Object.fromEntries([
      os('root', null, [0, 0.95, 0]),
      os('spine', 'root', [0, 0.12, 0]),
      os('chest', 'spine', [0, 0.14, 0]),
      os('neck', 'chest', [0, 0.16, 0]),
      os('head', 'neck', [0, 0.09, 0]),
      os('shoulderL', 'chest', [0.05, 0.05, 0]),
      os('upperArmL', 'shoulderL', [0.13, 0, 0]),
      os('foreArmL', 'upperArmL', [0.27, 0, 0]),
      os('handL', 'foreArmL', [0.25, 0, 0]),
      os('shoulderR', 'chest', [-0.05, 0.05, 0]),
      os('upperArmR', 'shoulderR', [-0.13, 0, 0]),
      os('foreArmR', 'upperArmR', [-0.27, 0, 0]),
      os('handR', 'foreArmR', [-0.25, 0, 0]),
      os('upLegL', 'root', [0.09, -0.05, 0]),
      os('legL', 'upLegL', [0, -0.44, 0]),
      os('footL', 'legL', [0, -0.42, 0]),
      os('upLegR', 'root', [-0.09, -0.05, 0]),
      os('legR', 'upLegR', [0, -0.44, 0]),
      os('footR', 'legR', [0, -0.42, 0]),
    ]),
  };
}

describe('dix mille génomes tirés au hasard', () => {
  it('ne produisent jamais de valeur non finie, ni de personnage absurde', () => {
    const rng = makeCountingRng(20260817);
    const rig = binding();
    const âges = [0, 1, 4, 9, 14, 18, 35, 70];

    for (let i = 0; i < 10000; i++) {
      const genome = createGenome(HUMANOID, rng);
      const age = âges[i % âges.length]!;
      const c = compile(HUMANOID, genome, age, rig);

      for (const bone of c.restPose) {
        for (const axis of bone.position) {
          expect(Number.isFinite(axis)).toBe(true);
        }
        // L'invariant central : aucune échelle non uniforme n'est représentable,
        // et l'échelle uniforme reste strictement positive et bornée.
        expect(Number.isFinite(bone.scale)).toBe(true);
        expect(bone.scale).toBeGreaterThan(0.05);
        expect(bone.scale).toBeLessThan(5);
      }

      for (const influence of Object.values(c.morphs)) {
        expect(Number.isFinite(influence)).toBe(true);
        expect(Math.abs(influence)).toBeLessThanOrEqual(1);
      }

      expect(c.stats.heightMeters).toBeGreaterThan(0.3);
      expect(c.stats.heightMeters).toBeLessThan(2.6);
    }
  });

  it('classe toujours un adulte plus grand que le nourrisson de même génome', () => {
    const rng = makeCountingRng(5);
    const rig = binding();
    for (let i = 0; i < 500; i++) {
      const genome = createGenome(HUMANOID, rng);
      expect(compile(HUMANOID, genome, 0, rig).stats.heightMeters)
        .toBeLessThan(compile(HUMANOID, genome, 18, rig).stats.heightMeters);
    }
  });
});
```

- [ ] **Step 2: Lancer le test**

```bash
pnpm --filter @iwsdk/cardinal-character test invariants
```

Attendu : PASS. Si une borne de hauteur échoue, ne pas élargir la borne sans comprendre : c'est le signe que `LENGTH_SPAN` ou une courbe produit des tailles hors du plausible.

- [ ] **Step 3: Commit**

```bash
git add packages/character/test/invariants.test.ts
git commit -m "test(character): ten thousand genomes, no non-finite value and no absurd body"
```

---

### Task 9: Mémoïsation et budget

**Files:**
- Create: `packages/character/src/compile/memo.ts`
- Test: `packages/character/test/memo.test.ts`
- Modify: `packages/character/src/index.ts`

**Interfaces:**
- Consumes: `compile`, `packGenome`
- Produces: `genomeKey(family: FamilyDescriptor, genome: Genome, age: number): string` ; `class CompileCache { constructor(maxEntries?: number); get(family, genome, age, binding): CompiledCharacter; get size(): number; get hits(): number }`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/memo.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { createGenome, defaultGenome } from '../src/genome/create';
import { CompileCache, genomeKey } from '../src/compile/memo';
import type { RigBinding } from '../src/compile/types';
import type { RngLike } from '../src/genome/types';

function makeCountingRng(seed: number): RngLike {
  let h = seed >>> 0;
  return {
    next() {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
    },
  };
}

function binding(): RigBinding {
  return {
    family: 'humanoid',
    restHeightMeters: 1.75,
    morphIndex: { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 },
    bones: {
      root: { role: 'root', parentRole: null, position: [0, 0.95, 0] },
      spine: { role: 'spine', parentRole: 'root', position: [0, 0.12, 0] },
      chest: { role: 'chest', parentRole: 'spine', position: [0, 0.14, 0] },
      neck: { role: 'neck', parentRole: 'chest', position: [0, 0.16, 0] },
      head: { role: 'head', parentRole: 'neck', position: [0, 0.09, 0] },
      shoulderL: { role: 'shoulderL', parentRole: 'chest', position: [0.05, 0.05, 0] },
      upperArmL: { role: 'upperArmL', parentRole: 'shoulderL', position: [0.13, 0, 0] },
      foreArmL: { role: 'foreArmL', parentRole: 'upperArmL', position: [0.27, 0, 0] },
      handL: { role: 'handL', parentRole: 'foreArmL', position: [0.25, 0, 0] },
      shoulderR: { role: 'shoulderR', parentRole: 'chest', position: [-0.05, 0.05, 0] },
      upperArmR: { role: 'upperArmR', parentRole: 'shoulderR', position: [-0.13, 0, 0] },
      foreArmR: { role: 'foreArmR', parentRole: 'upperArmR', position: [-0.27, 0, 0] },
      handR: { role: 'handR', parentRole: 'foreArmR', position: [-0.25, 0, 0] },
      upLegL: { role: 'upLegL', parentRole: 'root', position: [0.09, -0.05, 0] },
      legL: { role: 'legL', parentRole: 'upLegL', position: [0, -0.44, 0] },
      footL: { role: 'footL', parentRole: 'legL', position: [0, -0.42, 0] },
      upLegR: { role: 'upLegR', parentRole: 'root', position: [-0.09, -0.05, 0] },
      legR: { role: 'legR', parentRole: 'upLegR', position: [0, -0.44, 0] },
      footR: { role: 'footR', parentRole: 'legR', position: [0, -0.42, 0] },
    },
  };
}

describe('genomeKey', () => {
  it('donne la même clé à deux génomes égaux', () => {
    expect(genomeKey(HUMANOID, defaultGenome(HUMANOID), 20))
      .toBe(genomeKey(HUMANOID, defaultGenome(HUMANOID), 20));
  });

  it('quantifie l âge : vingt ans et vingt ans et demi partagent une clé', () => {
    expect(genomeKey(HUMANOID, defaultGenome(HUMANOID), 20))
      .toBe(genomeKey(HUMANOID, defaultGenome(HUMANOID), 20.4));
  });

  it('sépare deux âges qui changent réellement les proportions', () => {
    expect(genomeKey(HUMANOID, defaultGenome(HUMANOID), 2))
      .not.toBe(genomeKey(HUMANOID, defaultGenome(HUMANOID), 9));
  });
});

describe('CompileCache', () => {
  it('ne compile qu une fois deux jumeaux', () => {
    const cache = new CompileCache();
    const rig = binding();
    const g = defaultGenome(HUMANOID);
    const a = cache.get(HUMANOID, g, 30, rig);
    const b = cache.get(HUMANOID, g, 30, rig);
    expect(b).toBe(a);
    expect(cache.size).toBe(1);
    expect(cache.hits).toBe(1);
  });

  it('évince les plus anciennes au-delà de sa capacité', () => {
    const cache = new CompileCache(4);
    const rig = binding();
    const rng = makeCountingRng(1);
    for (let i = 0; i < 20; i++) cache.get(HUMANOID, createGenome(HUMANOID, rng), 30, rig);
    expect(cache.size).toBeLessThanOrEqual(4);
  });
});

describe('budget', () => {
  it('compile un personnage en moins de deux millisecondes', () => {
    const rig = binding();
    const rng = makeCountingRng(77);
    const génomes = Array.from({ length: 100 }, () => createGenome(HUMANOID, rng));
    // Rodage : la première compilation paie la mise en route du JIT. On mesure
    // `compile` directement et non le cache, dont le rôle est justement
    // d'éviter cette dépense.
    for (const g of génomes) compile(HUMANOID, g, 30, rig);

    const durées: number[] = [];
    for (const g of génomes) {
      const t0 = performance.now();
      compile(HUMANOID, g, 30, rig);
      durées.push(performance.now() - t0);
    }
    durées.sort((a, b) => a - b);
    // Médiane et non maximum : une machine de CI partagée produit des pics que
    // l on ne veut pas transformer en test instable.
    expect(durées[Math.floor(durées.length / 2)]!).toBeLessThan(2);
  });
});
```

L'import de `compile` doit figurer en tête du fichier, avec les autres :

```ts
import { compile } from '../src/compile/compile';
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/compile/memo"`.

- [ ] **Step 3: Écrire la mémoïsation**

`packages/character/src/compile/memo.ts` :

```ts
import type { FamilyDescriptor } from '../family/types';
import { packGenome } from '../genome/serialize';
import type { Genome } from '../genome/types';
import { compile } from './compile';
import type { CompiledCharacter, RigBinding } from './types';

/** Pas de quantification de l'âge, en années. */
const AGE_STEP = 1;

/**
 * Clé de mémoïsation. L'âge est quantifié : un villageois qui vieillit d'un
 * jour n'a aucune raison de recompiler, et les courbes de proportion ne
 * bougent pas de façon perceptible sous l'année.
 */
export function genomeKey(family: FamilyDescriptor, genome: Genome, age: number): string {
  const bytes = packGenome(family, genome);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `${family.id}:${Math.round(age / AGE_STEP)}:${hex}`;
}

/**
 * Cache borné, éviction du plus anciennement inséré.
 *
 * Deux jumeaux ne compilent qu'une fois. Une fratrie qui partage 80 % de ses
 * gènes ne partage rien du tout, et c'est correct : 80 % d'un génome n'est pas
 * 80 % d'un personnage.
 */
export class CompileCache {
  private readonly entries = new Map<string, CompiledCharacter>();
  private hitCount = 0;

  constructor(private readonly maxEntries = 128) {}

  get size(): number {
    return this.entries.size;
  }

  get hits(): number {
    return this.hitCount;
  }

  get(
    family: FamilyDescriptor,
    genome: Genome,
    age: number,
    binding: RigBinding,
  ): CompiledCharacter {
    const key = genomeKey(family, genome, age);
    const found = this.entries.get(key);
    if (found !== undefined) {
      this.hitCount++;
      return found;
    }

    const compiled = compile(family, genome, age, binding);
    this.entries.set(key, compiled);

    if (this.entries.size > this.maxEntries) {
      // Map itère dans l'ordre d'insertion : la première clé est la plus ancienne.
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }

    return compiled;
  }
}
```

- [ ] **Step 4: Exporter**

Ajouter à `packages/character/src/index.ts` :

```ts
export { CompileCache, genomeKey } from './compile/memo';
```

- [ ] **Step 5: Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : tous passants.

- [ ] **Step 6: Commit**

```bash
git add packages/character/src/compile/memo.ts packages/character/src/index.ts packages/character/test/memo.test.ts
git commit -m "feat(character): bounded compile cache and a measured sub-2ms budget"
```

---

### Task 10: Vecteurs dorés

Le dépôt fige ses contrats par vecteurs générés et commités : le diff est le journal de changement. Le compilateur en mérite autant que le protocole.

**Files:**
- Create: `scripts/generate-character-vectors.mjs`
- Create: `fixtures/character_vectors.tsv` (généré)
- Test: `packages/character/test/vectors.test.ts`
- Modify: `package.json` (racine) — chaîne `test`

**Interfaces:**
- Consumes: `compile`, `createGenome`, `HUMANOID` (tâches 3, 4, 7)
- Produces: `fixtures/character_vectors.tsv`, chargé par `vectors.test.ts`

- [ ] **Step 1: Écrire le générateur**

Il importe `dist/`, jamais `src/`. `scripts/generate-cardinal.mjs` importe des `.ts` à l'exécution et exige donc Node ≥ 22.18 ; la machine de développement mesurée est en 22.12 et `engines` annonce 20.19. Ce générateur-ci n'a pas ce défaut.

`scripts/generate-character-vectors.mjs` :

```js
/**
 * Vecteurs dorés du compilateur morphologique.
 *
 * Importe `dist/`, jamais `src/` : le type-stripping natif de Node n'existe
 * qu'à partir de la 22.18, et ce dépôt annonce supporter la 20.19. Construire
 * avant de générer coûte quelques secondes et supprime la dépendance.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const { HUMANOID, createGenome, compile } = await import(
  join(root, 'packages/character/dist/index.js')
);

function rngFrom(seed) {
  let h = seed >>> 0;
  return {
    next() {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
    },
  };
}

const BINDING = {
  family: 'humanoid',
  restHeightMeters: 1.75,
  morphIndex: { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 },
  bones: {
    root: { role: 'root', parentRole: null, position: [0, 0.95, 0] },
    spine: { role: 'spine', parentRole: 'root', position: [0, 0.12, 0] },
    chest: { role: 'chest', parentRole: 'spine', position: [0, 0.14, 0] },
    neck: { role: 'neck', parentRole: 'chest', position: [0, 0.16, 0] },
    head: { role: 'head', parentRole: 'neck', position: [0, 0.09, 0] },
    shoulderL: { role: 'shoulderL', parentRole: 'chest', position: [0.05, 0.05, 0] },
    upperArmL: { role: 'upperArmL', parentRole: 'shoulderL', position: [0.13, 0, 0] },
    foreArmL: { role: 'foreArmL', parentRole: 'upperArmL', position: [0.27, 0, 0] },
    handL: { role: 'handL', parentRole: 'foreArmL', position: [0.25, 0, 0] },
    shoulderR: { role: 'shoulderR', parentRole: 'chest', position: [-0.05, 0.05, 0] },
    upperArmR: { role: 'upperArmR', parentRole: 'shoulderR', position: [-0.13, 0, 0] },
    foreArmR: { role: 'foreArmR', parentRole: 'upperArmR', position: [-0.27, 0, 0] },
    handR: { role: 'handR', parentRole: 'foreArmR', position: [-0.25, 0, 0] },
    upLegL: { role: 'upLegL', parentRole: 'root', position: [0.09, -0.05, 0] },
    legL: { role: 'legL', parentRole: 'upLegL', position: [0, -0.44, 0] },
    footL: { role: 'footL', parentRole: 'legL', position: [0, -0.42, 0] },
    upLegR: { role: 'upLegR', parentRole: 'root', position: [-0.09, -0.05, 0] },
    legR: { role: 'legR', parentRole: 'upLegR', position: [0, -0.44, 0] },
    footR: { role: 'footR', parentRole: 'legR', position: [0, -0.42, 0] },
  },
};

const AGES = [0, 5, 12, 18, 40];
const SEEDS = [1, 2, 3, 7, 11, 42, 1000, 20260817];

const lines = [
  '# Character compiler golden vectors.',
  '# GENERATED by scripts/generate-character-vectors.mjs -- do not edit by hand.',
  '# Tab-separated: seed, age, heightMeters, then role=x,y,z,scale per bone,',
  '# then morph=value. Floats are fixed to 6 decimals.',
  ['seed', 'age', 'height', 'bones', 'morphs'].join('\t'),
];

const f = (n) => n.toFixed(6);

for (const seed of SEEDS) {
  const genome = createGenome(HUMANOID, rngFrom(seed));
  for (const age of AGES) {
    const c = compile(HUMANOID, genome, age, BINDING);
    const bones = c.restPose
      .map((b) => `${b.role}=${f(b.position[0])},${f(b.position[1])},${f(b.position[2])},${f(b.scale)}`)
      .join(' ');
    const morphs = Object.keys(c.morphs)
      .sort()
      .map((k) => `${k}=${f(c.morphs[k])}`)
      .join(' ');
    lines.push([seed, age, f(c.stats.heightMeters), bones, morphs].join('\t'));
  }
}

writeFileSync(join(root, 'fixtures/character_vectors.tsv'), lines.join('\n') + '\n');
console.log(`character vectors: ${SEEDS.length * AGES.length} lignes écrites`);
```

- [ ] **Step 2: Construire puis générer**

```bash
pnpm --filter @iwsdk/cardinal-character build && node scripts/generate-character-vectors.mjs
```

Attendu : `character vectors: 40 lignes écrites`, et `fixtures/character_vectors.tsv` créé.

- [ ] **Step 3: Écrire le test de non-régression**

`packages/character/test/vectors.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HUMANOID } from '../src/family/humanoid';
import { createGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import type { RigBinding } from '../src/compile/types';
import type { RngLike } from '../src/genome/types';

const BINDING: RigBinding = {
  family: 'humanoid',
  restHeightMeters: 1.75,
  morphIndex: { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 },
  bones: {
    root: { role: 'root', parentRole: null, position: [0, 0.95, 0] },
    spine: { role: 'spine', parentRole: 'root', position: [0, 0.12, 0] },
    chest: { role: 'chest', parentRole: 'spine', position: [0, 0.14, 0] },
    neck: { role: 'neck', parentRole: 'chest', position: [0, 0.16, 0] },
    head: { role: 'head', parentRole: 'neck', position: [0, 0.09, 0] },
    shoulderL: { role: 'shoulderL', parentRole: 'chest', position: [0.05, 0.05, 0] },
    upperArmL: { role: 'upperArmL', parentRole: 'shoulderL', position: [0.13, 0, 0] },
    foreArmL: { role: 'foreArmL', parentRole: 'upperArmL', position: [0.27, 0, 0] },
    handL: { role: 'handL', parentRole: 'foreArmL', position: [0.25, 0, 0] },
    shoulderR: { role: 'shoulderR', parentRole: 'chest', position: [-0.05, 0.05, 0] },
    upperArmR: { role: 'upperArmR', parentRole: 'shoulderR', position: [-0.13, 0, 0] },
    foreArmR: { role: 'foreArmR', parentRole: 'upperArmR', position: [-0.27, 0, 0] },
    handR: { role: 'handR', parentRole: 'foreArmR', position: [-0.25, 0, 0] },
    upLegL: { role: 'upLegL', parentRole: 'root', position: [0.09, -0.05, 0] },
    legL: { role: 'legL', parentRole: 'upLegL', position: [0, -0.44, 0] },
    footL: { role: 'footL', parentRole: 'legL', position: [0, -0.42, 0] },
    upLegR: { role: 'upLegR', parentRole: 'root', position: [-0.09, -0.05, 0] },
    legR: { role: 'legR', parentRole: 'upLegR', position: [0, -0.44, 0] },
    footR: { role: 'footR', parentRole: 'legR', position: [0, -0.42, 0] },
  },
};

function rngFrom(seed: number): RngLike {
  let h = seed >>> 0;
  return {
    next() {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
    },
  };
}

const f = (n: number) => n.toFixed(6);

const vectorsPath = fileURLToPath(
  new URL('../../../fixtures/character_vectors.tsv', import.meta.url),
);

describe('vecteurs dorés', () => {
  const rows = readFileSync(vectorsPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('seed'));

  it('en contient quarante', () => {
    expect(rows).toHaveLength(40);
  });

  it('sont reproduits exactement par le compilateur courant', () => {
    for (const row of rows) {
      const [seed, age, height, bones, morphs] = row.split('\t');
      const genome = createGenome(HUMANOID, rngFrom(Number(seed)));
      const c = compile(HUMANOID, genome, Number(age), BINDING);

      expect(f(c.stats.heightMeters)).toBe(height);

      const actualBones = c.restPose
        .map(
          (b) =>
            `${b.role}=${f(b.position[0])},${f(b.position[1])},${f(b.position[2])},${f(b.scale)}`,
        )
        .join(' ');
      expect(actualBones).toBe(bones);

      const actualMorphs = Object.keys(c.morphs)
        .sort()
        .map((k) => `${k}=${f(c.morphs[k]!)}`)
        .join(' ');
      expect(actualMorphs).toBe(morphs);
    }
  });
});
```

- [ ] **Step 4: Lancer le test**

```bash
pnpm --filter @iwsdk/cardinal-character test vectors
```

Attendu : PASS. Si le chemin des fixtures est faux, corriger la profondeur de `../../../` — le fichier de test vit dans `packages/character/test/`.

- [ ] **Step 5: Brancher la régénération sur la vérification de la racine**

Dans le `package.json` de la racine, ajouter à la fin de la chaîne `test` :

```
&& node scripts/generate-character-vectors.mjs && git diff --exit-code fixtures/character_vectors.tsv
```

Cela impose la même règle qu'aux vecteurs de protocole : régénérer doit être un non-événement, et un diff signifie que le compilateur a changé sans que la trace ait été mise à jour.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-character-vectors.mjs fixtures/character_vectors.tsv packages/character/test/vectors.test.ts package.json
git commit -m "test(character): golden vectors generated from dist, not from source"
```

---

### Task 11: La règle d'assainissement des clips

Encode le résultat de la sonde. La règle est pure et vit ici ; son application aux `AnimationClip` de Three appartient à l'étape 2.

**Files:**
- Create: `packages/character/src/compile/clips.ts`
- Test: `packages/character/test/clips.test.ts`
- Modify: `packages/character/src/index.ts`

**Interfaces:**
- Consumes: `FamilyDescriptor`
- Produces:
  - `const CONSTANT_TRACK_EPSILON = 1e-6`
  - `interface TranslationTrack { boneRole: string; amplitudeMeters: number }`
  - `classifyTranslationTrack(family: FamilyDescriptor, track: TranslationTrack): 'keep' | 'strip' | 'conflict'`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/clips.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { classifyTranslationTrack, CONSTANT_TRACK_EPSILON } from '../src/compile/clips';

describe('classifyTranslationTrack', () => {
  it('garde la translation de la racine : c est la locomotion', () => {
    // M_Walk_001 déplace Hips de 3,21 m — mesuré sur le clip réel.
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'root', amplitudeMeters: 3.21 }))
      .toBe('keep');
  });

  it('retire une piste constante sur un os non-racine', () => {
    // F_Dances_001 porte seize pistes de ce type : elles réencodent les
    // décalages d os du rig source et n emportent aucun mouvement.
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'legL', amplitudeMeters: 0 }))
      .toBe('strip');
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'foreArmR', amplitudeMeters: 1e-9 }))
      .toBe('strip');
  });

  it('signale un conflit quand un os non-racine bouge réellement', () => {
    // Ce cas n existe dans aucun des quatre clips mesurés, mais s il survenait
    // il écraserait la morphologie sans qu on le voie. Il doit crier.
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'legL', amplitudeMeters: 0.05 }))
      .toBe('conflict');
  });

  it('place le seuil de constance à un micromètre', () => {
    expect(CONSTANT_TRACK_EPSILON).toBe(1e-6);
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'legL', amplitudeMeters: 9e-7 }))
      .toBe('strip');
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'legL', amplitudeMeters: 2e-6 }))
      .toBe('conflict');
  });

  it('traite un rôle inconnu comme non-racine', () => {
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'queue', amplitudeMeters: 0 }))
      .toBe('strip');
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/compile/clips"`.

- [ ] **Step 3: Écrire la règle**

`packages/character/src/compile/clips.ts` :

```ts
import type { FamilyDescriptor } from '../family/types';

/** En deçà, une piste ne porte aucun mouvement : c'est un décalage figé. */
export const CONSTANT_TRACK_EPSILON = 1e-6;

export interface TranslationTrack {
  boneRole: string;
  /** Amplitude maximale sur les trois axes, en mètres. */
  amplitudeMeters: number;
}

/**
 * Décide du sort d'une piste de translation face à une morphologie compilée.
 *
 * Mesuré sur quatre clips réels de readyplayerme/animation-library : seule la
 * racine bouge vraiment. `F_Dances_001` porte dix-sept pistes de translation,
 * dont seize constantes à 10⁻⁶ m près — elles réencodent les décalages d'os du
 * rig source. Elles écraseraient les longueurs compilées, mais peuvent être
 * retirées sans rien perdre.
 *
 * Le troisième cas n'a été observé dans aucun clip, et c'est précisément
 * pourquoi il doit crier plutôt que passer : une piste qui déplace réellement
 * un os non-racine est incompatible avec une morphologie, et personne ne le
 * verrait autrement.
 */
export function classifyTranslationTrack(
  family: FamilyDescriptor,
  track: TranslationTrack,
): 'keep' | 'strip' | 'conflict' {
  const isRoot = track.boneRole === 'root' && family.bones['root'] !== undefined;
  if (isRoot) return 'keep';
  return track.amplitudeMeters <= CONSTANT_TRACK_EPSILON ? 'strip' : 'conflict';
}
```

- [ ] **Step 4: Exporter**

Ajouter à `packages/character/src/index.ts` :

```ts
export type { TranslationTrack } from './compile/clips';
export { classifyTranslationTrack, CONSTANT_TRACK_EPSILON } from './compile/clips';
```

- [ ] **Step 5: Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : tous passants.

- [ ] **Step 6: Commit**

```bash
git add packages/character/src/compile/clips.ts packages/character/src/index.ts packages/character/test/clips.test.ts
git commit -m "feat(character): translation-track rule measured on four real RPM clips"
```

---

### Task 12: Les huit archétypes

L'acceptation du paquet : les métiers du scénario doivent produire des corps reconnaissables, et le rester.

**Files:**
- Create: `packages/character/src/presets/types.ts`
- Create: `packages/character/src/presets/metiers.ts`
- Test: `packages/character/test/presets.test.ts`
- Modify: `packages/character/src/index.ts`
- Create: `packages/character/README.md`

**Interfaces:**
- Consumes: `Genome`, `FamilyDescriptor`, `compile`
- Produces: `interface Preset { id: string; version: number; family: string; genes: Record<string, number>; ageRange: readonly [number, number]; note: string }` ; `METIERS: Readonly<Record<string, Preset>>` ; `genomeFromPreset(family: FamilyDescriptor, preset: Preset): Genome`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character/test/presets.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { compile } from '../src/compile/compile';
import { METIERS, genomeFromPreset } from '../src/presets/metiers';
import type { RigBinding } from '../src/compile/types';

const BINDING: RigBinding = {
  family: 'humanoid',
  restHeightMeters: 1.75,
  morphIndex: { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 },
  bones: {
    root: { role: 'root', parentRole: null, position: [0, 0.95, 0] },
    spine: { role: 'spine', parentRole: 'root', position: [0, 0.12, 0] },
    chest: { role: 'chest', parentRole: 'spine', position: [0, 0.14, 0] },
    neck: { role: 'neck', parentRole: 'chest', position: [0, 0.16, 0] },
    head: { role: 'head', parentRole: 'neck', position: [0, 0.09, 0] },
    shoulderL: { role: 'shoulderL', parentRole: 'chest', position: [0.05, 0.05, 0] },
    upperArmL: { role: 'upperArmL', parentRole: 'shoulderL', position: [0.13, 0, 0] },
    foreArmL: { role: 'foreArmL', parentRole: 'upperArmL', position: [0.27, 0, 0] },
    handL: { role: 'handL', parentRole: 'foreArmL', position: [0.25, 0, 0] },
    shoulderR: { role: 'shoulderR', parentRole: 'chest', position: [-0.05, 0.05, 0] },
    upperArmR: { role: 'upperArmR', parentRole: 'shoulderR', position: [-0.13, 0, 0] },
    foreArmR: { role: 'foreArmR', parentRole: 'upperArmR', position: [-0.27, 0, 0] },
    handR: { role: 'handR', parentRole: 'foreArmR', position: [-0.25, 0, 0] },
    upLegL: { role: 'upLegL', parentRole: 'root', position: [0.09, -0.05, 0] },
    legL: { role: 'legL', parentRole: 'upLegL', position: [0, -0.44, 0] },
    footL: { role: 'footL', parentRole: 'legL', position: [0, -0.42, 0] },
    upLegR: { role: 'upLegR', parentRole: 'root', position: [-0.09, -0.05, 0] },
    legR: { role: 'legR', parentRole: 'upLegR', position: [0, -0.44, 0] },
    footR: { role: 'footR', parentRole: 'legR', position: [0, -0.42, 0] },
  },
};

const MÉTIERS_ATTENDUS = [
  'charbonnier', 'ferronnier', 'chasseur', 'pecheur',
  'chercheur', 'inventeur', 'enseignant', 'commercant',
];

describe('catalogue des métiers', () => {
  it('couvre les huit métiers du scénario', () => {
    expect(Object.keys(METIERS).sort()).toEqual([...MÉTIERS_ATTENDUS].sort());
  });

  it('ne déclare que des gènes que la famille connaît', () => {
    for (const preset of Object.values(METIERS)) {
      for (const key of Object.keys(preset.genes)) {
        expect(HUMANOID.genes[key]).toBeDefined();
      }
    }
  });

  it('borne chaque gène dans [0,1]', () => {
    for (const preset of Object.values(METIERS)) {
      for (const value of Object.values(preset.genes)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('déclare une plage d âge d adulte pour chaque métier', () => {
    for (const preset of Object.values(METIERS)) {
      expect(preset.ageRange[0]).toBeGreaterThanOrEqual(HUMANOID.adultAge);
      expect(preset.ageRange[1]).toBeGreaterThan(preset.ageRange[0]);
    }
  });
});

describe('les archétypes restent ce qu ils prétendent être', () => {
  const compileMétier = (id: string, age: number) =>
    compile(HUMANOID, genomeFromPreset(HUMANOID, METIERS[id]!), age, BINDING);

  it('le ferronnier est plus large d épaules et plus massif que le chercheur', () => {
    const ferronnier = METIERS['ferronnier']!;
    const chercheur = METIERS['chercheur']!;
    expect(ferronnier.genes['shoulderWidth']!).toBeGreaterThan(chercheur.genes['shoulderWidth']!);
    expect(ferronnier.genes['bodyMass']!).toBeGreaterThan(chercheur.genes['bodyMass']!);
  });

  it('aucun métier ne produit un adulte hors de la stature humaine', () => {
    for (const id of MÉTIERS_ATTENDUS) {
      for (const age of [18, 40, 60]) {
        const h = compileMétier(id, age).stats.heightMeters;
        expect(h).toBeGreaterThan(1.4);
        expect(h).toBeLessThan(2.1);
      }
    }
  });

  it('un métier compilé à sept ans reste un enfant, pas un adulte réduit', () => {
    const enfant = compileMétier('ferronnier', 7);
    const adulte = compileMétier('ferronnier', 40);
    expect(enfant.stats.heightMeters).toBeLessThan(adulte.stats.heightMeters * 0.8);
    const têteEnfant = enfant.restPose.find((b) => b.role === 'head')!.scale;
    const têteAdulte = adulte.restPose.find((b) => b.role === 'head')!.scale;
    expect(têteEnfant).toBeGreaterThan(têteAdulte);
  });
});

describe('genomeFromPreset', () => {
  it('complète les gènes absents par la valeur médiane', () => {
    const genome = genomeFromPreset(HUMANOID, METIERS['enseignant']!);
    expect(Object.keys(genome.genes).sort()).toEqual(Object.keys(HUMANOID.genes).sort());
  });

  it('refuse un preset d une autre famille', () => {
    const étranger = { ...METIERS['chasseur']!, family: 'canid' };
    expect(() => genomeFromPreset(HUMANOID, étranger)).toThrow('canid');
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/presets/metiers"`.

- [ ] **Step 3: Écrire le type de preset**

`packages/character/src/presets/types.ts` :

```ts
export interface Preset {
  id: string;
  version: number;
  family: string;
  /** Gènes explicitement fixés. Les absents prennent la valeur médiane. */
  genes: Readonly<Record<string, number>>;
  ageRange: readonly [number, number];
  note: string;
}
```

- [ ] **Step 4: Écrire les huit archétypes**

`packages/character/src/presets/metiers.ts` :

```ts
import type { FamilyDescriptor } from '../family/types';
import type { Genome } from '../genome/types';
import type { Preset } from './types';

const p = (
  id: string,
  genes: Record<string, number>,
  ageRange: readonly [number, number],
  note: string,
): Preset => ({ id, version: 1, family: 'humanoid', genes, ageRange, note });

/**
 * Les huit métiers du village. Ce ne sont pas des costumes : chaque archétype
 * décrit ce que le métier fait au corps sur vingt ans de pratique.
 */
export const METIERS: Readonly<Record<string, Preset>> = {
  charbonnier: p('charbonnier', { shoulderWidth: 0.7, bodyMass: 0.62, stature: 0.45, armLength: 0.55 },
    [22, 60], 'Trapu, épaules solides — porter et empiler toute la journée.'),

  ferronnier: p('ferronnier', { shoulderWidth: 0.88, bodyMass: 0.75, stature: 0.55, armLength: 0.62, jawWidth: 0.7 },
    [28, 55], 'Charpente lourde, avant-bras longs — le marteau plutôt que la taille.'),

  chasseur: p('chasseur', { shoulderWidth: 0.6, bodyMass: 0.35, stature: 0.68, legLength: 0.78, armLength: 0.6 },
    [20, 50], 'Sec et long de jambe — la poursuite avant la force.'),

  pecheur: p('pecheur', { shoulderWidth: 0.72, bodyMass: 0.5, stature: 0.5, armLength: 0.7, torsoLength: 0.6 },
    [24, 62], 'Tronc développé, bras longs — la rame et le filet.'),

  chercheur: p('chercheur', { shoulderWidth: 0.38, bodyMass: 0.3, stature: 0.55, armLength: 0.45, eyeScale: 0.65 },
    [30, 70], 'Peu de masse, regard marqué — une vie assise près du feu.'),

  inventeur: p('inventeur', { shoulderWidth: 0.45, bodyMass: 0.4, stature: 0.52, armLength: 0.52, cheekbone: 0.6 },
    [26, 60], 'Ordinaire de corps, mains constamment occupées.'),

  enseignant: p('enseignant', { shoulderWidth: 0.5, bodyMass: 0.45, stature: 0.58, torsoLength: 0.55 },
    [28, 68], 'Médian en tout — le corps ne dit rien, la posture dit tout.'),

  commercant: p('commercant', { shoulderWidth: 0.55, bodyMass: 0.58, stature: 0.5, legLength: 0.6 },
    [25, 65], 'Bien nourri et bon marcheur — la route entre les villages.'),
};

export function genomeFromPreset(family: FamilyDescriptor, preset: Preset): Genome {
  if (preset.family !== family.id) {
    throw new Error(
      `genomeFromPreset: preset "${preset.id}" de famille "${preset.family}" pour "${family.id}"`,
    );
  }
  const genes: Record<string, number> = {};
  for (const key of Object.keys(family.genes).sort()) {
    genes[key] = preset.genes[key] ?? 0.5;
  }
  return { family: family.id, genes };
}
```

- [ ] **Step 5: Exporter et documenter**

Ajouter à `packages/character/src/index.ts` :

```ts
export type { Preset } from './presets/types';
export { METIERS, genomeFromPreset } from './presets/metiers';
```

Créer `packages/character/README.md` — les deux autres paquets Cardinal en ont un, `cardinal-world` et `cardinal-simulation` n'en ont pas, et ce manque est un des constats de la cartographie du dépôt. Ne pas le reproduire :

```markdown
# @iwsdk/cardinal-character

Génome, hérédité et compilation morphologique des êtres vivants du stack Cardinal.
**Aucune dépendance runtime** — ni Three, ni IWSDK. Tout est pur et testable en Node.

## Ce que fait ce paquet

Un **descripteur de famille** dit ce qu'est une espèce : rôles d'os et leurs alias,
chaînes déformables, courbes de proportion selon l'âge, catalogue de gènes.

Un **génome** est un dictionnaire de gènes normalisés dans `[0,1]`. `breed()` en
croise deux de façon déterministe depuis un générateur injecté, ce qui rend la
ressemblance familiale rejouable depuis la graine du monde.

Le **compilateur** prend un génome, un âge et une liaison de rig mesurée, et rend
une pose de repos, des influences de morphs et des tons de surface. Il ne touche
jamais un objet Three : c'est le paquet `@iwsdk/cardinal-character-three` qui
applique le résultat.

## La règle qui gouverne tout

> Les longueurs passent par des **translations d'os**, les volumes par des
> **morphs**, et l'échelle n'est employée qu'**uniformément**.

Une échelle non uniforme sur un os cisaille la peau et casse les normales. Le
compilateur ne peut pas en produire : `CompiledBone.scale` est un scalaire.

## L'âge n'est pas un gène

Le génome décrit l'adulte-cible ; `compile(family, genome, age, binding)` applique
les courbes de proportion. Un enfant et l'adulte qu'il deviendra partagent donc le
même génome, et un villageois peut vieillir sans jamais être re-tiré.

## Usage

```ts
import { HUMANOID, createGenome, breed, compile, METIERS, genomeFromPreset } from '@iwsdk/cardinal-character';

const mère = genomeFromPreset(HUMANOID, METIERS.ferronnier);
const père = createGenome(HUMANOID, rng);
const enfant = breed(HUMANOID, mère, père, rng, 'f');

const corps = compile(HUMANOID, enfant, 7, binding);
```

## Vecteurs dorés

`fixtures/character_vectors.tsv` fige la sortie du compilateur pour huit graines et
cinq âges. `pnpm test` régénère et compare : un diff signifie que la morphologie a
changé sans que la trace ait suivi.
```

- [ ] **Step 6: Lancer la suite complète et la vérification de la racine**

```bash
pnpm --filter @iwsdk/cardinal-character test && pnpm --filter @iwsdk/cardinal-character typecheck && pnpm --filter @iwsdk/cardinal-character build
```

Attendu : toutes les suites passantes, aucune erreur de typage, `dist/` produit.

- [ ] **Step 7: Commit**

```bash
git add packages/character/src/presets packages/character/src/index.ts packages/character/test/presets.test.ts packages/character/README.md
git commit -m "feat(character): the eight village trades, pinned so a blacksmith stays one"
```

---

## Vérification de fin d'étape

- [ ] **La suite complète du dépôt passe**

```bash
pnpm test
```

Attendu : les suites existantes restent vertes, `@iwsdk/cardinal-character` s'y ajoute, et la régénération des vecteurs ne produit aucun diff.

Si `check-cardinal-drift` échoue avec `ERR_UNKNOWN_FILE_EXTENSION`, c'est le défaut connu du dépôt — le générateur de composants importe des `.ts` à l'exécution et exige Node ≥ 22.18. Contourner avec `NODE_OPTIONS=--experimental-strip-types`, et ne pas le corriger ici : c'est un travail distinct.

- [ ] **Le paquet n'a acquis aucune dépendance**

```bash
node -e "const p=require('./packages/character/package.json'); if(p.dependencies) { console.error('DÉPENDANCE INTRODUITE:', p.dependencies); process.exit(1) } console.log('zéro dépendance: OK')"
```

- [ ] **Aucune échelle non uniforme n'est représentable**

```bash
grep -rn "scale" packages/character/src/compile/types.ts
```

Attendu : `scale` est déclaré `number`, jamais un vecteur. Si quelqu'un l'a élargi en triplet, l'invariant central du design est perdu.

---

## Ce que cette étape ne livre pas

Rien ne s'affiche à l'écran, et c'est le contrat : `cardinal-simulation` a commencé exactement ainsi. L'étape 2 (`@iwsdk/cardinal-character-three`) produit la liaison depuis un glTF réel, applique la pose de repos, recalcule les matrices inverses et rend le premier villageois avec une morphologie. Elle aura son propre plan.

Reste également ouverte la sonde 2 de la spec §13 — quel chemin de montage UIKitML pour `@iwsdk/core@0.5.3` — qui ne bloque que l'étape 4 et sera tranchée dans le plan des panneaux.
