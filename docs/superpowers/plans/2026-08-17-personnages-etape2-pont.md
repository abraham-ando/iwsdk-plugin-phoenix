# Personnages procéduraux — étape 2 : le pont Three

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire `@iwsdk/cardinal-character-three`, qui applique la sortie du compilateur morphologique à de vrais objets Three — squelette skinné ou marionnette articulée — et l'expose comme composants et systèmes ECS d'IWSDK.

**Architecture:** Un résolveur pur transforme une hiérarchie quelconque en `RigBinding` et rend un rapport d'import diagnosticable. Deux applicateurs satisfont une même interface : l'un écrit dans un `Skeleton`, l'autre dans des `Object3D` nommés. Deux systèmes ECS orchestrent, l'un qui recompile rarement, l'autre qui écrit les canaux continus.

**Tech Stack:** TypeScript 5.9, tsup, vitest, `@iwsdk/core` 0.5.3 (qui réexporte Three r181), `@iwsdk/cardinal-character`.

**Spec:** `docs/superpowers/specs/2026-08-17-personnages-etape2-pont-three-design.md`

## Global Constraints

- **La morphologie s'applique par translation d'os, et on n'appelle JAMAIS `skeleton.calculateInverses()`.** Mesuré : recalculer les matrices inverses annule la déformation au lieu de la fixer. C'est la contrainte centrale de ce plan.
- **Aucune échelle non uniforme sur un os.** `CompiledBone.scale` est un scalaire ; il s'écrit avec `bone.scale.setScalar(v)`.
- **Importer Three depuis `@iwsdk/core`, jamais depuis `three`.** Règle du dépôt : un import direct crée une seconde instance de Three et casse les `instanceof`. Vérifié : `SkinnedMesh`, `Skeleton`, `Bone`, `Box3`, `AnimationClip`, `VectorKeyframeTrack`, `Color`, `Vector3`, `Quaternion`, `Matrix4`, `Float32BufferAttribute`, `Uint16BufferAttribute` sont tous réexportés et se chargent en Node.
- **`@iwsdk/cardinal-character` reste sans dépendance.** Les amendements de la tâche 1 n'y ajoutent rien.
- **Commentaires en français**, comme le reste du dépôt. Descriptions de tests aussi.
- **`noUncheckedIndexedAccess` est actif** : tout accès indexé gardé ou suffixé de `!`.
- **`Types.Color` est un champ vecteur** : `setValue` **lève** dessus en elics 3.4.x, il faut `entity.getVectorView(...)`.
- Node local mesuré : **22.12**. `pnpm test` à la racine exige `NODE_OPTIONS=--experimental-strip-types` à cause d'un défaut préexistant de `scripts/generate-cardinal.mjs`, et `pnpm build` doit avoir tourné avant. Ce n'est pas à corriger ici.
- Messages de commit en anglais, format conventionnel.

## Ce que la sonde a établi

Chaîne hanche → genou → cheville, un sommet pondéré au genou, un à la cheville, mesuré contre `super-three@0.181` :

| Geste | genou | cheville |
| :--- | ---: | ---: |
| repos | −1,000 | −2,000 |
| cuisse allongée, sans rebake | **−1,500** | **−2,500** |
| …puis `calculateInverses()` | −1,000 | −2,000 |
| + rotation de clip sur le genou | −1,500 | −1,500 |

Déplacer l'os **est** la déformation. Le rebake l'annule. Une rotation de clip la préserve — d'où l'importance de l'assainissement (tâche 5).

---

## Structure des fichiers

```text
packages/character/                       [MODIFIÉ — tâche 1]
  src/family/types.ts                     + groundRole, + GeneDef.ramp
  src/family/humanoid.ts                  + groundRole: 'footL', + rampes
  src/family/registry.ts                  + deux règles de validation
  src/compile/types.ts                    + BoneRest.rotation, − rebindSkeleton,
                                          + stats.groundOffsetMeters
  src/compile/quat.ts                     [NOUVEAU] quatMul, quatRotate
  src/compile/compile.ts                  compose la chaîne, calcule l'offset

packages/character-three/                 [NOUVEAU]
  package.json, tsconfig.json, tsup.config.ts, vitest.config.ts
  src/index.ts
  src/apply/types.ts                      CharacterApplicator
  src/apply/SkinnedApplicator.ts          tâche 2
  src/apply/PuppetApplicator.ts           tâche 4
  src/resolve/types.ts                    RigNode, ImportReport
  src/resolve/resolveBinding.ts           tâche 3
  src/clips/sanitize.ts                   tâche 5
  src/components/index.ts                 tâche 6
  src/systems/CharacterCompileSystem.ts   tâche 6
  src/systems/CharacterExpressionSystem.ts tâche 6
  src/create.ts                           tâche 6
  test/fixtures/skinned-leg.ts            chaîne à trois os, partagée
  test/*.test.ts
```

---

### Task 1: Amendements au noyau pur

**Files:**
- Modify: `packages/character/src/family/types.ts`
- Modify: `packages/character/src/family/humanoid.ts`
- Modify: `packages/character/src/family/registry.ts`
- Modify: `packages/character/src/compile/types.ts`
- Create: `packages/character/src/compile/quat.ts`
- Modify: `packages/character/src/compile/compile.ts`
- Modify: `packages/character/src/index.ts`
- Test: `packages/character/test/quat.test.ts`, `packages/character/test/ground.test.ts`
- Modify: `packages/character/test/fixtures/humanoid-binding.ts` (les os gagnent une rotation)
- Modify: `scripts/generate-character-vectors.mjs` (idem, plus la nouvelle statistique)
- Modify: `fixtures/character_vectors.tsv` (régénéré)

**Interfaces:**
- Consumes: l'API actuelle de `@iwsdk/cardinal-character`
- Produces:
  - `FamilyDescriptor.groundRole?: string`
  - `GeneDef.ramp?: readonly [string, string]`
  - `BoneRest.rotation: Vec4`
  - `CompiledCharacter.stats: { nominalHeightMeters: number; groundOffsetMeters: number }` — **`rebindSkeleton` disparaît**
  - `quatMul(a: Vec4, b: Vec4): Vec4`, `quatRotate(q: Vec4, v: Vec3): Vec3`

- [ ] **Step 1: Écrire le test des quaternions**

`packages/character/test/quat.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { quatMul, quatRotate } from '../src/compile/quat';

const IDENT = [0, 0, 0, 1] as const;
// Rotation de 90° autour de X : (0,1,0) doit partir sur (0,0,1).
const RX90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

describe('quatRotate', () => {
  it('laisse un vecteur intact sous l identité', () => {
    expect(quatRotate(IDENT, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('tourne (0,1,0) vers (0,0,1) autour de X', () => {
    const r = quatRotate(RX90, [0, 1, 0]);
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[1]).toBeCloseTo(0, 9);
    expect(r[2]).toBeCloseTo(1, 9);
  });

  it('conserve la longueur', () => {
    const r = quatRotate(RX90, [3, 4, 0]);
    expect(Math.hypot(r[0], r[1], r[2])).toBeCloseTo(5, 9);
  });
});

describe('quatMul', () => {
  it('a l identité pour élément neutre', () => {
    expect(quatMul(IDENT, RX90)).toEqual([...RX90]);
    expect(quatMul(RX90, IDENT)).toEqual([...RX90]);
  });

  it('compose deux quarts de tour en un demi-tour', () => {
    const half = quatMul(RX90, RX90);
    const r = quatRotate(half, [0, 1, 0]);
    expect(r[1]).toBeCloseTo(-1, 9);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test quat
```

Attendu : ÉCHEC — `Failed to resolve import "../src/compile/quat"`.

- [ ] **Step 3: Écrire les quaternions**

`packages/character/src/compile/quat.ts` :

```ts
import type { Vec3, Vec4 } from './types';

/**
 * Produit de deux quaternions, `a` puis `b`. Écrit ici et pas emprunté à Three :
 * le paquet n'a aucune dépendance, et c'est ce qui lui permet de composer une
 * chaîne d'os en Node comme dans un casque.
 */
export function quatMul(a: Vec4, b: Vec4): Vec4 {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Applique une rotation à un vecteur : v' = q · v · q⁻¹, forme développée. */
export function quatRotate(q: Vec4, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 · (q_vec × v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

```bash
pnpm --filter @iwsdk/cardinal-character test quat
```

Attendu : 5 tests passants.

- [ ] **Step 5: Étendre les types**

Dans `packages/character/src/family/types.ts`, ajouter à `GeneDef` :

```ts
  /**
   * Deux couleurs bornes, requises sur un gène de groupe `surface`. Le pont
   * interpole entre elles. Déclarées ici et non dans le pont : créer une espèce
   * doit rester un acte d'écriture de données, et une famille à fourrure a ses
   * propres teintes.
   */
  ramp?: readonly [string, string];
```

et à `FamilyDescriptor` **deux** champs — le second sert au résolveur de la tâche 3, et il est déclaré ici pour que le descripteur ne soit modifié qu'une fois :

```ts
  /**
   * Rôle de l'os qui touche le sol. Optionnel, contrairement à `limb` : son
   * absence a un sens — un poisson, un oiseau en vol ne s'ancrent à rien — là
   * où un `limb` absent ne signifierait rien d'autre qu'un oubli.
   */
  groundRole?: string;

  /**
   * Gène de surface → alias de maillages qu'il teinte dans l'asset. Quel
   * maillage porte la peau est une propriété de l'ASSET, pas de l'espèce — un
   * rig RPM nomme `Wolf3D_Body` — mais c'est la famille qui sait quels noms
   * chercher, sur le même mécanisme d'alias que les os.
   */
  surfaces?: Readonly<Record<string, { aliases: readonly string[] }>>;
```

Dans `packages/character/src/compile/types.ts`, ajouter à `BoneRest` :

```ts
  /** Quaternion de repos, mesuré par le résolveur. Nécessaire pour composer
   *  la chaîne : sans lui, l'ancrage serait juste pour un rig aligné sur Y et
   *  faux pour tout autre. */
  rotation: Vec4;
