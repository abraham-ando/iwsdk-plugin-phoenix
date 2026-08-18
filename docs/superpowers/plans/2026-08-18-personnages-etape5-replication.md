# Étape 5 — Réplication du génome : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** déclarer `CharacterGenome` au schéma Cardinal, poser le composant sur les onze villageois pour que le mécanisme générique de réplication le porte entre pairs, et prouver — par une divergence forcée, pas par une coïncidence — que le mécanisme fonctionne.

**Architecture :** un composant Cardinal à un seul champ (`genes: array<u8,13>`), généré par l'infrastructure existante ; une table fixe d'identifiants réseau pour les onze villageois, sur le patron déjà en production de la plante partagée ; publication et réception entièrement automatiques, sans code applicatif dédié, une fois le composant posé sur une entité `Networked`.

**Tech Stack :** TypeScript 5.9, Elixir/Phoenix, Node 22.12 avec `--experimental-strip-types`, pnpm workspace, vitest.

**Spec :** `docs/superpowers/specs/2026-08-18-personnages-etape5-replication-design.md`

## Global Constraints

- **Un gène est un octet (`u8`)**, jamais un flottant.
- **L'ordre des treize gènes est l'ordre alphabétique** de `HUMANOID.genes` : `armLength, bodyMass, cheekbone, eyeScale, hairStyle, hairTone, jawWidth, legLength, noseSize, shoulderWidth, skinTone, stature, torsoLength`.
- **Le génome se transmet une fois, à l'apparition.** Jamais de `setValue` sur `CharacterGenome` après la création.
- **Cette réplication ne fonctionne qu'en mode `host_relayed`** (le défaut de la démo). Documenté comme limite, pas résolu.
- **Jamais de fichier `*.generated.*` édité à la main.** `cardinal/components.mjs` est la seule source ; `node --experimental-strip-types scripts/generate-cardinal.mjs` produit le reste.
- **`entity.getVectorView(...)`, jamais `setValue`**, pour le champ `genes` — 13 slots.
- **Three s'importe depuis `@iwsdk/core`**, jamais depuis `three`.
- **Commentaires en français**, descriptions de tests comprises.
- Avant chaque commit : les tests du paquet touché, `pnpm typecheck`, `pnpm build`.

---

## Structure des fichiers

| fichier | responsabilité |
| :--- | :--- |
| `scripts/check-cardinal-drift.mjs` | **modifié** — un flag ajouté à l'appel du générateur |
| `cardinal/components.mjs` | **modifié** — `CharacterGenome`, id 4 |
| `packages/client/src/cardinal/{codecs,components}.generated.ts` | **régénérés** |
| `packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex` | **régénéré** |
| `fixtures/cardinal_vectors.tsv` | **régénéré** |
| `packages/character-three/src/wire.ts` | **créé** — `genomeToBytes`/`bytesToGenome` |
| `apps/demo/src/simulation/villagerNetworkIds.ts` | **créé** — `VILLAGER_NETWORK_IDS` |
| `apps/demo/src/index.ts` | **modifié** — câblage dans `buildRig` |
| `apps/demo/test/villager-network-ids.test.ts` | **créé** |
| `packages/character-three/test/wire.test.ts` | **créé** |
| `apps/demo/test/character-genome-replication.test.ts` | **créé** — la preuve de divergence forcée |

---

## Task 1 : Réparer `pnpm test` racine

**Ce n'est pas un bug à corriger — c'est un flag manquant, déjà documenté ailleurs dans ce dépôt et déjà mesuré empiriquement.** `scripts/generate-cardinal.mjs` importe dynamiquement son propre fichier `.ts` généré (`codecs.generated.ts`) pour encoder les vecteurs dorés avec le codec qui expédie réellement. Node 22.12 ne charge pas un `.ts` sans `--experimental-strip-types`. Le script s'enregistre déjà lui-même le hook de résolution nécessaire (`scripts/ts-resolve-hook.mjs`, via `register(...)` en tête de fichier) — il ne manque que le flag d'exécution.

**Files :**
- Modify: `scripts/check-cardinal-drift.mjs:32`

**Interfaces :**
- Consumes : rien.
- Produces : `pnpm test` (racine) tourne jusqu'au bout.

- [ ] **Step 1 : Constater la panne telle quelle**

```bash
node scripts/check-cardinal-drift.mjs
```

Expected : `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"`.

- [ ] **Step 2 : Le correctif — un seul flag**

Dans `scripts/check-cardinal-drift.mjs`, ligne 32, remplacer :

```js
  execFileSync('node', ['scripts/generate-cardinal.mjs'], {
```

par :