```

et exporter `Vec4` s'il ne l'est pas déjà :

```ts
export type Vec4 = readonly [number, number, number, number];
```

Toujours dans ce fichier, **retirer** `rebindSkeleton: boolean;` de `CompiledCharacter` et remplacer le bloc `stats` par :

```ts
  stats: {
    /**
     * Hauteur NOMINALE : `restHeightMeters × bodyScale × stature`. Elle ne rend
     * compte que de l'âge et de la stature.
     */
    nominalHeightMeters: number;
    /**
     * Décalage vertical à appliquer au rig pour que l'os d'appui repose à zéro.
     * Vaut 0 si la famille ne déclare pas de `groundRole`.
     */
    groundOffsetMeters: number;
  };
```

Retirer aussi la ligne `rebindSkeleton: true,` du retour de `compile.ts`.

- [ ] **Step 6: Écrire le test de l'ancrage**

`packages/character/test/ground.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { defaultGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import { humanoidBinding } from './fixtures/humanoid-binding';

describe('groundOffsetMeters', () => {
  it('place l os d appui exactement à zéro, à tous les âges', () => {
    const g = defaultGenome(HUMANOID);
    const rig = humanoidBinding();
    for (const age of [0, 3, 7, 12, 18, 40, 70]) {
      const c = compile(HUMANOID, g, age, rig);
      // On recompose la chaîne racine → appui sur la pose COMPILÉE et on
      // vérifie qu'après décalage le pied touche le sol.
      const y = worldYOf(c, rig, HUMANOID.groundRole!);
      expect(y + c.stats.groundOffsetMeters).toBeCloseTo(0, 6);
    }
  });

  it('vaut zéro pour une famille sans os d appui', () => {
    const sansAppui = { ...HUMANOID, groundRole: undefined };
    const c = compile(sansAppui, defaultGenome(HUMANOID), 18, humanoidBinding());
    expect(c.stats.groundOffsetMeters).toBe(0);
  });

  it('descend le pied plus bas chez l adulte que chez le nourrisson', () => {
    const g = defaultGenome(HUMANOID);
    const rig = humanoidBinding();
    const bebe = compile(HUMANOID, g, 0, rig).stats.groundOffsetMeters;
    const adulte = compile(HUMANOID, g, 18, rig).stats.groundOffsetMeters;
    // L offset compense une descente : plus le corps est grand, plus il est grand.
    expect(adulte).toBeGreaterThan(bebe);
  });
});

/** Recompose la chaîne dans le test, indépendamment de l implémentation. */
function worldYOf(
  compiled: ReturnType<typeof compile>,
  binding: ReturnType<typeof humanoidBinding>,
  role: string,
): number {
  const byRole = new Map(compiled.restPose.map((b) => [b.role, b]));
  const chain: string[] = [];
  let cursor: string | null = role;
  while (cursor !== null) {
    chain.unshift(cursor);
    cursor = binding.bones[cursor]?.parentRole ?? null;
  }
  let y = 0;
  let scale = 1;
  for (const r of chain) {
    const bone = byRole.get(r)!;
    y += scale * bone.position[1];
    scale *= bone.scale;
  }
  return y;
}
```

Note : ce test recompose sans rotation parce que la fixture n'en porte pas.

**Et c'est insuffisant.** Toutes les fixtures de ce plan — celle-ci, celle du
résolveur en tâche 3, celle du générateur — portent des quaternions identité.
Aucun test n'exercerait donc l'ordre de composition, et une inversion entre
« mettre à l'échelle puis tourner » et « tourner puis mettre à l'échelle »
resterait verte. Il faut un cas qui **discrimine** : une famille minimale à deux
os dont la racine porte un quart de tour autour de X, où une somme naïve de
translations donnerait `0` et la composition correcte `−1`.

```ts
const RX90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

const PLIE: FamilyDescriptor = {
  id: 'plie', adultAge: 18, rootRole: 'root', headRole: 'root', groundRole: 'pied',
  bones: { root: ['Root'], pied: ['Pied'] },
  chains: {}, morphs: {}, slots: {},
  proportions: { headToBody: [[0, 1]], limbToTorso: [[0, 1]], bodyScale: [[0, 1]] },
  genes: { stature: { group: 'structure', heritability: 1, dominance: 0.5, mutationRate: 0 } },
};

it('compose les ROTATIONS de la chaîne, pas seulement les translations', () => {
  // La racine tourne d'un quart de tour autour de X, donc le -Y local du pied
  // part sur -Z et ne descend pas : l'appui reste à y = 1, l'offset vaut -1.
  // Une somme naïve de translations donnerait 1 + (-1) = 0.
  const binding: RigBinding = {
    family: 'plie', restHeightMeters: 1, morphIndex: {},
    bones: {
      root: { role: 'root', parentRole: null, position: [0, 1, 0], rotation: [...RX90] },
      pied: { role: 'pied', parentRole: 'root', position: [0, -1, 0], rotation: [0, 0, 0, 1] },
    },
  };
  const c = compile(PLIE, { family: 'plie', genes: { stature: 0.5 } }, 18, binding);
  expect(c.stats.groundOffsetMeters).toBeCloseTo(-1, 6);
});
```

Le prouver : remplacer temporairement `quatRotate(rot, …)` par le vecteur non
tourné dans `groundHeight`, constater que ce test échoue seul, puis restaurer.

- [ ] **Step 7: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character test ground
```

Attendu : ÉCHEC — `groundOffsetMeters` n'existe pas encore.

- [ ] **Step 8: Calculer l'offset dans le compilateur**

Dans `packages/character/src/compile/compile.ts`, après la construction de `restPose`, ajouter :

```ts
/**
 * Compose la chaîne de la racine jusqu'à l'os d'appui et rend la hauteur de ce
 * dernier. Translation, rotation et échelle uniforme sont composées dans cet
 * ordre — une somme de translations serait juste pour un rig aligné sur Y et
 * fausse pour tout autre.
 */
function groundHeight(
  family: FamilyDescriptor,
  binding: RigBinding,
  pose: readonly CompiledBone[],
): number {
  const role = family.groundRole;
  if (role === undefined) return 0;

  const byRole = new Map(pose.map((b) => [b.role, b]));
  const chain: string[] = [];
  let cursor: string | null = role;
  while (cursor !== null) {
    if (binding.bones[cursor] === undefined) return 0;
    chain.unshift(cursor);
    cursor = binding.bones[cursor]!.parentRole;
  }

  let pos: Vec3 = [0, 0, 0];
  let rot: Vec4 = [0, 0, 0, 1];
  let scale = 1;
  for (const r of chain) {
    const bone = byRole.get(r);
    const rest = binding.bones[r]!;
    const local: Vec3 = bone ? bone.position : rest.position;
    const rotated = quatRotate(rot, [local[0] * scale, local[1] * scale, local[2] * scale]);
    pos = [pos[0] + rotated[0], pos[1] + rotated[1], pos[2] + rotated[2]];
    rot = quatMul(rot, rest.rotation);
    scale *= bone ? bone.scale : 1;
  }
  return pos[1];
}
```

et dans le retour de `compile` :

```ts
    stats: {
      nominalHeightMeters: binding.restHeightMeters * bodyScale * stature,
      groundOffsetMeters: -groundHeight(family, binding, restPose),
    },
```

Ajouter les imports `quatMul`, `quatRotate` depuis `./quat`.

- [ ] **Step 9: Déclarer l'appui et les rampes sur HUMANOID**

Dans `packages/character/src/family/humanoid.ts`, ajouter au descripteur :

```ts
  groundRole: 'footL',

  // Les noms de maillages que le résolveur de la tâche 3 cherchera pour savoir
  // quoi teinter. `hairStyle` n'y figure pas : c'est un indice de style, pas
  // une teinte, et rien à colorer ne lui correspond.
  surfaces: {
    skinTone: { aliases: ['Wolf3D_Body', 'Wolf3D_Head', 'skin', 'Body'] },
    hairTone: { aliases: ['Wolf3D_Hair', 'hair', 'Hair'] },
  },
```

et une rampe sur chacun des trois gènes de surface — la validation l'exige de tous, y compris de `hairStyle`, dont la rampe restera inemployée faute de cible :

```ts
    skinTone: {
      group: 'surface', heritability: 0.95, dominance: 0.5, mutationRate: 0.02,
      ramp: ['#f2d6bd', '#4a2c17'],
    },
    hairTone: {
      group: 'surface', heritability: 0.9, dominance: 0.4, mutationRate: 0.03,
      ramp: ['#e8d8a0', '#1a1008'],
    },
    hairStyle: {
      group: 'surface', heritability: 0.2, dominance: 0.5, mutationRate: 0.3,
      ramp: ['#000000', '#ffffff'],
    },
```

- [ ] **Step 10: Ajouter les règles de validation**

Dans `packages/character/src/family/registry.ts`, dans `validateDescriptor`, avant le `return problems` :

```ts
  if (descriptor.groundRole !== undefined && descriptor.bones[descriptor.groundRole] === undefined) {
    problems.push(`groundRole "${descriptor.groundRole}" n'est pas un rôle d'os déclaré`);
  }

  for (const [key, gene] of Object.entries(descriptor.genes)) {
    if (gene.group === 'surface' && gene.ramp === undefined) {
      problems.push(`gène de surface "${key}" : rampe de couleur absente`);
    }
  }
```

- [ ] **Step 11: Donner une rotation aux os de la fixture et du générateur**

Dans `packages/character/test/fixtures/humanoid-binding.ts` et dans `scripts/generate-character-vectors.mjs`, chaque entrée d'os gagne `rotation: [0, 0, 0, 1]` — les deux copies doivent rester identiques, comme le générateur le documente déjà.

- [ ] **Step 12: Lancer la suite complète**

```bash
pnpm --filter @iwsdk/cardinal-character test && pnpm --filter @iwsdk/cardinal-character typecheck
```

Attendu : tout passe. Si `vectors.test.ts` échoue, c'est normal — l'étape suivante régénère.

- [ ] **Step 13: Régénérer les vecteurs dorés**

Le format TSV gagne une colonne : `groundOffsetMeters`. Dans `scripts/generate-character-vectors.mjs`, ajouter `f(c.stats.groundOffsetMeters)` après la hauteur, et l'en-tête correspondant. Adapter `packages/character/test/vectors.test.ts` à la nouvelle colonne.

```bash
pnpm --filter @iwsdk/cardinal-character build && node scripts/generate-character-vectors.mjs
pnpm --filter @iwsdk/cardinal-character test
```

Attendu : suite verte, et une seconde exécution du générateur ne produit aucun diff.

- [ ] **Step 14: Commit**

```bash
git add packages/character scripts/generate-character-vectors.mjs fixtures/character_vectors.tsv
git commit -m "feat(character): declared ground contact, rest rotations, colour ramps

Removes rebindSkeleton: a probe showed recalculating inverse bind matrices
cancels the morphology rather than fixing it, so a field prescribing it was
worse than none."
```

---

### Task 2: Le paquet, et l'applicateur skinné

**En premier, délibérément.** C'est le seul pari de cette étape : le chemin IWSDK → `SkinnedMesh` n'a jamais été exercé dans ce dépôt. Si l'hypothèse est fausse, on l'apprend maintenant.

**Files:**
- Create: `packages/character-three/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- Create: `packages/character-three/src/index.ts`
- Create: `packages/character-three/src/apply/types.ts`
- Create: `packages/character-three/src/apply/SkinnedApplicator.ts`
- Create: `packages/character-three/test/fixtures/skinned-leg.ts`
- Test: `packages/character-three/test/skinned-applicator.test.ts`
- Modify: `package.json` (racine) — chaînes `build`, `test`, `typecheck`

**Interfaces:**
- Consumes: `CompiledCharacter`, `RigBinding` de `@iwsdk/cardinal-character`
- Produces:
  - `interface CharacterApplicator { applyRestPose(c: CompiledCharacter): void; applyMorphs(m: Readonly<Record<string, number>>): void; applySurface(s: Readonly<Record<string, number>>): void; dispose(): void }`
  - `class SkinnedApplicator implements CharacterApplicator` — `constructor(opts: { rigRoot: Object3D; bones: Map<string, Bone>; meshes: SkinnedMesh[]; morphIndex: Readonly<Record<string, number>>; surfaceTargets: Readonly<Record<string, readonly string[]>>; ramps: Readonly<Record<string, readonly [string, string]>> })`

- [ ] **Step 1: Créer le paquet**

`packages/character-three/package.json` :

```json
{
  "name": "@iwsdk/cardinal-character-three",
  "version": "0.1.0",
  "description": "Applique la morphologie compilée à des objets Three, et l'expose en ECS IWSDK",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": { "@iwsdk/core": ">=0.5.0" },
  "devDependencies": {
    "@iwsdk/core": "0.5.3",
    "@types/node": "^22.20.1",
    "elics": "3.4.2",
    "tsup": "^8.5.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  },
  "dependencies": { "@iwsdk/cardinal-character": "workspace:*" },
  "engines": { "node": ">=20.19.0" }
}
```

`tsconfig.json`, `vitest.config.ts` : copier ceux de `packages/character` à l'identique.

`tsup.config.ts` :

```ts
import { defineConfig } from 'tsup';

// `@iwsdk/core` (qui réexporte Three) reste externe : l'application doit
// résoudre une seule instance de Three, sans quoi les `instanceof` cassent.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'browser',
  external: ['@iwsdk/core', 'three', 'elics', '@iwsdk/cardinal-character'],
});
```

Insérer `@iwsdk/cardinal-character-three` dans les trois chaînes du `package.json` racine, **après** `@iwsdk/cardinal-character` et avant `@iwsdk/cardinal-simulation`. Ne rien restructurer d'autre.

- [ ] **Step 2: Écrire la fixture de jambe skinnée**

`packages/character-three/test/fixtures/skinned-leg.ts` :

```ts
import {
  Bone, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial,
  Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3,
} from '@iwsdk/core';