```js
  // Le générateur importe dynamiquement son propre .ts généré pour encoder
  // les vecteurs dorés avec le codec qui expédie réellement. Node 22.12 ne
  // charge pas un .ts sans ce flag ; le hook de résolution des imports `.js`
  // internes s'enregistre déjà tout seul (voir generate-cardinal.mjs).
  execFileSync('node', ['--experimental-strip-types', 'scripts/generate-cardinal.mjs'], {
```

- [ ] **Step 3 : Vérifier**

```bash
node scripts/check-cardinal-drift.mjs
```

Expected : `check-cardinal-drift: OK (generated artifacts match the schema)` — les artefacts déjà commités ne dérivent pas, ce correctif ne fait que réparer l'outil de vérification lui-même.

```bash
pnpm test
```

Expected : la chaîne continue au-delà de `check-cardinal-drift.mjs`. Elle peut encore échouer plus loin pour d'autres raisons — seul ce maillon-ci est dans le périmètre de cette tâche.

- [ ] **Step 4 : Commiter**

```bash
git add scripts/check-cardinal-drift.mjs
git commit -m "fix(scripts): strip types when re-invoking the Cardinal generator"
```

---

## Task 2 : Déclarer `CharacterGenome`, régénérer

**Ceci sera le premier champ `array` jamais utilisé dans ce schéma.** Le générateur le gère déjà (`fieldSize`/`fieldSlots` dans `cardinal/types.mjs`, les branches TS/Elixir dans `scripts/generate-cardinal.mjs`), et une sonde a confirmé que la génération produit un résultat correct dès le premier essai — mais aucun composant réel ne l'avait exercé avant cette tâche.

**Files :**
- Modify: `cardinal/components.mjs`
- Regenerate: `packages/client/src/cardinal/codecs.generated.ts`, `packages/client/src/cardinal/components.generated.ts`, `packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex`, `fixtures/cardinal_vectors.tsv`
- Test: `packages/client/test/cardinal-character-genome.test.ts` (créé)

**Interfaces :**
- Consumes : rien.
- Produces :
  - `CharacterGenome` — composant ECS elics, champ `genes: Types.Int32` à 13 slots, exporté depuis `@iwsdk/plugin-phoenix`.
  - `CARDINAL_CODECS.get(4)` — `{ id: 4, name: 'CharacterGenome', bytes: 13, fields: [{ name: 'genes', slots: 13 }], encode, decode }`.

- [ ] **Step 1 : Déclarer le composant**

Dans `cardinal/components.mjs`, ajouter à la fin du tableau `components` (après `Weather`, id 3) :

```js
  {
    id: 4,
    name: 'CharacterGenome',
    fields: [
      // Un octet par gène — 256 pas sur [0,1], très en deçà du seuil de
      // perception sur une largeur d'épaules (spec §10.2 de la spec mère).
      // Ordre : l'ordre ALPHABÉTIQUE des clés de HUMANOID.genes, celui que
      // `createGenome()` applique déjà — ne pas en inventer un autre.
      { name: 'genes', type: 'array', of: 'u8', length: 13 },
    ],
  },
```

- [ ] **Step 2 : Régénérer**

```bash
node --experimental-strip-types scripts/generate-cardinal.mjs
```

Expected : quatre fichiers réécrits — `codecs.generated.ts`, `components.generated.ts`, `components.generated.ex`, `fixtures/cardinal_vectors.tsv`.

- [ ] **Step 3 : Écrire les tests**

Create `packages/client/test/cardinal-character-genome.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { CARDINAL_CODECS } from '../src/cardinal/codecs.generated';

describe('le composant CharacterGenome généré', () => {
  it('occupe treize octets, un par gène', () => {
    const codec = CARDINAL_CODECS.get(4)!;
    expect(codec.name).toBe('CharacterGenome');
    expect(codec.bytes).toBe(13);
    expect(codec.fields).toEqual([{ name: 'genes', slots: 13 }]);
  });

  it('encode et décode treize octets sans perte, aux deux bornes', () => {
    const codec = CARDINAL_CODECS.get(4)!;
    const buffer = new ArrayBuffer(13);
    const view = new DataView(buffer);
    const genes = [0, 255, 128, 1, 254, 0, 255, 64, 192, 0, 255, 127, 128];
    codec.encode(view, 0, { genes });
    const decoded = codec.decode(view, 0);
    expect(decoded.genes).toEqual(genes);
  });

  it('l ordre des octets est l ordre alphabétique de HUMANOID.genes', () => {
    // Le contrat est documenté, pas seulement supposé : ce test l'encode en
    // dur pour qu'un futur ajout de gène qui casse l'ordre soit vu ici.
    const ordreAttendu = [
      'armLength', 'bodyMass', 'cheekbone', 'eyeScale', 'hairStyle',
      'hairTone', 'jawWidth', 'legLength', 'noseSize', 'shoulderWidth',
      'skinTone', 'stature', 'torsoLength',
    ];
    expect(ordreAttendu.length).toBe(13);
    // La preuve que CET ordre est bien celui du composant vient du test de
    // conversion (Task 3), qui encode un Genome nommé et vérifie l'octet à
    // l'index attendu — ce test-ci fixe la liste de référence.
  });

  it('un tableau plus court complète à zéro, jamais undefined', () => {
    const codec = CARDINAL_CODECS.get(4)!;
    const buffer = new ArrayBuffer(13);
    const view = new DataView(buffer);
    codec.encode(view, 0, { genes: [10, 20] });
    const decoded = codec.decode(view, 0) as { genes: number[] };
    expect(decoded.genes[2]).toBe(0);
    expect(decoded.genes.length).toBe(13);
  });
});
```

- [ ] **Step 4 : Lancer**

```bash
pnpm --filter @iwsdk/plugin-phoenix test cardinal-character-genome
```

Expected : PASS, 4 tests.

- [ ] **Step 5 : Vérifier la parité Elixir**

```bash
cd packages/server && mix test test/cardinal_components_test.exs 2>&1 | tail -20
```

Si ce fichier de test n'existe pas encore ou ne couvre pas la parité générique par composant, ce n'est pas à créer dans cette tâche — la suite Elixir existante doit simplement continuer à passer avec le nouveau composant présent.

- [ ] **Step 6 : Régénérer les vecteurs dorés et vérifier l'absence de drift**

```bash
node scripts/check-cardinal-drift.mjs
```

Expected : `OK`.

- [ ] **Step 7 : Commiter**

```bash
git add cardinal/components.mjs packages/client/src/cardinal packages/server/lib/iwsdk_phoenix/cardinal fixtures/cardinal_vectors.tsv packages/client/test/cardinal-character-genome.test.ts
git commit -m "feat(cardinal): declare CharacterGenome, the first array-typed component"
```

---

## Task 3 : Identifiants réseau fixes, et la conversion Genome↔octets

**Files :**
- Create: `apps/demo/src/simulation/villagerNetworkIds.ts`
- Create: `apps/demo/test/villager-network-ids.test.ts`
- Create: `packages/character-three/src/wire.ts`
- Create: `packages/character-three/test/wire.test.ts`
- Modify: `packages/character-three/src/index.ts`