/**
 * Chaîne hanche → genou → cheville, avec un sommet pondéré sur chaque os.
 * C'est la fixture qui a servi à établir, par la mesure, que déplacer un os
 * EST la déformation et que recalculer les matrices inverses l'annule.
 */
export function skinnedLeg() {
  const hip = new Bone(); hip.name = 'Hips';
  const knee = new Bone(); knee.name = 'LeftLeg'; knee.position.set(0, -1, 0);
  const ankle = new Bone(); ankle.name = 'LeftFoot'; ankle.position.set(0, -1, 0);
  hip.add(knee); knee.add(ankle);

  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 0, -2, 0], 3));
  geom.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 2, 0, 0, 0], 4));
  geom.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4));

  const mesh = new SkinnedMesh(geom, new MeshBasicMaterial());
  mesh.add(hip);
  mesh.bind(new Skeleton([hip, knee, ankle]));
  mesh.updateMatrixWorld(true);

  const bones = new Map([['root', hip], ['legL', knee], ['footL', ankle]]);

  /** Position skinnée du sommet `i`, telle que le GPU la calculerait. */
  const vertexAt = (i: number): Vector3 => {
    const v = new Vector3().fromBufferAttribute(geom.getAttribute('position'), i);
    mesh.applyBoneTransform(i, v);
    return v;
  };

  return { mesh, bones, vertexAt };
}
```

- [ ] **Step 3: Écrire le test de l'applicateur**

`packages/character-three/test/skinned-applicator.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import { SkinnedApplicator } from '../src/apply/SkinnedApplicator';
import { skinnedLeg } from './fixtures/skinned-leg';

/** Pose compilée minimale : la cuisse passe de 1 m à 1,5 m. */
function poseAllongee(scaleRoot = 1): CompiledCharacter {
  return {
    family: 'humanoid',
    restPose: [
      { role: 'root', position: [0, 0, 0], scale: scaleRoot },
      { role: 'legL', position: [0, -1.5, 0], scale: 1 },
      { role: 'footL', position: [0, -1, 0], scale: 1 },
    ],
    morphs: {},
    surface: {},
    stats: { nominalHeightMeters: 1.75, groundOffsetMeters: 0 },
  };
}

describe('SkinnedApplicator', () => {
  it('déplace réellement la peau quand un os s allonge', () => {
    const { mesh, bones, vertexAt } = skinnedLeg();
    expect(vertexAt(0).y).toBeCloseTo(-1, 6);

    new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(poseAllongee());

    // C'est LA promesse du projet : le sommet du genou est descendu avec l os.
    expect(vertexAt(0).y).toBeCloseTo(-1.5, 6);
    expect(vertexAt(1).y).toBeCloseTo(-2.5, 6);
  });

  it('n appelle JAMAIS calculateInverses — sinon la déformation s annule', () => {
    const { mesh, bones, vertexAt } = skinnedLeg();
    let appels = 0;
    const vrai = mesh.skeleton.calculateInverses.bind(mesh.skeleton);
    mesh.skeleton.calculateInverses = () => { appels++; vrai(); };

    new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(poseAllongee());

    expect(appels).toBe(0);
    expect(vertexAt(0).y).toBeCloseTo(-1.5, 6);
  });

  it('applique une échelle UNIFORME, jamais par axe', () => {
    const { mesh, bones } = skinnedLeg();
    new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(poseAllongee(0.5));
    const root = bones.get('root')!;
    expect(root.scale.x).toBe(0.5);
    expect(root.scale.y).toBe(0.5);
    expect(root.scale.z).toBe(0.5);
  });

  it('ancre le rig sans toucher au squelette', () => {
    const { mesh, bones } = skinnedLeg();
    const pose = { ...poseAllongee(), stats: { nominalHeightMeters: 1.75, groundOffsetMeters: 2.5 } };
    new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(pose);
    expect(mesh.position.y).toBeCloseTo(2.5, 6);
    expect(bones.get('root')!.position.y).toBeCloseTo(0, 6);
  });

  it('applique une pose de repos en moins de deux millisecondes', () => {
    // Même méthode que le budget du compilateur : médiane sur cent applications
    // et non maximum, parce qu'une machine partagée produit des pics qu'on ne
    // veut pas transformer en test instable.
    const { mesh, bones } = skinnedLeg();
    const a = new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    });
    const pose = poseAllongee();
    for (let i = 0; i < 100; i++) a.applyRestPose(pose); // rodage du JIT

    const durees: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      a.applyRestPose(pose);
      durees.push(performance.now() - t0);
    }
    durees.sort((x, y) => x - y);
    expect(durees[50]!).toBeLessThan(2);
  });

  it('ignore un rôle que la liaison ne connaît pas, sans lever', () => {
    const { mesh, bones, vertexAt } = skinnedLeg();
    const pose = poseAllongee();
    pose.restPose.push({ role: 'queue', position: [0, 5, 0], scale: 1 });
    expect(() => new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(pose)).not.toThrow();
    expect(vertexAt(0).y).toBeCloseTo(-1.5, 6);
  });
});
```

- [ ] **Step 4: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character-three test
```

Attendu : ÉCHEC — `Failed to resolve import "../src/apply/SkinnedApplicator"`.

- [ ] **Step 5: Écrire l'interface**

`packages/character-three/src/apply/types.ts` :

```ts
import type { CompiledCharacter } from '@iwsdk/cardinal-character';

/**
 * Découpé sur la ligne de coût de la spec : ce qui recompile d'un côté, ce qui
 * est continu de l'autre.
 */
export interface CharacterApplicator {
  /** Pose de repos et ancrage. À l'instanciation, jamais par frame. */
  applyRestPose(compiled: CompiledCharacter): void;
  applyMorphs(morphs: Readonly<Record<string, number>>): void;
  applySurface(surface: Readonly<Record<string, number>>): void;
  dispose(): void;
}
```

- [ ] **Step 6: Écrire l'applicateur skinné**

`packages/character-three/src/apply/SkinnedApplicator.ts` :

```ts
import { Color, type Bone, type Object3D, type SkinnedMesh } from '@iwsdk/core';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import type { CharacterApplicator } from './types';

export interface SkinnedApplicatorOptions {
  rigRoot: Object3D;
  /** `Object3D` et non `Bone` : l'applicateur n'écrit que `position` et
   *  `scale`, que tout nœud possède. Exiger un `Bone` forcerait un cast chez
   *  l'appelant sans rien garantir de plus. */
  bones: Map<string, Object3D>;
  meshes: SkinnedMesh[];
  morphIndex: Readonly<Record<string, number>>;
  surfaceTargets: Readonly<Record<string, readonly string[]>>;
  ramps: Readonly<Record<string, readonly [string, string]>>;
}

/**
 * Applique une morphologie compilée à un vrai squelette.
 *
 * DEUX gestes, et un troisième à ne surtout pas faire. Déplacer un os EST la
 * déformation : la peau suit parce que la matrice d'os diffère de la matrice de
 * liaison, ce qui est exactement le travail du skinning. Appeler
 * `skeleton.calculateInverses()` rendrait la pose courante neutre et ANNULERAIT
 * la morphologie — mesuré, pas supposé. Les deux premières rédactions de la
 * conception prescrivaient ce rebake ; elles avaient tort.
 */
export class SkinnedApplicator implements CharacterApplicator {
  private readonly lastMorphs = new Map<string, number>();
  private readonly colour = new Color();

  constructor(private readonly opts: SkinnedApplicatorOptions) {}

  applyRestPose(compiled: CompiledCharacter): void {
    for (const bone of compiled.restPose) {
      const target = this.opts.bones.get(bone.role);
      // Un rôle absent n'est pas une erreur ici : le résolveur a déjà rendu son
      // verdict, et lever maintenant transformerait un import déjà jugé
      // acceptable en plantage à l'instanciation.
      if (target === undefined) continue;
      target.position.set(bone.position[0], bone.position[1], bone.position[2]);
      // Scalaire : une similitude ne cisaille pas, une échelle par axe si.
      target.scale.setScalar(bone.scale);
    }

    this.opts.rigRoot.updateMatrixWorld(true);

    // L'ancrage se pose sur le conteneur, pas sur l'os racine : la morphologie
    // du personnage et l'endroit où il se tient sont deux choses distinctes.
    this.opts.rigRoot.position.y = compiled.stats.groundOffsetMeters;
  }

  applyMorphs(morphs: Readonly<Record<string, number>>): void {
    for (const [key, value] of Object.entries(morphs)) {
      if (this.lastMorphs.get(key) === value) continue;
      const index = this.opts.morphIndex[key];
      if (index === undefined) continue;
      for (const mesh of this.opts.meshes) {
        if (mesh.morphTargetInfluences !== undefined) {
          mesh.morphTargetInfluences[index] = value;
        }
      }
      this.lastMorphs.set(key, value);
    }
  }

  applySurface(surface: Readonly<Record<string, number>>): void {
    for (const [key, value] of Object.entries(surface)) {
      const ramp = this.opts.ramps[key];
      const targets = this.opts.surfaceTargets[key];
      if (ramp === undefined || targets === undefined) continue;
      this.colour.set(ramp[0]).lerp(new Color(ramp[1]), value);
      for (const mesh of this.opts.meshes) {
        if (!targets.includes(mesh.name)) continue;
        const material = mesh.material as { color?: Color };
        material.color?.copy(this.colour);
      }
    }
  }

  dispose(): void {
    // Rien à libérer : cet applicateur ne clone aucun matériau, il écrit dans
    // ceux que l'asset porte déjà. Le clonage par individu appartient à
    // l'étape 3, quand plusieurs villageois partageront un même asset — et
    // c'est là qu'il faudra vraiment disposer quelque chose.
    this.lastMorphs.clear();
  }
}
```

- [ ] **Step 7: Exporter et lancer les tests**

`packages/character-three/src/index.ts` :

```ts
export type { CharacterApplicator } from './apply/types';
export { SkinnedApplicator, type SkinnedApplicatorOptions } from './apply/SkinnedApplicator';
```

```bash
pnpm install
pnpm --filter @iwsdk/cardinal-character build
pnpm --filter @iwsdk/cardinal-character-three test
pnpm --filter @iwsdk/cardinal-character-three typecheck
```

Attendu : 5 tests passants, typecheck propre.

**Si `@iwsdk/core` ne se charge pas sous vitest en environnement `node`**, c'est l'inconnue que cette tâche existe pour lever : rapporter en DONE_WITH_CONCERNS avec le message exact, sans contourner par un mock. Un mock ferait passer le test sans rien prouver de ce qui compte.

- [ ] **Step 8: Commit**

```bash
git add packages/character-three package.json pnpm-lock.yaml
git commit -m "feat(character-three): skinned applicator, proving bone translation deforms skin"
```

---

### Task 3: Le résolveur et son rapport d'import

**Files:**
- Create: `packages/character-three/src/resolve/types.ts`
- Create: `packages/character-three/src/resolve/resolveBinding.ts`
- Test: `packages/character-three/test/resolve.test.ts`
- Modify: `packages/character-three/src/index.ts`

**Interfaces:**
- Consumes: `FamilyDescriptor`, `RigBinding`, `BoneRest` de `@iwsdk/cardinal-character`
- Produces:
  - `interface RigNode { readonly name: string; readonly children: readonly RigNode[]; readonly position: {x,y,z}; readonly quaternion: {x,y,z,w}; readonly morphTargetDictionary?: Readonly<Record<string, number>> }`
  - `interface ImportReport { family: string; matched: Array<{ role: string; nodeName: string; viaAlias: string }>; missingBones: string[]; missingMorphs: string[]; missingSurfaces: string[]; accepted: boolean }`
  - `resolveBinding(family, root: RigNode, restHeightMeters: number): { binding: RigBinding | null; report: ImportReport }`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character-three/test/resolve.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { resolveBinding } from '../src/resolve/resolveBinding';
import type { RigNode } from '../src/resolve/types';

const node = (
  name: string,
  children: RigNode[] = [],
  position = { x: 0, y: 0, z: 0 },
  morphTargetDictionary?: Record<string, number>,
): RigNode => ({
  name, children, position,
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  ...(morphTargetDictionary ? { morphTargetDictionary } : {}),
});

/** Hiérarchie minimale satisfaisant HUMANOID, aux noms Mixamo. */
function rigComplet(): RigNode {
  const p = (y: number) => ({ x: 0, y, z: 0 });
  const hand = (side: string) => node(`mixamorig:${side}Hand`, [], { x: 0.25, y: 0, z: 0 });
  const arm = (side: string) =>
    node(`mixamorig:${side}Shoulder`, [
      node(`mixamorig:${side}Arm`, [
        node(`mixamorig:${side}ForeArm`, [hand(side)], { x: 0.27, y: 0, z: 0 }),
      ], { x: 0.13, y: 0, z: 0 }),
    ], { x: 0.05, y: 0.05, z: 0 });
  const leg = (side: string) =>
    node(`mixamorig:${side}UpLeg`, [
      node(`mixamorig:${side}Leg`, [node(`mixamorig:${side}Foot`, [], p(-0.42))], p(-0.44)),
    ], p(-0.05));

  return node('mixamorig:Hips', [
    node('mixamorig:Spine', [
      node('mixamorig:Spine2', [
        node('mixamorig:Neck', [
          node('mixamorig:Head', [
            node('Wolf3D_Head', [], p(0), { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 }),
          ], p(0.09)),
        ], p(0.16)),
        arm('Left'), arm('Right'),
      ], p(0.14)),
    ], p(0.12)),
    leg('Left'), leg('Right'),
    node('Wolf3D_Body'), node('Wolf3D_Hair'),
  ], p(0.95));
}

describe('resolveBinding — rig complet', () => {
  const { binding, report } = resolveBinding(HUMANOID, rigComplet(), 1.75);

  it('accepte et produit une liaison', () => {
    expect(report.accepted).toBe(true);
    expect(binding).not.toBeNull();
  });

  it('nomme l alias par lequel chaque rôle a matché', () => {
    const head = report.matched.find((m) => m.role === 'head')!;
    expect(head.nodeName).toBe('mixamorig:Head');
    expect(head.viaAlias).toBe('mixamorig:Head');
  });

  it('mesure la position ET la rotation de repos', () => {
    expect(binding!.bones['legL']!.position[1]).toBeCloseTo(-0.44, 6);
    expect(binding!.bones['legL']!.rotation).toEqual([0, 0, 0, 1]);
  });

  it('remonte la parenté par rôle, pas par nom de nœud', () => {
    expect(binding!.bones['footL']!.parentRole).toBe('legL');
    expect(binding!.bones['root']!.parentRole).toBeNull();
  });

  it('résout les index de morphs', () => {
    expect(binding!.morphIndex['jawWidth']).toBe(0);
    expect(binding!.morphIndex['bodyMass']).toBe(4);
  });

  it('reporte la hauteur qu on lui a donnée, sans l inventer', () => {
    expect(binding!.restHeightMeters).toBe(1.75);
  });
});