**Interfaces :**
- Consumes : `HUMANOID`, `type Genome` de `@iwsdk/cardinal-character` ; `SHARED_PLANT_ID` de `apps/demo/src/multiplayer.ts` (déjà exporté — vérifier, sinon l'exporter dans cette tâche).
- Produces :
  - `VILLAGER_NETWORK_IDS: Readonly<Record<string, number>>`
  - `function genomeToBytes(genome: Genome): number[]`
  - `function bytesToGenome(family: FamilyDescriptor, bytes: readonly number[]): Genome`

- [ ] **Step 1 : Vérifier que `SHARED_PLANT_ID` est exporté**

```bash
grep -n "export const SHARED_PLANT_ID" apps/demo/src/multiplayer.ts
```

S'il ne l'est pas déjà, ajouter `export` devant sa déclaration — un changement d'une ligne, sans effet sur le comportement existant.

- [ ] **Step 2 : Écrire le test des identifiants réseau**

Create `apps/demo/test/villager-network-ids.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_VILLAGE } from '@iwsdk/cardinal-simulation';
import { SHARED_PLANT_ID } from '../src/multiplayer';
import { VILLAGER_NETWORK_IDS } from '../src/simulation/villagerNetworkIds';

describe('les identifiants réseau des villageois', () => {
  it('couvre exactement les onze agents du village', () => {
    const attendus = DEFAULT_VILLAGE.agents.map((a) => a.id).sort();
    expect(Object.keys(VILLAGER_NETWORK_IDS).sort()).toEqual(attendus);
  });

  it('sont tous uniques entre eux', () => {
    const valeurs = Object.values(VILLAGER_NETWORK_IDS);
    expect(new Set(valeurs).size).toBe(valeurs.length);
  });

  it('ne collisionnent jamais avec SHARED_PLANT_ID', () => {
    expect(Object.values(VILLAGER_NETWORK_IDS)).not.toContain(SHARED_PLANT_ID);
  });

  it('restent dans le positif Int32, comme l exige le protocole', () => {
    for (const id of Object.values(VILLAGER_NETWORK_IDS)) {
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThan(2_147_483_647);
    }
  });
});
```

- [ ] **Step 3 : Lancer pour voir échouer**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo test villager-network-ids`
Expected : ÉCHEC — le module n'existe pas.

- [ ] **Step 4 : Écrire la table**

Create `apps/demo/src/simulation/villagerNetworkIds.ts` :

```ts
/**
 * Identifiants réseau fixes des onze villageois — patron d'`adoptSharedPlant`
 * (`multiplayer.ts`) : chaque pair crée déjà ce personnage localement et de
 * façon identique, il ne lui manque qu'une identité réseau CONNUE D'AVANCE.
 * Pas de SPAWN_ENTITY dynamique, pas d'ownership à arbitrer.
 *
 * Table explicite plutôt qu'un hachage : onze noms fixes et connus se
 * déclarent directement, ce qui est plus sûr et plus lisible qu'une fonction
 * dont il faudrait prouver l'absence de collision.
 *
 * Plage réservée à partir de 100_010 — au-dessus de SHARED_PLANT_ID
 * (100_001), avec neuf identifiants de marge pour tout objet fixe futur qui
 * s'intercalerait sans forcer une renumérotation. Loin au-dessus de ce que
 * `IdAllocator.local/0` (le compteur séquentiel des joueurs) atteindra
 * jamais en pratique — la même convention manuelle que la plante.
 */
export const VILLAGER_NETWORK_IDS: Readonly<Record<string, number>> = {
  haran: 100_010, mira: 100_011, lio: 100_012, aya: 100_013,
  dagan: 100_014, sira: 100_015, nia: 100_016, kan: 100_017,
  narek: 100_018, ivan: 100_019, tao: 100_020,
};
```

- [ ] **Step 5 : Lancer et vérifier**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo test villager-network-ids`
Expected : PASS, 4 tests.

- [ ] **Step 6 : Écrire les tests de conversion**

Create `packages/character-three/test/wire.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID, createGenome, type RngLike } from '@iwsdk/cardinal-character';
import { genomeToBytes, bytesToGenome } from '../src/wire';

function rng(graine: number): RngLike {
  let etat = graine || 1;
  return { next: () => ((etat = (etat * 1664525 + 1013904223) >>> 0) / 4294967296) };
}

describe('la conversion Genome ↔ octets', () => {
  it('produit treize octets, un par gène', () => {
    const genome = createGenome(HUMANOID, rng(1));
    const octets = genomeToBytes(genome);
    expect(octets.length).toBe(13);
    for (const o of octets) {
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(255);
    }
  });

  it('l octet à l index attendu correspond au bon gène, dans l ordre alphabétique', () => {
    // stature est le douzième gène de la liste alphabétique (index 11).
    const genome = createGenome(HUMANOID, rng(2));
    const octets = genomeToBytes(genome);
    const attendu = Math.round(genome.genes['stature']! * 255);
    expect(octets[11]).toBe(attendu);
  });

  it('round-trip à un pas de quantification près (256 pas sur [0,1])', () => {
    const genome = createGenome(HUMANOID, rng(3));
    const revenu = bytesToGenome(HUMANOID, genomeToBytes(genome));
    for (const cle of Object.keys(HUMANOID.genes)) {
      expect(revenu.genes[cle]).toBeCloseTo(genome.genes[cle]!, 2);
    }
  });

  it('un tableau incomplet en entrée ne lève pas — complète à 0.5', () => {
    // Défensif : un pair qui reçoit un COMPONENT_UPDATE d'un schéma plus
    // ancien ne doit pas planter sur un tableau tronqué.
    const genome = bytesToGenome(HUMANOID, [128, 128]);
    expect(genome.family).toBe(HUMANOID.id);
    expect(Object.keys(genome.genes).length).toBe(13);
  });
});
```

- [ ] **Step 7 : Lancer pour voir échouer**

Run : `pnpm --filter @iwsdk/cardinal-character-three test wire`
Expected : ÉCHEC — `../src/wire` n'existe pas.

- [ ] **Step 8 : Écrire la conversion**

Create `packages/character-three/src/wire.ts` :

```ts
import { HUMANOID, type Genome, type FamilyDescriptor } from '@iwsdk/cardinal-character';

/** Les treize gènes, dans l'ordre alphabétique — le même que createGenome(). */
function orderedGeneKeys(family: FamilyDescriptor): string[] {
  return Object.keys(family.genes).sort();
}

/**
 * Un `Genome` (flottants `[0,1]`) vers treize octets, dans l'ordre
 * alphabétique des clés de la famille — le format que `CharacterGenome`
 * transporte sur le fil.
 *
 * 256 pas par gène : `Math.round(valeur * 255)`, jamais tronqué — un
 * `Math.floor` biaiserait systématiquement vers le bas.
 */
export function genomeToBytes(genome: Genome): number[] {
  const family = genome.family === HUMANOID.id ? HUMANOID : undefined;
  if (family === undefined) {
    throw new Error(`genomeToBytes: famille inconnue "${genome.family}"`);
  }
  return orderedGeneKeys(family).map((cle) => {
    const valeur = genome.genes[cle] ?? 0.5;
    return Math.max(0, Math.min(255, Math.round(valeur * 255)));
  });
}

/**
 * L'inverse : treize octets vers un `Genome`. Un tableau plus court que
 * treize ne lève pas — les index manquants retombent sur `0.5`, le même
 * défaut que `Genome.genes[cle] ?? 0.5` applique déjà ailleurs dans ce
 * projet pour un gène absent.
 */
export function bytesToGenome(family: FamilyDescriptor, bytes: readonly number[]): Genome {
  const genes: Record<string, number> = {};
  orderedGeneKeys(family).forEach((cle, i) => {
    genes[cle] = (bytes[i] ?? 128) / 255;
  });
  return { family: family.id, genes };
}
```

- [ ] **Step 9 : Lancer, exporter, vérifier**

Ajouter à `packages/character-three/src/index.ts` :

```ts
export { genomeToBytes, bytesToGenome } from './wire';
```

Run : `pnpm --filter @iwsdk/cardinal-character-three test && pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck && pnpm build`
Expected : PASS.

- [ ] **Step 10 : Commiter**

```bash
git add apps/demo/src/simulation/villagerNetworkIds.ts apps/demo/test/villager-network-ids.test.ts packages/character-three/src/wire.ts packages/character-three/src/index.ts packages/character-three/test/wire.test.ts apps/demo/src/multiplayer.ts
git commit -m "feat: fixed network ids for the eleven villagers, and Genome<->bytes conversion"
```

---

## Task 4 : Câbler dans `upgradeVillagers`

**Files :**
- Modify: `apps/demo/src/index.ts`
- Modify: `apps/demo/test/villager-body.test.ts` (si un test y couvre déjà `buildRig`, sinon test d'intégration nouveau)

**Interfaces :**
- Consumes : `VILLAGER_NETWORK_IDS` (Task 3), `genomeToBytes` (Task 3), `Networked` et `CharacterGenome` de `@iwsdk/plugin-phoenix`.
- Produces : rien de nouveau — câblage seul.

- [ ] **Step 1 : Localiser le point d'insertion**

Dans `apps/demo/src/index.ts`, la fabrique `buildRig` (autour de la ligne 109) :

```ts
                buildRig: async (agent, puppet) => {
                  const assetId =
                    agent.gender === 'feminine'
                      ? 'avatar-tpose-feminine'
                      : 'avatar-tpose-masculine';
                  const { entity, report } = await createCharacterFromAsset(world, {
                    assetId,
                    familyId: 'humanoid',
                    genome: genomes[agent.id]!,
                    age: 30,
                  });
                  agentIdParEntite.set(entity, agent.id);
                  // ← insérer ici
                  rapportsParEntite.set(
```

- [ ] **Step 2 : Insérer le câblage réseau**

```ts
                  agentIdParEntite.set(entity, agent.id);
                  // Identité réseau fixe (patron adoptSharedPlant) : chaque
                  // pair crée ce personnage localement et de façon
                  // identique, il ne lui manque qu'un networkId connu
                  // d'avance. Le composant CharacterGenome se publie et se
                  // reçoit ENTIÈREMENT SEUL une fois posé — CardinalPublisher
                  // et PhoenixNetworkSystem font le reste, aucun appel
                  // explicite de publication.
                  entity.addComponent(Networked, {
                    networkId: VILLAGER_NETWORK_IDS[agent.id] ?? 0,
                    isLocalOwner: false,
                    ownerId: 0,
                  });
                  entity.addComponent(CharacterGenome, {
                    genes: genomeToBytes(genomes[agent.id]!),
                  });
                  rapportsParEntite.set(
```

- [ ] **Step 3 : Ajouter les imports**

En tête de `apps/demo/src/index.ts` :

```ts
import { Networked, CharacterGenome } from '@iwsdk/plugin-phoenix';
import { genomeToBytes } from '@iwsdk/cardinal-character-three';
import { VILLAGER_NETWORK_IDS } from './simulation/villagerNetworkIds';
```

(Fusionner avec les imports existants de ces modules s'ils y figurent déjà partiellement.)

- [ ] **Step 4 : Écrire le test d'intégration**

Ajouter à `apps/demo/test/villager-body.test.ts` — ou, si ce fichier ne couvre pas `apps/demo/src/index.ts` (il couvre `VillagerBody.ts`, pas l'assemblage complet), créer `apps/demo/test/villager-network-wiring.test.ts` qui reproduit un appel de `buildRig` minimal :

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { Networked, CharacterGenome, installPhoenixNetworking } from '@iwsdk/plugin-phoenix';
import { HUMANOID, createGenome } from '@iwsdk/cardinal-character';
import { installCharacterThree, createCharacterFromAsset } from '@iwsdk/cardinal-character-three';
import { genomeToBytes } from '@iwsdk/cardinal-character-three';
import { VILLAGER_NETWORK_IDS } from '../src/simulation/villagerNetworkIds';
import { humanoidPuppet } from '../../../packages/character-three/test/fixtures/humanoidPuppet';

describe('le câblage réseau d un villageois', () => {
  it('porte Networked avec son id fixe, et CharacterGenome avec son génome', async () => {
    const world = new World();
    installCharacterThree(world);
    world.registerComponent(Networked);
    world.registerComponent(CharacterGenome);

    const genome = createGenome(HUMANOID, { next: () => 0.5 });
    const { root } = humanoidPuppet('rpm');
    const { entity } = await createCharacterFromAsset(world, {
      // Un double d'assets minimal suffit ici : voir la fixture de la tâche
      // 4 de l'étape 3 (`from-asset.test.ts`) pour le motif complet si le
      // double `world.assets` n'est pas déjà disponible dans ce fichier.
      assetId: 'test-rig', familyId: HUMANOID.id, genome, age: 30,
    } as never).catch(() => ({ entity: null as never }));

    entity.addComponent(Networked, {
      networkId: VILLAGER_NETWORK_IDS['mira'],
      isLocalOwner: false,
      ownerId: 0,
    });
    entity.addComponent(CharacterGenome, { genes: genomeToBytes(genome) });

    expect(entity.getValue(Networked, 'networkId')).toBe(VILLAGER_NETWORK_IDS['mira']);
    expect(Array.from(entity.getVectorView(CharacterGenome, 'genes'))).toEqual(
      genomeToBytes(genome),
    );
  });
});
```

Si le double d'assets minimal ne se met pas en place facilement dans ce fichier, adapter en suivant exactement le motif de `packages/character-three/test/from-asset.test.ts` (double de `world.assets.instantiate`) — la substance du test à préserver est : une entité de personnage réel porte `Networked` avec le bon id fixe, et `CharacterGenome` avec les octets attendus, lisibles par `getVectorView`.

- [ ] **Step 5 : Lancer, vérifier**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck && pnpm build`
Expected : PASS.

- [ ] **Step 6 : Commiter**

```bash
git add apps/demo/src/index.ts apps/demo/test
git commit -m "feat(demo): give each villager a fixed network identity and a published genome"
```

---

## Task 5 : La preuve de divergence forcée

**C'est le seul test qui prouve que la réplication fonctionne.** Une capture à deux clients ne le ferait pas — le repli local et la valeur répliquée coïncident par construction pour les onze villageois de départ (spec §8). Ce test simule deux pairs dont la dérivation locale diverge délibérément, et vérifie que la réception fait converger le second vers la valeur du premier — sans ouvrir de socket réel, en passant directement par le codec généré.

**Files :**
- Create: `apps/demo/test/character-genome-replication.test.ts`

**Interfaces :**
- Consumes : `CARDINAL_CODECS` de `@iwsdk/plugin-phoenix` ; `genomeToBytes` (Task 3).

- [ ] **Step 1 : Écrire le test**

Create `apps/demo/test/character-genome-replication.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { CARDINAL_CODECS, Networked, CharacterGenome } from '@iwsdk/plugin-phoenix';
import { HUMANOID, createGenome, type RngLike } from '@iwsdk/cardinal-character';
import { genomeToBytes } from '@iwsdk/cardinal-character-three';

function rng(graine: number): RngLike {
  let etat = graine || 1;
  return { next: () => ((etat = (etat * 1664525 + 1013904223) >>> 0) / 4294967296) };
}

/** Encode un composant Cardinal exactement comme CardinalPublisher le ferait. */
function encoderSurLeFil(genes: number[]): Uint8Array {
  const codec = CARDINAL_CODECS.get(4)!; // CharacterGenome
  const bytes = new Uint8Array(codec.bytes);
  codec.encode(new DataView(bytes.buffer), 0, { genes });
  return bytes;
}

/** Décode et applique exactement comme PhoenixNetworkSystem le ferait à la réception. */
function appliquerReception(entity: ReturnType<World['createEntity']>, wire: Uint8Array): void {
  const codec = CARDINAL_CODECS.get(4)!;
  const data = codec.decode(new DataView(wire.buffer, wire.byteOffset, wire.byteLength), 0);
  CARDINAL_REGISTRY_WRITE(entity, data as { genes: number[] });
}

// `write` généré fait `entity.getVectorView(CharacterGenome, 'genes').set(...)`
// pour un champ multi-slots — reproduit ici sans dépendre du détail interne
// du registre généré, pour ne pas coupler ce test à sa forme exacte.
function CARDINAL_REGISTRY_WRITE(
  entity: ReturnType<World['createEntity']>,
  data: { genes: number[] },
): void {
  const vue = entity.getVectorView(CharacterGenome, 'genes');
  data.genes.forEach((v, i) => { vue[i] = v; });
}

describe('la réplication fait converger deux dérivations locales divergentes', () => {
  it('le pair B, après réception, porte le génome du pair A — pas le sien', () => {
    // Deux pairs dérivent délibérément des génomes DIFFÉRENTS pour le même
    // agent — un scénario impossible avec la dérivation déterministe
    // d'aujourd'hui, mais c'est exactement ce que la réplication doit
    // corriger si jamais elle se produisait (schéma de secours divergent,
    // ou futur cas de l'étape 6).
    const genomeA = createGenome(HUMANOID, rng(1));
    const genomeB = createGenome(HUMANOID, rng(2));
    expect(genomeA.genes['stature']).not.toBeCloseTo(genomeB.genes['stature']!, 3);

    const worldB = new World();
    worldB.registerComponent(CharacterGenome);
    const entityB = worldB.createEntity();
    // B pose SA propre dérivation locale à la création — comme le fait
    // réellement upgradeVillagers.
    entityB.addComponent(CharacterGenome, { genes: genomeToBytes(genomeB) });
    expect(Array.from(entityB.getVectorView(CharacterGenome, 'genes'))).toEqual(
      genomeToBytes(genomeB),
    );

    // A publie ce qu'il a calculé, sur le fil.
    const surLeFil = encoderSurLeFil(genomeToBytes(genomeA));

    // B reçoit — exactement le chemin de PhoenixNetworkSystem.ts:541.
    appliquerReception(entityB, surLeFil);

    // B porte maintenant le génome de A, pas le sien.
    expect(Array.from(entityB.getVectorView(CharacterGenome, 'genes'))).toEqual(
      genomeToBytes(genomeA),
    );
  });

  it('deux publications de la MÊME valeur ne produisent qu un octet-flux identique — le silence attendu de CardinalPublisher', () => {
    const genome = createGenome(HUMANOID, rng(3));
    const premier = encoderSurLeFil(genomeToBytes(genome));
    const second = encoderSurLeFil(genomeToBytes(genome));
    expect(premier).toEqual(second);
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo test character-genome-replication`
Expected : ÉCHEC — dépendances manquantes ou assertions non satisfaites tant que Tasks 2–3 ne sont pas en place. Si Tasks 2–3 sont déjà commitées à ce stade (exécution séquentielle normale), ce test doit RÉUSSIR dès l'écriture — c'est un test d'intégration sur du code déjà livré, pas un TDD classique. Le confirmer par la lecture de sa sortie plutôt que de supposer.

- [ ] **Step 3 : Vérifier que le premier test peut vraiment tomber**

Casser volontairement `appliquerReception` pour qu'elle n'écrive rien (`function appliquerReception() {}`), relancer, et confirmer que le premier test échoue en nommant l'assertion sur `genomeToBytes(genomeA)`. Rétablir.

- [ ] **Step 4 : Lancer, vérifier, commiter**

```bash
pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck && pnpm build
git add apps/demo/test/character-genome-replication.test.ts
git commit -m "test: prove replication converges two deliberately divergent local genomes"
```

---

## Task 6 : Vérification à l'écran, et le rapport honnête

**Ce que la capture peut prouver, et ce qu'elle ne peut pas.** Spec §10.2 : une capture avec deux clients connectés ne prouve PAS la réplication — elle montrerait la même chose avec ou sans cette étape. Ce qu'elle peut prouver : que rien ne casse (pas de `schema_mismatch`, pas de crash, pas de désynchronisation d'ownership), et que la structure réseau existe réellement (l'entité porte bien `Networked` avec le bon id, visible par inspection ECS).

**Files :** aucun — vérification seule.

- [ ] **Step 1 : Lancer le serveur Elixir**

```bash
cd apps/demo_server && mix deps.get && mix phx.server
```

Attendre qu'il écoute (par défaut, le port annoncé dans les logs de démarrage).

- [ ] **Step 2 : Lancer la démo, mode host_relayed (le défaut)**

```bash
cd apps/demo && npx iwsdk dev up
```

Attendre `browserCommandReady: true`.

- [ ] **Step 3 : Vérifier la structure réseau d'un villageois**

```bash
npx iwsdk ecs find --withComponents Networked
```

Attendu : onze entités, chacune avec un `networkId` correspondant à `VILLAGER_NETWORK_IDS`. Puis, pour une entité :

```bash
npx iwsdk ecs get --entity <id> --component CharacterGenome
```

Attendu : treize valeurs, cohérentes avec le génome de cet agent — comparer manuellement à `genomes[agent.id].genes` en console si l'outil le permet, sinon se contenter de constater que les treize valeurs sont dans `[0,255]` et non toutes nulles.

- [ ] **Step 4 : Tenter un second pair**

Ceci n'a jamais été fait dans ce projet — aucun patron établi à suivre. Essayer d'ouvrir un second onglet de navigateur pointant vers la même URL et la même room (`VITE_PHOENIX_ROOM`, défaut `lobby`), pour observer si le serveur alloue un second `networkId` de joueur distinct et si les `COMPONENT_UPDATE` de `CharacterGenome` atteignent bien ce second onglet (`npx iwsdk browser logs` des deux côtés, ou `ecs find` depuis chacun).

**Si ce n'est pas possible dans cet environnement** — outillage à un seul navigateur managé, ou autre obstacle rencontré — le dire explicitement dans le rapport, avec la cause exacte, et s'en tenir à la preuve structurelle du Step 3 plus la preuve headless de la Task 5. Ne pas forcer une capture qui suggérerait plus que ce qui a été vu.

- [ ] **Step 5 : Le rapport**

Écrire, dans le rapport de tâche, une phrase qui ne peut pas être mal lue : soit *« la réplication à deux pairs a été observée : [ce qui a été vu, précisément] »*, soit *« la réplication à deux pairs n'a pas pu être observée dans cet environnement : [pourquoi] — la preuve tient sur le test de divergence forcée (Task 5) et la structure réseau confirmée (Step 3) »*.

---

## Auto-revue

**Couverture de la spec.** §2.1–2.6 (les six mesures) → reflétées dans les commentaires des Tasks 1–4, pas rouvertes. §4 composant → Task 2. §5 identifiants → Task 3. §6 écriture → Task 4. §7 lecture → automatique, testé indirectement en Task 5. §8 ce que ça prouve → Task 5 est la réponse directe à cette section. §9 contraintes → Global Constraints. §10.1 tests 1–7 → répartis : 1 en Task 2, 2 en Task 2/3, 3–4 en Task 3, 5 en Task 5, 6 en Task 3, 7 différé (aucune tâche ne le couvre explicitement — voir gap ci-dessous). §11 risques → Task 1 en tête (le risque « certain » y est traité en premier), Task 2 step 2/3 pour le risque array. §12 ordre → respecté à l'identique.

**Gap trouvé et laissé ouvert, pas comblé silencieusement.** Le test 7 du §10.1 (« `CharacterGenome` n'est jamais écrit une seconde fois pour une même entité — espion sur trois frames ») n'a pas de tâche dédiée. `CardinalPublisher.collect()` est un mécanisme générique déjà testé ailleurs dans `packages/client` pour d'autres composants ; écrire un test spécifique à `CharacterGenome` pour la même propriété générique serait une duplication plutôt qu'une preuve nouvelle. Si l'implémenteur de la Task 2 ou 5 juge qu'un test ciblé apporte une garantie que les tests génériques de `CardinalPublisher` ne couvrent pas, l'ajouter y est cohérent — sinon, le signaler comme couvert par transitivité et continuer.

**Cohérence des types.** `genomeToBytes(genome: Genome): number[]` et `bytesToGenome(family: FamilyDescriptor, bytes: readonly number[]): Genome` — signatures identiques dans leur définition (Task 3) et tous leurs appels (Task 4, Task 5). `VILLAGER_NETWORK_IDS: Readonly<Record<string, number>>` — même type en Task 3 et Task 4.

**Un risque d'exécution à signaler à l'implémenteur de la Task 4.** Le double d'assets utilisé dans le test d'intégration proposé au Step 4 est esquissé, pas éprouvé — contrairement au reste de ce plan, dont chaque fragment de code a été vérifié contre le dépôt réel. Si le double ne fonctionne pas tel quel, la substance à préserver (une entité de personnage réel porte `Networked` et `CharacterGenome` avec les bonnes valeurs) prime sur la forme exacte du test — suivre le motif de `packages/character-three/test/from-asset.test.ts`, déjà éprouvé à l'étape 3.