describe('resolveBinding — rejets et tolérances', () => {
  it('refuse un rig auquel il manque un os de chaîne, en le nommant', () => {
    const casse = rigComplet();
    // On retire l avant-bras gauche en reconstruisant sans lui.
    const sansAvantBras = JSON.parse(JSON.stringify(casse)) as RigNode;
    const strip = (n: RigNode): RigNode => ({
      ...n,
      children: n.children.filter((c) => c.name !== 'mixamorig:LeftForeArm').map(strip),
    });
    const { binding, report } = resolveBinding(HUMANOID, strip(sansAvantBras), 1.75);
    expect(report.accepted).toBe(false);
    expect(binding).toBeNull();
    expect(report.missingBones).toContain('foreArmL');
  });

  it('accepte un rig sans morphs, mais le dit', () => {
    const marionnette = node('mixamorig:Hips', rigComplet().children.map((c) => c));
    const sansMorphs = JSON.parse(JSON.stringify(marionnette)) as RigNode;
    const { report } = resolveBinding(HUMANOID, sansMorphs, 1.75);
    expect(report.missingMorphs.length).toBeGreaterThan(0);
  });

  it('est insensible à la casse des noms de nœuds', () => {
    const bas = JSON.parse(JSON.stringify(rigComplet())) as RigNode;
    const lower = (n: RigNode): RigNode => ({ ...n, name: n.name.toLowerCase(), children: n.children.map(lower) });
    expect(resolveBinding(HUMANOID, lower(bas), 1.75).report.accepted).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character-three test resolve
```

Attendu : ÉCHEC — module absent.

- [ ] **Step 3: Écrire les types**

`packages/character-three/src/resolve/types.ts` :

```ts
/**
 * Contrat structurel minimal, comme `RngLike` l'est pour l'aléatoire : tout
 * `Object3D` le satisfait sans le savoir, et le résolveur reste testable sans
 * navigateur — ce qui est le point, puisque c'est ici que vit la différence
 * entre un asset rejeté proprement et un personnage silencieusement difforme.
 */
export interface RigNode {
  readonly name: string;
  readonly children: readonly RigNode[];
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly quaternion: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  /** Présent sur un maillage porteur de morphs, absent sinon. */
  readonly morphTargetDictionary?: Readonly<Record<string, number>>;
}

export interface ImportReport {
  family: string;
  matched: Array<{ role: string; nodeName: string; viaAlias: string }>;
  missingBones: string[];
  missingMorphs: string[];
  missingSurfaces: string[];
  accepted: boolean;
}
```

- [ ] **Step 4: Écrire le résolveur**

`packages/character-three/src/resolve/resolveBinding.ts` :

```ts
import type { BoneRest, FamilyDescriptor, RigBinding } from '@iwsdk/cardinal-character';
import type { ImportReport, RigNode } from './types';

/** Les rôles sans lesquels un personnage ne peut pas être compilé. */
function requiredRoles(family: FamilyDescriptor): Set<string> {
  const roles = new Set<string>([family.rootRole, family.headRole]);
  if (family.groundRole !== undefined) roles.add(family.groundRole);
  for (const chain of Object.values(family.chains)) {
    roles.add(chain.from);
    roles.add(chain.to);
    if (chain.mirror !== undefined) {
      roles.add(chain.mirror[0]);
      roles.add(chain.mirror[1]);
    }
  }
  return roles;
}

export function resolveBinding(
  family: FamilyDescriptor,
  root: RigNode,
  restHeightMeters: number,
): { binding: RigBinding | null; report: ImportReport } {
  // Index des nœuds par nom minuscule : `mixamorig:Hips` et `mixamorig:hips`
  // désignent le même os selon l'exportateur.
  const byName = new Map<string, { node: RigNode; parent: RigNode | null }>();
  const walk = (node: RigNode, parent: RigNode | null): void => {
    byName.set(node.name.toLowerCase(), { node, parent });
    for (const child of node.children) walk(child, node);
  };
  walk(root, null);

  const report: ImportReport = {
    family: family.id, matched: [], missingBones: [],
    missingMorphs: [], missingSurfaces: [], accepted: false,
  };

  // 1. Les os, par alias, dans l'ordre de préférence du descripteur.
  const nodeOfRole = new Map<string, RigNode>();
  for (const [role, aliases] of Object.entries(family.bones)) {
    const hit = aliases
      .map((alias) => ({ alias, found: byName.get(alias.toLowerCase()) }))
      .find((c) => c.found !== undefined);
    if (hit === undefined) {
      report.missingBones.push(role);
      continue;
    }
    nodeOfRole.set(role, hit.found!.node);
    report.matched.push({ role, nodeName: hit.found!.node.name, viaAlias: hit.alias });
  }

  const required = requiredRoles(family);
  const fatal = report.missingBones.filter((role) => required.has(role));

  // 2. Les morphs : absents, ils sont dits mais ne bloquent pas.
  const morphIndex: Record<string, number> = {};
  for (const [key, def] of Object.entries(family.morphs)) {
    let found = false;
    for (const { node } of byName.values()) {
      const dict = node.morphTargetDictionary;
      if (dict === undefined) continue;
      const alias = def.aliases.find((a) => dict[a] !== undefined);
      if (alias !== undefined) {
        morphIndex[key] = dict[alias]!;
        found = true;
        break;
      }
    }
    if (!found) report.missingMorphs.push(key);
  }

  // 3. Les cibles de surface, sur le même mécanisme d'alias.
  const surfaceTargets: Record<string, readonly string[]> = {};
  for (const [key, gene] of Object.entries(family.genes)) {
    if (gene.group !== 'surface') continue;
    const aliases = family.surfaces?.[key]?.aliases ?? [];
    const hits = aliases
      .map((a) => byName.get(a.toLowerCase())?.node.name)
      .filter((n): n is string => n !== undefined);
    if (hits.length === 0) report.missingSurfaces.push(key);
    else surfaceTargets[key] = hits;
  }

  if (fatal.length > 0) return { binding: null, report };

  // 4. La parenté est exprimée en RÔLES : le nœud parent immédiat peut très
  //    bien n'avoir aucun rôle, il faut remonter jusqu'au premier qui en a un.
  const roleOfNode = new Map<RigNode, string>();
  for (const [role, node] of nodeOfRole) roleOfNode.set(node, role);

  const bones: Record<string, BoneRest> = {};
  for (const [role, node] of nodeOfRole) {
    let parentRole: string | null = null;
    let cursor = byName.get(node.name.toLowerCase())!.parent;
    while (cursor !== null) {
      const found = roleOfNode.get(cursor);
      if (found !== undefined) { parentRole = found; break; }
      cursor = byName.get(cursor.name.toLowerCase())!.parent;
    }
    bones[role] = {
      role,
      position: [node.position.x, node.position.y, node.position.z],
      rotation: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
      parentRole,
    };
  }

  report.accepted = true;
  return { binding: { family: family.id, bones, morphIndex, restHeightMeters }, report };
}
```

`family.surfaces` a été déclaré à la tâche 1 ; il n'y a rien à ajouter au descripteur ici.

- [ ] **Step 5: Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character build
pnpm --filter @iwsdk/cardinal-character-three test resolve
```

Attendu : 9 tests passants.

- [ ] **Step 6: Exporter et commit**

Ajouter à `packages/character-three/src/index.ts` :

```ts
export type { RigNode, ImportReport } from './resolve/types';
export { resolveBinding } from './resolve/resolveBinding';
```

```bash
pnpm --filter @iwsdk/cardinal-character-three typecheck
git add packages/character packages/character-three
git commit -m "feat(character-three): alias resolver with a diagnosable import report"
```

---

### Task 4: L'applicateur marionnette

**Files:**
- Create: `packages/character-three/src/apply/PuppetApplicator.ts`
- Test: `packages/character-three/test/puppet-applicator.test.ts`
- Modify: `packages/character-three/src/index.ts`

**Interfaces:**
- Consumes: `CharacterApplicator` (tâche 2)
- Produces: `class PuppetApplicator implements CharacterApplicator` — `constructor(opts: { rigRoot: Object3D; nodes: Map<string, Object3D>; surfaceTargets; ramps })`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character-three/test/puppet-applicator.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from '@iwsdk/core';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import { PuppetApplicator } from '../src/apply/PuppetApplicator';

function marionnette() {
  const root = new Group(); root.name = 'root';
  const torse = new Group(); torse.name = 'torse'; torse.position.set(0, 0.5, 0);
  const peau = new Mesh(new SphereGeometry(0.1), new MeshStandardMaterial({ color: 0xffffff }));
  peau.name = 'Wolf3D_Body';
  root.add(torse); torse.add(peau);
  return { root, nodes: new Map<string, any>([['root', root], ['legL', torse]]), peau };
}

const pose = (y: number, scale = 1): CompiledCharacter => ({
  family: 'humanoid',
  restPose: [{ role: 'legL', position: [0, y, 0], scale }],
  morphs: { jawWidth: 0.8 },
  surface: { skinTone: 1 },
  stats: { nominalHeightMeters: 1.75, groundOffsetMeters: 0.3 },
});

describe('PuppetApplicator', () => {
  it('écrit la translation sur le nœud nommé', () => {
    const { root, nodes } = marionnette();
    new PuppetApplicator({ rigRoot: root, nodes, surfaceTargets: {}, ramps: {} })
      .applyRestPose(pose(0.9));
    expect(nodes.get('legL')!.position.y).toBeCloseTo(0.9, 6);
  });

  it('applique une échelle uniforme', () => {
    const { root, nodes } = marionnette();
    new PuppetApplicator({ rigRoot: root, nodes, surfaceTargets: {}, ramps: {} })
      .applyRestPose(pose(0.9, 1.4));
    const n = nodes.get('legL')!;
    expect([n.scale.x, n.scale.y, n.scale.z]).toEqual([1.4, 1.4, 1.4]);
  });

  it('ancre sur le conteneur', () => {
    const { root, nodes } = marionnette();
    new PuppetApplicator({ rigRoot: root, nodes, surfaceTargets: {}, ramps: {} })
      .applyRestPose(pose(0.9));
    expect(root.position.y).toBeCloseTo(0.3, 6);
  });

  it('ignore les morphs sans lever : une marionnette n en a pas', () => {
    const { root, nodes } = marionnette();
    const a = new PuppetApplicator({ rigRoot: root, nodes, surfaceTargets: {}, ramps: {} });
    expect(() => a.applyMorphs({ jawWidth: 0.8 })).not.toThrow();
  });

  it('teinte le maillage nommé par la cible de surface', () => {
    const { root, nodes, peau } = marionnette();
    new PuppetApplicator({
      rigRoot: root, nodes,
      surfaceTargets: { skinTone: ['Wolf3D_Body'] },
      ramps: { skinTone: ['#000000', '#ff0000'] },
    }).applySurface({ skinTone: 1 });
    const c = (peau.material as MeshStandardMaterial).color;
    expect(c.r).toBeCloseTo(1, 3);
    expect(c.g).toBeCloseTo(0, 3);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character-three test puppet
```

Attendu : ÉCHEC — module absent.

- [ ] **Step 3: Écrire l'applicateur**

`packages/character-three/src/apply/PuppetApplicator.ts` :

```ts
import { Color, type Object3D } from '@iwsdk/core';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import type { CharacterApplicator } from './types';

export interface PuppetApplicatorOptions {
  rigRoot: Object3D;
  nodes: Map<string, Object3D>;
  surfaceTargets: Readonly<Record<string, readonly string[]>>;
  ramps: Readonly<Record<string, readonly [string, string]>>;
}

/**
 * Applique la même morphologie à une hiérarchie non skinnée — la marionnette
 * que `createRPMAvatar` produit aujourd'hui. Aucune matrice inverse n'entre en
 * jeu : déplacer un nœud déplace ce qui pend dessous, et c'est tout.
 */
export class PuppetApplicator implements CharacterApplicator {
  private readonly colour = new Color();

  constructor(private readonly opts: PuppetApplicatorOptions) {}

  applyRestPose(compiled: CompiledCharacter): void {
    for (const bone of compiled.restPose) {
      const node = this.opts.nodes.get(bone.role);
      if (node === undefined) continue;
      node.position.set(bone.position[0], bone.position[1], bone.position[2]);
      node.scale.setScalar(bone.scale);
    }
    this.opts.rigRoot.updateMatrixWorld(true);
    this.opts.rigRoot.position.y = compiled.stats.groundOffsetMeters;
  }

  /**
   * No-op délibéré : une marionnette n'a pas de morph targets. Le fait a déjà
   * été dit UNE fois, par le résolveur, qui a rempli `missingMorphs` en ne
   * trouvant aucun `morphTargetDictionary`. Le répéter par frame serait du
   * bruit, et lever transformerait un import jugé acceptable en plantage.
   */
  applyMorphs(): void {}

  applySurface(surface: Readonly<Record<string, number>>): void {
    for (const [key, value] of Object.entries(surface)) {
      const ramp = this.opts.ramps[key];
      const targets = this.opts.surfaceTargets[key];
      if (ramp === undefined || targets === undefined) continue;
      this.colour.set(ramp[0]).lerp(new Color(ramp[1]), value);
      this.opts.rigRoot.traverse((node) => {
        if (!targets.includes(node.name)) return;
        const material = (node as { material?: { color?: Color } }).material;
        material?.color?.copy(this.colour);
      });
    }
  }

  dispose(): void {}
}
```

- [ ] **Step 4: Lancer les tests, exporter, commit**

```bash
pnpm --filter @iwsdk/cardinal-character-three test
pnpm --filter @iwsdk/cardinal-character-three typecheck
```

Ajouter à `src/index.ts` :

```ts
export { PuppetApplicator, type PuppetApplicatorOptions } from './apply/PuppetApplicator';
```

```bash
git add packages/character-three
git commit -m "feat(character-three): puppet applicator behind the same interface"
```

---

### Task 5: L'assainissement des clips

**Files:**
- Create: `packages/character-three/src/clips/sanitize.ts`
- Test: `packages/character-three/test/sanitize.test.ts`
- Modify: `packages/character-three/src/index.ts`

**Interfaces:**
- Consumes: `classifyTranslationTrack`, `CONSTANT_TRACK_EPSILON` de `@iwsdk/cardinal-character`
- Produces: `sanitizeClip(clip: AnimationClip, family: FamilyDescriptor, roleOfNode: (name: string) => string | null): { clip: AnimationClip; stripped: string[] }`

- [ ] **Step 1: Écrire le test qui échoue**

`packages/character-three/test/sanitize.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from '@iwsdk/core';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { sanitizeClip } from '../src/clips/sanitize';

const roleOf = (name: string): string | null =>
  ({ Hips: 'root', LeftLeg: 'legL', LeftFoot: 'footL' } as Record<string, string>)[name] ?? null;

/** Réplique de F_Dances_001 : dix-sept pistes de translation, seize constantes. */
function danse(): AnimationClip {
  const t = [0, 0.5, 1];
  const tracks: Array<VectorKeyframeTrack | QuaternionKeyframeTrack> = [
    // La racine bouge réellement : 21 cm mesurés sur le vrai clip.
    new VectorKeyframeTrack('Hips.position', t, [0, 0, 0, 0, 0.21, 0, 0, 0, 0]),
    new QuaternionKeyframeTrack('LeftLeg.quaternion', t, [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  ];
  // Seize pistes constantes, qui réencodent les décalages du rig source.
  for (let i = 0; i < 16; i++) {
    const name = i % 2 === 0 ? 'LeftLeg' : 'LeftFoot';
    tracks.push(new VectorKeyframeTrack(`${name}.position`, t, [0, -1, 0, 0, -1, 0, 0, -1, 0]));
  }
  return new AnimationClip('F_Dances_001', 1, tracks);
}

describe('sanitizeClip', () => {
  it('retire les seize pistes constantes et garde celle des hanches', () => {
    const { clip, stripped } = sanitizeClip(danse(), HUMANOID, roleOf);
    expect(stripped).toHaveLength(16);
    const noms = clip.tracks.map((t) => t.name);
    expect(noms).toContain('Hips.position');
    expect(noms).toContain('LeftLeg.quaternion');
    expect(noms.filter((n) => n.endsWith('.position'))).toHaveLength(1);
  });

  it('ne mute pas le clip d origine', () => {
    const original = danse();
    const avant = original.tracks.length;
    sanitizeClip(original, HUMANOID, roleOf);
    expect(original.tracks).toHaveLength(avant);
  });

  it('rend le MÊME objet pour un clip déjà vu', () => {
    const c = danse();
    expect(sanitizeClip(c, HUMANOID, roleOf).clip).toBe(sanitizeClip(c, HUMANOID, roleOf).clip);
  });

  it('lève quand un os non racine bouge réellement', () => {
    const conflit = new AnimationClip('bancal', 1, [
      new VectorKeyframeTrack('LeftLeg.position', [0, 1], [0, -1, 0, 0, -1.4, 0]),
    ]);
    expect(() => sanitizeClip(conflit, HUMANOID, roleOf)).toThrow('LeftLeg');
  });

  it('laisse passer une piste dont le nœud n a aucun rôle', () => {
    const c = new AnimationClip('accessoire', 1, [
      new VectorKeyframeTrack('Cape.position', [0, 1], [0, 0, 0, 0, 0.5, 0]),
    ]);
    // Sans rôle, la règle la traite comme non racine et variable : elle lève.
    expect(() => sanitizeClip(c, HUMANOID, roleOf)).toThrow('Cape');
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character-three test sanitize
```

Attendu : ÉCHEC — module absent.

- [ ] **Step 3: Écrire l'assainisseur**

`packages/character-three/src/clips/sanitize.ts` :

```ts
import { AnimationClip, type KeyframeTrack } from '@iwsdk/core';
import { classifyTranslationTrack, type FamilyDescriptor } from '@iwsdk/cardinal-character';

/** Mémoïsé par uuid : quarante villageois partagent le même clip source. */
const cache = new WeakMap<AnimationClip, { clip: AnimationClip; stripped: string[] }>();

/** Amplitude maximale sur les trois axes, à travers toutes les clés. */
function amplitude(track: KeyframeTrack): number {
  const v = track.values;
  let span = 0;
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = axis; i < v.length; i += 3) {
      if (v[i]! < min) min = v[i]!;
      if (v[i]! > max) max = v[i]!;
    }
    if (max - min > span) span = max - min;
  }
  return span;
}

/**
 * Retire d'un clip les pistes de translation qui écraseraient la morphologie.
 *
 * Mesuré sur quatre clips réels de readyplayerme/animation-library : seule la
 * racine bouge vraiment. `F_Dances_001` porte dix-sept pistes de translation,
 * dont seize constantes à 10⁻⁶ m près, qui réencodent les décalages d'os du rig
 * source. Elles écraseraient les longueurs compilées mais ne portent aucun
 * mouvement, donc elles partent sans rien coûter.
 *
 * Rend un NOUVEAU clip : les clips arrivent d'un glTF et sont partagés entre
 * toutes les instances ; les amputer sur place assainirait le clip de tout le
 * village depuis le premier personnage.
 */
export function sanitizeClip(
  clip: AnimationClip,
  family: FamilyDescriptor,
  roleOfNode: (nodeName: string) => string | null,
): { clip: AnimationClip; stripped: string[] } {
  const seen = cache.get(clip);
  if (seen !== undefined) return seen;

  const kept: KeyframeTrack[] = [];
  const stripped: string[] = [];

  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) {
      kept.push(track);
      continue;
    }
    const nodeName = track.name.slice(0, -'.position'.length);
    const role = roleOfNode(nodeName);
    const verdict = classifyTranslationTrack(family, {
      boneRole: role ?? '',
      amplitudeMeters: amplitude(track),
    });

    if (verdict === 'keep') kept.push(track);
    else if (verdict === 'strip') stripped.push(track.name);
    else {
      throw new Error(
        `sanitizeClip: le clip "${clip.name}" déplace réellement "${nodeName}", ` +
          `qui n'est pas la racine — incompatible avec une morphologie compilée`,
      );
    }
  }

  const result = { clip: new AnimationClip(clip.name, clip.duration, kept), stripped };
  cache.set(clip, result);
  return result;
}
```

- [ ] **Step 4: Lancer, exporter, commit**

```bash
pnpm --filter @iwsdk/cardinal-character-three test
pnpm --filter @iwsdk/cardinal-character-three typecheck
```

Ajouter à `src/index.ts` :

```ts
export { sanitizeClip } from './clips/sanitize';
```

```bash
git add packages/character-three
git commit -m "feat(character-three): clip sanitiser, memoised and loud on a real conflict"
```

---

### Task 6: Le pont ECS

**Files:**
- Create: `packages/character-three/src/components/index.ts`
- Create: `packages/character-three/src/systems/CharacterCompileSystem.ts`
- Create: `packages/character-three/src/systems/CharacterExpressionSystem.ts`
- Create: `packages/character-three/src/create.ts`
- Test: `packages/character-three/test/components.test.ts`, `packages/character-three/test/compile-system.test.ts`
- Modify: `packages/character-three/src/index.ts`
- Create: `packages/character-three/README.md`

**Interfaces:**
- Consumes: tout ce qui précède
- Produces: `CharacterIdentity`, `CharacterStructure`, `CharacterFace`, `CharacterSurface`, `CharacterSelection`, `CharacterCompileSystem`, `CharacterExpressionSystem`, `installCharacterThree(world)`

- [ ] **Step 1: Écrire le test des composants**

`packages/character-three/test/components.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  CharacterIdentity, CharacterStructure, CharacterFace,
  CharacterSurface, CharacterSelection,
} from '../src/components/index';

describe('composants', () => {
  it('exposent des bornes à l inspecteur pour chaque gène réglable', () => {
    for (const schema of [CharacterStructure.schema, CharacterFace.schema]) {
      for (const [key, field] of Object.entries(schema as Record<string, any>)) {
        expect(field.min, `${key} sans borne basse`).toBe(0);
        expect(field.max, `${key} sans borne haute`).toBe(1);
        expect(field.default).toBe(0.5);
      }
    }
  });

  it('donnent un âge par défaut adulte et une graine rejouable', () => {
    expect(CharacterIdentity.schema.age.default).toBe(25);
    expect(CharacterIdentity.schema.seed.default).toBe(0);
  });

  it('déclarent la sélection comme une entité, pas comme un identifiant', () => {
    expect(CharacterSelection.schema.target).toBeDefined();
  });

  it('portent les teintes en Color, donc en champ vecteur', () => {
    expect(CharacterSurface.schema.skin).toBeDefined();
    expect(CharacterSurface.schema.hair).toBeDefined();
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer, puis écrire les composants**

```bash
pnpm --filter @iwsdk/cardinal-character-three test components
```

`packages/character-three/src/components/index.ts` :

```ts
import { createComponent, Types } from '@iwsdk/core';

const gene = (label: string) => ({
  type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01, label,
});

export const CharacterIdentity = createComponent('CharacterIdentity', {
  family: { type: Types.Enum, enum: ['humanoid'], default: 'humanoid' },
  sex: { type: Types.Enum, enum: ['f', 'm'], default: 'f' },
  age: { type: Types.Float32, default: 25, min: 0, max: 90, step: 0.5, label: 'Âge' },
  seed: { type: Types.Int32, default: 0, help: 'Graine du tirage — rejouable' },
});

/** Modifier un champ ici RECOMPILE le squelette. */
export const CharacterStructure = createComponent('CharacterStructure', {
  stature: gene('Stature'),
  armLength: gene('Longueur de bras'),
  legLength: gene('Longueur de jambe'),
  torsoLength: gene('Longueur de tronc'),
  shoulderWidth: gene("Largeur d'épaules"),
});

/** Modifier un champ ici s'applique à la frame suivante, sans recompiler. */
export const CharacterFace = createComponent('CharacterFace', {
  jawWidth: gene('Mâchoire'),
  noseSize: gene('Nez'),
  eyeScale: gene('Yeux'),
  cheekbone: gene('Pommettes'),
  bodyMass: gene('Corpulence'),
});

export const CharacterSurface = createComponent('CharacterSurface', {
  // Types.Color est un champ VECTEUR : setValue lève dessus en elics 3.4.x,
  // il faut passer par getVectorView.
  skin: { type: Types.Color, default: [0.82, 0.7, 0.55, 1] },
  hair: { type: Types.Color, default: [0.2, 0.13, 0.09, 1] },
});

/** Singleton : une seule cible d'édition, sinon chaque panneau garde la sienne. */
export const CharacterSelection = createComponent('CharacterSelection', {
  target: { type: Types.Entity, default: null },
});
```

- [ ] **Step 3: Écrire le test du système de compilation**

`packages/character-three/test/compile-system.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID, defaultGenome, genomeKey } from '@iwsdk/cardinal-character';
import { genomeFromComponents, needsRecompile } from '../src/systems/CharacterCompileSystem';

describe('genomeFromComponents', () => {
  const base = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, skinTone: 0.8 } };

  it('laisse les composants recouvrir le génome de départ', () => {
    const g = genomeFromComponents(HUMANOID, base, {
      structure: { stature: 0.7, shoulderWidth: 0.9 },
      face: { jawWidth: 0.2 },
    });
    expect(g.genes['stature']).toBe(0.7);
    expect(g.genes['jawWidth']).toBe(0.2);
  });

  it('garde du génome de départ les gènes qu aucun composant n expose', () => {
    // Les gènes de surface n ont pas de champ réglable : CharacterSurface porte
    // des COULEURS, qui sont la sortie de la rampe et non son entrée. Ils ne
    // peuvent donc venir que du génome posé à la création.
    const g = genomeFromComponents(HUMANOID, base, { structure: {}, face: {} });
    expect(g.genes['skinTone']).toBe(0.8);
  });

  it('rend un génome complet, un gène par gène de la famille', () => {
    const g = genomeFromComponents(HUMANOID, base, { structure: {}, face: {} });
    expect(Object.keys(g.genes).sort()).toEqual(Object.keys(HUMANOID.genes).sort());
  });
});

describe('needsRecompile', () => {
  const g = defaultGenome(HUMANOID);
  it('est vrai quand aucune clé n a encore été vue', () => {
    expect(needsRecompile(undefined, genomeKey(HUMANOID, g, 20))).toBe(true);
  });
  it('est faux pour un vieillissement d un jour', () => {
    const a = genomeKey(HUMANOID, g, 20);
    const b = genomeKey(HUMANOID, g, 20 + 1 / 365);
    expect(needsRecompile(a, b)).toBe(false);
  });
  it('est vrai pour un changement de gène', () => {
    const autre = { ...g, genes: { ...g.genes, stature: 0.9 } };
    expect(needsRecompile(genomeKey(HUMANOID, g, 20), genomeKey(HUMANOID, autre, 20))).toBe(true);
  });
});
```

- [ ] **Step 4: Écrire les systèmes**

`packages/character-three/src/systems/CharacterCompileSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import {
  CompileCache, genomeKey, getFamily,
  type FamilyDescriptor, type Genome, type RigBinding,
} from '@iwsdk/cardinal-character';
import { CharacterFace, CharacterIdentity, CharacterStructure, CharacterSurface } from '../components/index';
import type { CharacterApplicator } from '../apply/types';

/**
 * Recouvre le génome de départ par ce que les composants exposent.
 *
 * Les gènes de SURFACE ne sont pas dans cette liste, et c'est délibéré :
 * `CharacterSurface` porte des couleurs, qui sont la sortie de la rampe et non
 * son entrée. Ils ne peuvent donc venir que du génome posé à la création —
 * lequel reste la source de vérité pour tout ce qu'aucun curseur n'expose.
 */
export function genomeFromComponents(
  family: FamilyDescriptor,
  base: Genome,
  parts: { structure: Record<string, number>; face: Record<string, number> },
): Genome {
  const genes: Record<string, number> = {};
  for (const key of Object.keys(family.genes).sort()) {
    genes[key] = parts.structure[key] ?? parts.face[key] ?? base.genes[key] ?? 0.5;
  }
  return { family: family.id, genes };
}

/** Une clé absente veut dire « jamais compilé », donc il faut compiler. */
export function needsRecompile(previous: string | undefined, next: string): boolean {
  return previous !== next;
}

/**
 * Priorité 60 : la forme d'un personnage précède son LOD (90), sa prédiction
 * réseau (100) et sa cognition (115+). Ne travaille que sur changement de clé.
 */
export class CharacterCompileSystem extends createSystem({
  characters: { required: [CharacterIdentity, CharacterStructure, CharacterFace, CharacterSurface] },
}) {
  /** Liaison et applicateur vivent ici, pas dans un composant : ce sont des
   *  états runtime, pas des données d'auteur. Motif d'EntityIndex. */
  public readonly applicators = new Map<number, CharacterApplicator>();
  /** Toutes trois renseignées par `createCharacter`. */
  public readonly bindings = new Map<number, RigBinding>();
  public readonly genomes = new Map<number, Genome>();

  private readonly keys = new Map<number, string>();
  private readonly cache = new CompileCache();
  public compiledCount = 0;

  public override update(): void {
    for (const entity of this.queries.characters.entities) {
      const applicator = this.applicators.get(entity.index);
      const binding = this.bindings.get(entity.index);
      const base = this.genomes.get(entity.index);
      // Une entité sans les trois n'a pas été créée par `createCharacter` :
      // on la laisse tranquille plutôt que de deviner.
      if (applicator === undefined || binding === undefined || base === undefined) continue;

      const family = getFamily(entity.getValue(CharacterIdentity, 'family') ?? 'humanoid');
      const age = entity.getValue(CharacterIdentity, 'age') ?? 25;
      const genome = genomeFromComponents(family, base, {
        structure: readGroup(entity, CharacterStructure),
        face: readGroup(entity, CharacterFace),
      });

      const key = genomeKey(family, genome, age);
      if (!needsRecompile(this.keys.get(entity.index), key)) continue;
      this.keys.set(entity.index, key);

      applicator.applyRestPose(this.cache.get(family, genome, age, binding));
      this.compiledCount++;
    }
  }
}

/** Lit tous les champs numériques d'un composant en un objet plat. */
function readGroup(
  entity: { getValue: (c: never, f: string) => number | undefined },
  component: { schema: Record<string, unknown> },
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(component.schema)) {
    const value = entity.getValue(component as never, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}
```

`packages/character-three/src/systems/CharacterExpressionSystem.ts` :

```ts
import { createSystem } from '@iwsdk/core';
import { getFamily } from '@iwsdk/cardinal-character';
import { CharacterFace, CharacterIdentity, CharacterSurface } from '../components/index';
import { CharacterCompileSystem } from './CharacterCompileSystem';

/**
 * Priorité 70 : les canaux continus, écrits chaque frame mais seulement quand
 * ils ont changé. Les applicateurs mémorisent la dernière valeur écrite.
 */
export class CharacterExpressionSystem extends createSystem({
  characters: { required: [CharacterIdentity, CharacterFace, CharacterSurface] },
}) {
  public override update(): void {
    const compiler = this.world.getSystem(CharacterCompileSystem) as CharacterCompileSystem | undefined;
    if (compiler === undefined) return;

    for (const entity of this.queries.characters.entities) {
      const applicator = compiler.applicators.get(entity.index);
      if (applicator === undefined) continue;

      const family = getFamily(entity.getValue(CharacterIdentity, 'family') ?? 'humanoid');
      const morphs: Record<string, number> = {};
      for (const key of Object.keys(family.morphs)) {
        const v = entity.getValue(CharacterFace, key);
        if (v !== undefined) morphs[key] = v;
      }
      applicator.applyMorphs(morphs);
    }
  }
}
```

- [ ] **Step 5: Écrire la fabrique et l'installation**

`packages/character-three/src/create.ts` :

```ts
import { Box3, Vector3, type Object3D, type World } from '@iwsdk/core';
import { getFamily, type Genome } from '@iwsdk/cardinal-character';
import { resolveBinding } from './resolve/resolveBinding';
import type { ImportReport } from './resolve/types';
import { SkinnedApplicator } from './apply/SkinnedApplicator';
import { PuppetApplicator } from './apply/PuppetApplicator';
import { CharacterFace, CharacterIdentity, CharacterStructure, CharacterSurface } from './components/index';
import { CharacterCompileSystem } from './systems/CharacterCompileSystem';

export interface CreateCharacterOptions {
  familyId: string;
  genome: Genome;
  age: number;
  rigRoot: Object3D;
}

/**
 * Le seul chemin d'entrée. Mesure la boîte englobante de l'asset ENTIER dans sa
 * pose de repos, avant toute morphologie — c'est la hauteur de référence que le
 * génome module ensuite.
 */
export function createCharacter(
  world: World,
  options: CreateCharacterOptions,
): { entity: ReturnType<World['createTransformEntity']>; report: ImportReport } {
  const family = getFamily(options.familyId);
  // Boîte englobante de l'asset ENTIER dans sa pose de repos, avant toute
  // morphologie : c'est la hauteur de référence que le génome module ensuite.
  const height = new Box3().setFromObject(options.rigRoot).getSize(new Vector3()).y;
  const { binding, report } = resolveBinding(family, options.rigRoot as never, height);

  const entity = world.createTransformEntity(options.rigRoot);
  if (binding === null) return { entity, report };

  const bones = new Map<string, Object3D>();
  options.rigRoot.traverse((node) => {
    const match = report.matched.find((m) => m.nodeName === node.name);
    if (match !== undefined) bones.set(match.role, node);
  });

  const meshes: any[] = [];
  options.rigRoot.traverse((node) => {
    if ((node as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) meshes.push(node);
  });

  const ramps: Record<string, readonly [string, string]> = {};
  for (const [key, gene] of Object.entries(family.genes)) {
    if (gene.group === 'surface' && gene.ramp !== undefined) ramps[key] = gene.ramp;
  }

  const surfaceTargets: Record<string, readonly string[]> = {};
  for (const key of Object.keys(ramps)) {
    const aliases = family.surfaces?.[key]?.aliases ?? [];
    const hits: string[] = [];
    options.rigRoot.traverse((n) => { if (aliases.includes(n.name)) hits.push(n.name); });
    if (hits.length > 0) surfaceTargets[key] = hits;
  }

  // Le choix se fait sur ce qu'on a TROUVÉ, pas sur une option : un asset qui
  // porte un SkinnedMesh est skinné, point.
  const applicator =
    meshes.length > 0
      ? new SkinnedApplicator({
          rigRoot: options.rigRoot, bones, meshes,
          morphIndex: binding.morphIndex, surfaceTargets, ramps,
        })
      : new PuppetApplicator({ rigRoot: options.rigRoot, nodes: bones, surfaceTargets, ramps });

  entity.addComponent(CharacterIdentity, { family: family.id, age: options.age });
  entity.addComponent(CharacterStructure, {});
  entity.addComponent(CharacterFace, {});
  entity.addComponent(CharacterSurface, {});

  const compiler = world.getSystem(CharacterCompileSystem) as CharacterCompileSystem;
  compiler.applicators.set(entity.index, applicator);
  compiler.bindings.set(entity.index, binding);
  compiler.genomes.set(entity.index, options.genome);

  return { entity, report };
}

export function installCharacterThree(world: World): void {
  world
    .registerComponent(CharacterIdentity)
    .registerComponent(CharacterStructure)
    .registerComponent(CharacterFace)
    .registerComponent(CharacterSurface);
  world.registerSystem(CharacterCompileSystem, { priority: 60 });
  world.registerSystem(CharacterExpressionSystem, { priority: 70 });
}
```

Ajouter l'import de `CharacterExpressionSystem` en tête.

- [ ] **Step 6: Écrire le README**

`packages/character-three/README.md` :

````markdown
# @iwsdk/cardinal-character-three

Applique la morphologie compilée par `@iwsdk/cardinal-character` à de vrais
objets Three, et l'expose en composants et systèmes ECS d'IWSDK.

## La règle qui gouverne tout

> **Déplacer un os EST la déformation. On n'appelle jamais
> `skeleton.calculateInverses()`.**

Ce n'est pas une préférence, c'est une mesure. Sur une chaîne
hanche → genou → cheville, avec un sommet pondéré au genou :

| Geste | genou | cheville |
| :--- | ---: | ---: |
| repos | −1,000 | −2,000 |
| cuisse allongée, sans rebake | **−1,500** | **−2,500** |
| …puis `calculateInverses()` | −1,000 | −2,000 |
| + rotation de clip sur le genou | −1,500 | −1,500 |

La peau suit l'os parce que la matrice d'os diffère de la matrice de liaison —
c'est le travail du skinning. Recalculer les inverses rend la pose courante
neutre et **annule** la morphologie.

La quatrième ligne porte l'autre moitié : une rotation de clip laisse la cuisse
allongée intacte. C'est pourquoi `sanitizeClip` retire les pistes de *position*
sur les os non racines — sans quoi elles écraseraient la longueur du membre à
chaque image.

## Deux applicateurs, une interface

`SkinnedApplicator` écrit dans un `Skeleton`. `PuppetApplicator` écrit dans des
`Object3D` nommés, pour les hiérarchies non skinnées. `createCharacter` choisit
selon ce que l'asset porte réellement, pas selon une option.

## Usage

```ts
import { installCharacterThree, createCharacter } from '@iwsdk/cardinal-character-three';
import { HUMANOID, createGenome } from '@iwsdk/cardinal-character';

installCharacterThree(world);

const { entity, report } = createCharacter(world, {
  familyId: 'humanoid',
  genome: createGenome(HUMANOID, rng),
  age: 34,
  rigRoot: assetInstance,
});

if (!report.accepted) {
  console.error('rig refusé, os manquants :', report.missingBones);
}
```

## Le rapport d'import

`resolveBinding` dit **par quel alias** chaque rôle a matché, et ce qui manque.
Un os nommé par une chaîne est structurel : son absence refuse l'asset. Un morph
absent ne bloque pas, mais figure au rapport — un asset ne se dégrade jamais en
silence.
````

- [ ] **Step 7: Lancer tout, commit**

```bash
pnpm --filter @iwsdk/cardinal-character-three test
pnpm --filter @iwsdk/cardinal-character-three typecheck
pnpm --filter @iwsdk/cardinal-character-three build
git add packages/character-three
git commit -m "feat(character-three): ECS components, two systems, and one entry point"
```

---

### Task 7: Les dettes adjacentes

La spec amont §14 les promettait ; elles n'avaient pas de sens avant qu'il y ait des systèmes à ordonner.

**Files:**
- Modify: `packages/world/src/install.ts`
- Modify: `apps/demo/src/index.ts`
- Modify: `packages/ai/src/plugin.ts`
- Modify: `packages/ai/src/ui/UIKitMLTemplateBuilder.ts`
- Test: `packages/ai/test/uikitml-template.test.ts`

- [ ] **Step 1: Déclarer les priorités manquantes**

Dans `packages/world/src/install.ts`, donner une priorité explicite à chacun des systèmes enregistrés, dans une bande **10 à 50**, en amont des personnages (60) :

```ts
  world.registerSystem(CelestialTimeSystem, { priority: 10 });
  world.registerSystem(SkyRenderSystem, { priority: 12, configData: { quality } });
  world.registerSystem(StarFieldSystem, { priority: 14 });
  world.registerSystem(ExposureSystem, { priority: 16 });
  world.registerSystem(MaterialSystem, { priority: 20, configData: { library: materials } });
  world.registerSystem(TerrainStreamingSystem, { priority: 30, configData: { material: terrainMaterial } });
  world.registerSystem(TerrainMeshSystem, { priority: 32 });
  world.registerSystem(WaterSystem, { priority: 34 });
  world.registerSystem(FloraSystem, {
    priority: 36,
    configData: {
      assets: null,
      barkMaterial: materials.get('bark'),
      leafMaterial: materials.get('foliage'),
    },
  });
  world.registerSystem(SmartObjectVisualSystem, { priority: 40 });
  world.registerSystem(FaunaSystem, { priority: 42 });
```

Dans `apps/demo/src/index.ts`, faire de même pour `RobotSystem`, `PanelSystem`, `PhysicsSimulationSystem` et `CardinalSimulationSystem` — bande **50 à 58**, avant les personnages.

- [ ] **Step 2: Lever la collision à 120**

Dans `packages/ai/src/plugin.ts`, `AISystemPriority.GAZE_IK` passe de `120` à `121`, avec un commentaire :

```ts
  // 121 et non 120 : NetworkInterpolationSystem occupe déjà 120, et deux
  // systèmes à la même priorité s'ordonnent selon l'ordre d'installation des
  // plugins, ce qui n'est pas une décision.
  GAZE_IK: 121,
```

- [ ] **Step 3: Corriger les unités du template UIKitML**

`packages/ai/src/ui/UIKitMLTemplateBuilder.ts` écrit `width: 320px`, `padding: 16px`, `font-size: 16px`. **Les tailles UIKitML sont en centimètres** : cela produit une bulle de 3,2 mètres avec du texte de 16 cm. Remplacer par des valeurs en centimètres — `width: 32`, `padding: 1.6`, `font-size: 1.6` — et retirer toutes les unités `px` du fichier.

Ajouter à `packages/ai/test/uikitml-template.test.ts` :

```ts
  it('n emploie aucune unité px : UIKitML compte en centimètres', () => {
    const xml = UIKitMLTemplateBuilder.buildSpeechBubble({ npcName: 'Test' });
    expect(xml).not.toMatch(/\d+px/);
  });
```

- [ ] **Step 4: Vérifier et commit**

```bash
pnpm --filter @iwsdk/plugin-cardinal-ai test
pnpm --filter @iwsdk/cardinal-world typecheck
pnpm --filter @iwsdk/plugin-phoenix-demo typecheck
git add packages/world packages/ai apps/demo
git commit -m "fix: declare the eleven missing system priorities and un-collide gaze IK

Also corrects UIKitMLTemplateBuilder's pixel units: UIKitML counts in
centimetres, so 320px was a 3.2 metre speech bubble."
```

---

## Vérification de fin d'étape

- [ ] **La suite complète du dépôt passe**

```bash
pnpm build && NODE_OPTIONS=--experimental-strip-types pnpm test
```

`pnpm build` d'abord : `cardinal-world` importe le `dist/` de `cardinal-simulation`, et le générateur de vecteurs importe celui de `cardinal-character`. Le flag Node contourne un défaut préexistant du dépôt.

- [ ] **`calculateInverses` n'apparaît nulle part en production**

```bash
grep -rn "calculateInverses" packages/*/src apps/*/src || echo "absent des sources: OK"
```

Attendu : absent. Sa seule occurrence légitime est le test de la tâche 2 qui vérifie qu'on ne l'appelle pas.

- [ ] **Aucun import direct de `three`**

```bash
grep -rn "from 'three'" packages/character-three/src && echo "ÉCHEC" || echo "OK"
```

## Ce que cette étape ne livre pas

Le remplacement d'`AgentAvatarFactory`, le chargement des clips au manifeste et l'affichage d'un villageois réellement morphologique dans la démo appartiennent à l'étape 3. Ce plan livre le paquet et ses garanties, pas la scène.
