# Écologie E1 — Le monde à portée — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner aux agents un monde sur lequel agir — le semis de flore devient 2 143 smart objets récoltables, la perception gagne le sol, les lieux deviennent des croyances datées, et la zone simulée passe de 64 m à 400 m de côté.

**Architecture:** Trois défauts préexistants du moteur, aujourd'hui invisibles parce que le monde ne compte que 23 objets, deviennent intenables à 2 166. On les corrige **d'abord** (tâches 1 et 2), on enrichit la perception ensuite (tâches 3 et 4), et on ne peuple le monde qu'en dernier (tâche 5), quand il peut le supporter. Un banc de charge (tâche 6) fige le résultat.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Vitest, aucune dépendance nouvelle. Paquet `@iwsdk/cardinal-simulation` (`packages/simulation`) exclusivement — ni Three, ni elics, ni rendu.

**Spec:** `docs/superpowers/specs/2026-08-16-monde-percu-design.md`

## Contraintes globales

- **Le déterminisme est non négociable.** Deux exécutions du même scénario au même seed doivent rendre le même instantané. Tout tri, toute éviction, toute itération de `Map` doit avoir un ordre défini et stable. Jamais `Math.random()`, jamais `Date.now()` : le moteur a son `ctx.rng`.
- **La connaissance est acquise, jamais donnée** (modèle du monde de LeCun, spec §2). Un agent ne connaît un lieu que parce qu'il l'a foulé ou qu'on le lui a dit. Aucune table de régions fournie d'emblée.
- **Rien n'alloue dans une boucle par tick** si on peut l'éviter : le moteur tourne sur le fil principal d'une application VR dont le budget d'image est de 11 ms.
- **`WORLD_SIZE` ne borne que la navigation.** Le champ de hauteur est défini sur le plan infini ; le changer ne doit modifier ni le relief, ni la rivière, ni l'habitabilité du village.
- **Commandes.** Tous les chemins de ce plan sont relatifs à `packages/simulation`. Les tests s'y lancent avec `npx vitest run test/<fichier>`. La suite entière : `npx vitest run`. Le typecheck depuis la racine du dépôt : `pnpm typecheck`.
- **Français pour les commentaires neufs.** Le code existant mêle anglais et français ; les commentaires ajoutés par ce plan sont en français, comme les phases récentes.

---

## Structure des fichiers

| Fichier | Responsabilité | Tâche |
| :--- | :--- | :--- |
| `src/agents/BeliefState.ts` (modifié) | Borne de mémoire par récence, et `known()` mémoïsé | 1 |
| `test/belief-memory.test.ts` (créé) | Éviction, déterminisme, invalidation du cache | 1 |
| `src/world/GroundTruthWorld.ts` (modifié) | Index par type, en O(k) | 2 |
| `test/ground-truth-index.test.ts` (créé) | L'index suit les créations et les restaurations | 2 |
| `src/agents/Perception.ts` (modifié) | Trois faits du sol dans `Observation` | 3 |
| `test/perception-ground.test.ts` (créé) | Le sol perçu s'accorde avec la vérité terrain | 3 |
| `src/agents/PlaceMemory.ts` (créé) | Croyances de lieux : `record`, `learnPlace`, `placesOf` | 4 |
| `test/place-memory.test.ts` (créé) | Acquise en marchant, datée, transmissible, ordonnée | 4 |
| `src/agents/AgentState.ts` (modifié) | L'agent porte une `PlaceMemory` | 4 |
| `src/agents/AgentRuntime.ts` (modifié) | Enregistrement par tick et rumeur de lieux | 4 |
| `src/content/scatterSpawn.ts` (créé) | Traduit le semis en smart objets | 5 |
| `test/scatter-spawn.test.ts` (créé) | Compte, réserve du village, déterminisme | 5 |
| `src/world/relief.ts` (modifié) | `WORLD_SIZE` 64 → 400 | 5 |
| `src/content/scenario.ts` (modifié) | Le scénario sème | 5 |
| `src/world/WolfSystem.ts` (modifié) | Rayon de rôdage élargi | 5 |
| `test/load.test.ts` (créé) | Garde-fou de tenue en charge | 6 |

---

## Tâche 1 — La mémoire d'un agent est bornée

C'est **la** tâche qui rend E1 possible. `Mode1.selectAction` note *toutes* les croyances de l'agent à chaque décision : mesuré à 0,015–0,058 ms pour 23 croyances et **0,80 ms pour 2 166**, soit 88 ms de calcul par seconde simulée à onze agents. Une mémoire bornée à 128 objets ramène cela à 14 ms au pire, et se justifie d'abord par le modèle : une mémoire qui décline est une mémoire faillible.

**Fichiers :**
- Modifier : `src/agents/BeliefState.ts`
- Test : `test/belief-memory.test.ts` (créé)

**Interfaces :**
- Consomme : `Belief { objectId, type, x, z, state, lastSeenTick }`, déjà exporté.
- Produit : `MAX_OBJECT_BELIEFS = 128` exporté depuis `BeliefState.ts`. `known()` rend désormais un tableau **partagé, à ne pas muter**.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/belief-memory.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { BeliefState, MAX_OBJECT_BELIEFS, type Belief } from '../src/agents/BeliefState';

function belief(id: string, tick: number): Belief {
  return { objectId: id, type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 8 }, lastSeenTick: tick };
}

describe('BeliefState — borne de mémoire', () => {
  it("N'EXCÈDE JAMAIS LA BORNE, si loin qu'aille l'agent", () => {
    // Un agent qui parcourt 400 m croise des milliers d'arbres. Sans borne,
    // Mode-1 les note tous à chaque décision : 0,8 ms par agent et par tick.
    const bs = new BeliefState();
    for (let i = 0; i < MAX_OBJECT_BELIEFS * 5; i++) bs.learn(belief(`oak_${i}`, i));
    expect(bs.known()).toHaveLength(MAX_OBJECT_BELIEFS);
  });

  it("OUBLIE CE QU'IL A VU LE PLUS ANCIENNEMENT, jamais le plus récent", () => {
    // L'oubli doit porter sur ce qui ne sert plus. Évincer au hasard ferait
    // perdre à l'agent le buisson qu'il vient de repérer.
    const bs = new BeliefState();
    for (let i = 0; i < MAX_OBJECT_BELIEFS; i++) bs.learn(belief(`oak_${i}`, 100 + i));
    bs.learn(belief('ancien', 0));
    bs.learn(belief('recent', 9999));

    const ids = bs.known().map((b) => b.objectId);
    expect(ids).toContain('recent');
    expect(ids).not.toContain('ancien');
    expect(ids).not.toContain('oak_0'); // le plus ancien du lot initial
    expect(ids).toContain(`oak_${MAX_OBJECT_BELIEFS - 1}`);
  });

  it("ÉVINCE DE FAÇON DÉTERMINISTE quand les dates sont à égalité", () => {
    // Deux exécutions du même scénario doivent rendre le même instantané ;
    // une éviction dépendant de l'ordre d'insertion le romprait.
    const build = () => {
      const bs = new BeliefState();
      for (let i = 0; i < MAX_OBJECT_BELIEFS + 10; i++) bs.learn(belief(`oak_${i}`, 42));
      return bs.known().map((b) => b.objectId);
    };
    expect(build()).toEqual(build());
  });

  it("revoir un objet le rajeunit et le sauve de l'oubli", () => {
    const bs = new BeliefState();
    bs.learn(belief('vieux', 0));
    for (let i = 0; i < MAX_OBJECT_BELIEFS - 1; i++) bs.learn(belief(`oak_${i}`, 100 + i));
    bs.learn(belief('vieux', 10_000)); // revu
    bs.learn(belief('nouveau', 10_001));
    expect(bs.known().map((b) => b.objectId)).toContain('vieux');
  });
});

describe('BeliefState — known() mémoïsé', () => {
  it("VOIT LES ÉCRITURES FAITES APRÈS UNE PREMIÈRE LECTURE", () => {
    // Un cache qui ne s'invalide pas ferait décider Mode-1 sur un monde périmé.
    const bs = new BeliefState();
    bs.learn(belief('a', 1));
    expect(bs.known()).toHaveLength(1);
    bs.learn(belief('b', 2));
    expect(bs.known()).toHaveLength(2);
    bs.forget('a');
    expect(bs.known().map((b) => b.objectId)).toEqual(['b']);
  });

  it("reste trié par identifiant, ordre dont dépend le déterminisme", () => {
    const bs = new BeliefState();
    for (const id of ['c', 'a', 'b']) bs.learn(belief(id, 1));
    expect(bs.known().map((b) => b.objectId)).toEqual(['a', 'b', 'c']);
  });

  it("rend le même tableau tant que rien n'a changé", () => {
    // C'est la raison d'être de la mémoïsation : Mode-1 appelle known() à
    // chaque décision de chaque agent.
    const bs = new BeliefState();
    bs.learn(belief('a', 1));
    expect(bs.known()).toBe(bs.known());
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
cd packages/simulation && npx vitest run test/belief-memory.test.ts
```

Attendu : ÉCHEC — `MAX_OBJECT_BELIEFS` n'est pas exporté (`does not provide an export named 'MAX_OBJECT_BELIEFS'`).

- [ ] **Étape 3 : implémenter**

Dans `src/agents/BeliefState.ts`, remplacer le corps de la classe `BeliefState` (de `private beliefs = new Map...` jusqu'à la fin de `learn`) par :

```ts
/**
 * Nombre d'objets qu'un agent garde en tête. Ce n'est pas un réglage de
 * performance déguisé : une mémoire qui décline est une mémoire faillible,
 * et c'est ce que le modèle du monde demande. La valeur est mesurée —
 * `Mode1.selectAction` note toutes les croyances à chaque décision, et coûte
 * 0,13 ms au pire à 128 croyances contre 0,80 ms à 2 166.
 */
export const MAX_OBJECT_BELIEFS = 128;

export class BeliefState {
  private beliefs = new Map<string, Belief>();
  /** Résultat de `known()`, invalidé à la moindre écriture. */
  private sorted: Belief[] | null = null;

  update(obs: Observation): void {
    for (const o of obs.objects) {
      this.remember({
        objectId: o.id,
        type: o.type,
        x: o.x,
        z: o.z,
        state: { ...o.state },
        lastSeenTick: obs.tick,
      });
    }
  }

  /**
   * Retient une croyance et oublie la plus ancienne si la mémoire déborde.
   * Seul point d'écriture : le cache de `known()` s'invalide ici et nulle
   * part ailleurs.
   */
  private remember(belief: Belief): void {
    this.beliefs.set(belief.objectId, belief);
    this.sorted = null;
    if (this.beliefs.size <= MAX_OBJECT_BELIEFS) return;
    // À date égale, l'identifiant tranche : sans quoi l'éviction dépendrait
    // de l'ordre d'insertion et le déterminisme du moteur tomberait.
    const oldestFirst = [...this.beliefs.values()].sort(
      (a, b) => a.lastSeenTick - b.lastSeenTick || a.objectId.localeCompare(b.objectId)
    );
    const excess = this.beliefs.size - MAX_OBJECT_BELIEFS;
    for (let i = 0; i < excess; i++) this.beliefs.delete(oldestFirst[i]!.objectId);
  }

  /**
   * Croyances triées par identifiant. Le tableau rendu est PARTAGÉ : le muter
   * corromprait le cache. Les appelants le lisent, le copient s'ils trient.
   */
  known(): Belief[] {
    if (this.sorted === null) {
      this.sorted = [...this.beliefs.values()].sort((a, b) =>
        a.objectId.localeCompare(b.objectId)
      );
    }
    return this.sorted;
  }

  byType(type: string): Belief[] {
    return this.known().filter((b) => b.type === type);
  }

  get(objectId: string): Belief | undefined {
    return this.beliefs.get(objectId);
  }

  forget(objectId: string): void {
    this.beliefs.delete(objectId);
    this.sorted = null;
  }

  /** Adopt a belief heard from someone else (rumor, spec §7.4). The rumor is
   * dated at the moment it is heard, not when the fact was observed. */
  learn(belief: Belief): void {
    this.remember({ ...belief, state: { ...belief.state } });
  }
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/belief-memory.test.ts
```

Attendu : SUCCÈS, 7 tests.

- [ ] **Étape 5 : vérifier qu'aucun appelant ne mute le tableau partagé**

```bash
cd packages/simulation && grep -rn "\.known()" src | grep -v BeliefState.ts
```

Attendu : trois lignes exactement — `Mode1.ts` (itère), `Mode2.ts` (`.map()` avant tri, donc trie une copie), `BeliefState.toJSON` (`.map()`). Si une quatrième apparaît et trie ou inverse le résultat en place, lui faire copier d'abord : `[...agent.beliefs.known()]`.

- [ ] **Étape 6 : lancer toute la suite du paquet**

```bash
cd packages/simulation && npx vitest run
```

Attendu : SUCCÈS. La borne de 128 est très au-dessus des 23 objets actuels, donc aucun test existant ne doit changer de résultat. Si `scenario.test` ou `wolf.test` échouent en délai, les relancer seuls — ce sont de longs replays déterministes, sensibles à la charge parallèle.

- [ ] **Étape 7 : commiter**

```bash
git add packages/simulation/src/agents/BeliefState.ts packages/simulation/test/belief-memory.test.ts
git commit -m "perf(simulation): borne la mémoire d'objets d'un agent à 128 croyances par récence"
```

---

## Tâche 2 — Chercher un type ne balaie plus le monde

`objectsNear(0, 0, 1000)` balaie **251 001 cellules de grille** par appel — indépendamment du nombre d'objets — puis trie tout ce qu'il rend. Trois appelants ne cherchent en réalité qu'un type : `WolfSystem` à chaque tick en chasse, `WeatherMachine` sous la pluie, et `scenario` à l'allumage des feux. Un index par type les sert en O(k).

**Fichiers :**
- Modifier : `src/world/GroundTruthWorld.ts`, `src/world/WolfSystem.ts:146-149`, `src/world/WeatherMachine.ts:55`, `src/content/scenario.ts:143-145`
- Test : `test/ground-truth-index.test.ts` (créé)

**Interfaces :**
- Consomme : `SmartObjectInstance { id, type, x, z, state }`, `GroundTruthWorld.spawn`, `GroundTruthWorld.fromJSON`.
- Produit : `objectsOfType(type: string): SmartObjectInstance[]` sur `GroundTruthWorld`, triée par identifiant.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/ground-truth-index.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

describe('GroundTruthWorld.objectsOfType', () => {
  it('rend exactement les objets du type demandé', () => {
    const world = makeWorld();
    world.spawn('campfire', 0, 0);
    world.spawn('oak_tree', 10, 10);
    world.spawn('campfire', -30, 40);
    const fires = world.objectsOfType('campfire');
    expect(fires).toHaveLength(2);
    expect(fires.every((o) => o.type === 'campfire')).toBe(true);
  });

  it('rend un tableau vide pour un type absent, sans lever', () => {
    expect(makeWorld().objectsOfType('campfire')).toEqual([]);
  });

  it('reste trié par identifiant, ordre dont dépend le déterminisme', () => {
    const world = makeWorld();
    for (let i = 0; i < 12; i++) world.spawn('oak_tree', i, 0);
    const ids = world.objectsOfType('oak_tree').map((o) => o.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('TROUVE LES OBJETS SITUÉS AU-DELÀ DE LA PORTÉE DES ANCIENNES REQUÊTES', () => {
    // C'est la raison d'être de l'index : à 400 m, objectsNear(0,0,1000)
    // balayait un quart de million de cellules pour trouver ces deux-là.
    const world = makeWorld();
    world.spawn('campfire', 195, -195);
    world.spawn('campfire', -195, 195);
    expect(world.objectsOfType('campfire')).toHaveLength(2);
  });

  it("SURVIT À UNE RESTAURATION D'INSTANTANÉ", () => {
    // fromJSON reconstruit la grille spatiale ; s'il oublie l'index, le loup
    // ne trouve plus aucune proie après un rechargement, en silence.
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const world = new GroundTruthWorld(registry);
    world.spawn('hunting_ground', 10, -12);
    world.spawn('hunting_ground', -11, -9);
    const restored = GroundTruthWorld.fromJSON(world.toJSON(), registry);
    expect(restored.objectsOfType('hunting_ground')).toHaveLength(2);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
cd packages/simulation && npx vitest run test/ground-truth-index.test.ts
```

Attendu : ÉCHEC — `world.objectsOfType is not a function`.

- [ ] **Étape 3 : implémenter l'index**

Dans `src/world/GroundTruthWorld.ts` :

a. Ajouter le champ, sous `private places = new Map<string, NamedPlace>();` :

```ts
  /** Index par type : `objectsNear(0, 0, 1000)` balayait 251 001 cellules. */
  private typeIndex = new Map<string, Set<string>>();
```

b. Dans `spawn`, juste après `this.grid.insert(instance.id, x, z);` :

```ts
    this.indexByType(instance);
```

c. Ajouter les deux méthodes, juste après `objectsNear` :

```ts
  private indexByType(instance: SmartObjectInstance): void {
    let bucket = this.typeIndex.get(instance.type);
    if (bucket === undefined) {
      bucket = new Set();
      this.typeIndex.set(instance.type, bucket);
    }
    bucket.add(instance.id);
  }

  /** Tous les objets d'un type, où qu'ils soient, triés par identifiant. */
  objectsOfType(type: string): SmartObjectInstance[] {
    const bucket = this.typeIndex.get(type);
    if (bucket === undefined) return [];
    const result: SmartObjectInstance[] = [];
    for (const id of bucket) {
      const obj = this.objects.get(id);
      if (obj !== undefined) result.push(obj);
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }
```

d. Dans `fromJSON`, juste après `world.grid.insert(instance.id, instance.x, instance.z);` :

```ts
      world.indexByType(instance);
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/ground-truth-index.test.ts
```

Attendu : SUCCÈS, 5 tests.

- [ ] **Étape 5 : convertir les trois appelants**

Dans `src/world/WolfSystem.ts`, remplacer

```ts
    const grounds = this.world
      .objectsNear(0, 0, 1000)
      .filter((o) => o.type === 'hunting_ground' && (o.state.gameLeft ?? 0) > 0)
```

par

```ts
    const grounds = this.world
      .objectsOfType('hunting_ground')
      .filter((o) => (o.state.gameLeft ?? 0) > 0)
```

Dans `src/world/WeatherMachine.ts`, remplacer

```ts
      for (const fire of world.objectsNear(0, 0, 1000).filter((o) => o.type === 'campfire')) {
```

par

```ts
      for (const fire of world.objectsOfType('campfire')) {
```

Dans `src/content/scenario.ts`, remplacer

```ts
  for (const fire of world.objectsNear(0, 0, 1000)) {
    if (fire.type === 'campfire') fire.state.lit = 1;
  }
```

par

```ts
  for (const fire of world.objectsOfType('campfire')) fire.state.lit = 1;
```

- [ ] **Étape 6 : vérifier qu'il n'en reste aucun**

```bash
cd packages/simulation && grep -rn "objectsNear(0, 0, 1000)" src
```

Attendu : aucun résultat dans `src`. (`test/wolf.test.ts` et `test/scenario.test.ts` en gardent : les tests ont le droit d'être lents, et le sens de la requête n'y change pas.)

- [ ] **Étape 7 : lancer toute la suite et le typecheck**

```bash
cd packages/simulation && npx vitest run
cd ../.. && pnpm typecheck
```

Attendu : SUCCÈS, et 0 erreur de type. Le comportement du loup, de la pluie et de l'allumage des feux est inchangé — seule la façon de trouver les objets a changé.

- [ ] **Étape 8 : commiter**

```bash
git add packages/simulation/src/world/GroundTruthWorld.ts packages/simulation/src/world/WolfSystem.ts \
        packages/simulation/src/world/WeatherMachine.ts packages/simulation/src/content/scenario.ts \
        packages/simulation/test/ground-truth-index.test.ts
git commit -m "perf(simulation): index par type sur la vérité terrain, au lieu d'un balayage de 251 001 cellules"
```

---

## Tâche 3 — La perception gagne le sol

Aujourd'hui, le seul fait du terrain qui touche une décision d'agent est `isRiverAt`, qui divise la vitesse de marche par deux : **les agents reçoivent du monde un unique bit d'information.** Trois faits lus à la position de l'agent y remédient — c'est local et perceptuel, sans aucune vue d'ensemble.

**Fichiers :**
- Modifier : `src/agents/Perception.ts`
- Test : `test/perception-ground.test.ts` (créé)

**Interfaces :**
- Consomme : `slopeAt(x, z): number` et `heightAt(x, z): number` depuis `../world/terrain` ; `biomeAt(x, z): BiomeSample` et `BiomeId` depuis `../world/biomes`. **Attention** : `biomeAt` rend un `BiomeSample { primary, weights }`, non un `BiomeId` — c'est `.primary` qu'on retient. Et `terrain.ts` ne ré-exporte ni `biomeAt` ni `BiomeId` : ils s'importent de `../world/biomes`.
- Produit : `Observation.groundBiome: BiomeId`, `Observation.groundSlope: number`, `Observation.groundHeight: number`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/perception-ground.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { perceive } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { slopeAt, heightAt } from '../src/world/terrain';
import { biomeAt } from '../src/world/biomes';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

describe('perception du sol', () => {
  it("S'ACCORDE AVEC LA VÉRITÉ TERRAIN, à la position de l'agent", () => {
    // Le moteur et la perception doivent lire le MÊME sol : une divergence
    // ferait décider les agents sur un monde qui n'existe pas.
    const world = makeWorld();
    for (const [x, z] of [[0, 0], [40, -60], [-120, 90]] as const) {
      const obs = perceive(world, { id: 'a', x, z }, [], 0);
      expect(obs.groundBiome).toBe(biomeAt(x, z).primary);
      expect(obs.groundSlope).toBeCloseTo(slopeAt(x, z), 9);
      expect(obs.groundHeight).toBeCloseTo(heightAt(x, z), 9);
    }
  });

  it("NE DÉCRIT QUE CE QUI EST SOUS LES PIEDS, pas ce qu'il y a derrière la colline", () => {
    // Aucune omniscience : chaque agent ne lit que SON sol, celui de sa
    // propre position, et rien du monde au-delà.
    const world = makeWorld();
    const ici = perceive(world, { id: 'a', x: 0, z: 0 }, [], 0);
    const ailleurs = perceive(world, { id: 'b', x: 150, z: 150 }, [], 0);
    expect(ici.groundHeight).toBeCloseTo(heightAt(0, 0), 9);
    expect(ailleurs.groundHeight).toBeCloseTo(heightAt(150, 150), 9);
    // Un seul biome, celui du pas : ni carte, ni liste de régions.
    expect(typeof ici.groundBiome).toBe('string');
  });

  it('reste stable dans le temps : le sol ne change pas avec le tick', () => {
    const world = makeWorld();
    const jour = perceive(world, { id: 'a', x: 12, z: -8 }, [], 0);
    const nuit = perceive(world, { id: 'a', x: 12, z: -8 }, [], 1300);
    expect(nuit.groundBiome).toBe(jour.groundBiome);
    expect(nuit.groundHeight).toBeCloseTo(jour.groundHeight, 9);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
cd packages/simulation && npx vitest run test/perception-ground.test.ts
```

Attendu : ÉCHEC — `expected undefined to be 'grassland'` (la propriété `groundBiome` n'existe pas).

- [ ] **Étape 3 : implémenter**

Dans `src/agents/Perception.ts` :

a. Ajouter les imports, après la ligne `import { isNightHour } from './needs';` :

```ts
import { slopeAt, heightAt } from '../world/terrain';
import { biomeAt, type BiomeId } from '../world/biomes';
```

b. Dans `interface Observation`, ajouter après `visionRadius: number;` :

```ts
  /**
   * Le sol sous les pieds de l'agent, et rien d'autre. Perceptuel et local :
   * un agent sait ce qu'il foule, pas ce qu'il y a derrière la colline.
   */
  groundBiome: BiomeId;
  groundSlope: number;
  groundHeight: number;
```

c. Dans le `return` de `perceive`, ajouter après `visionRadius,` :

```ts
    // `.primary` : biomeAt rend un mélange pondéré ; l'agent retient le
    // biome dominant, comme le rendu.
    groundBiome: biomeAt(self.x, self.z).primary,
    groundSlope: slopeAt(self.x, self.z),
    groundHeight: heightAt(self.x, self.z),
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/perception-ground.test.ts
```

Attendu : SUCCÈS, 3 tests.

- [ ] **Étape 5 : lancer toute la suite et le typecheck**

```bash
cd packages/simulation && npx vitest run
cd ../.. && pnpm typecheck
```

Attendu : SUCCÈS, 0 erreur. Si un test construit un objet `Observation` littéral, le typecheck le signalera : lui ajouter les trois champs avec les mêmes appels `biomeAt`/`slopeAt`/`heightAt`.

- [ ] **Étape 6 : commiter**

```bash
git add packages/simulation/src/agents/Perception.ts packages/simulation/test/perception-ground.test.ts
git commit -m "feat(simulation): la perception porte le biome, la pente et l'altitude du sol"
```

---

## Tâche 4 — Les lieux deviennent des croyances

Une carte des régions fournie d'emblée serait *infaillible* et *non acquise* — l'inverse d'une croyance, et une faute au regard du modèle du monde. Un agent n'apprend un lieu qu'en le foulant, ou parce qu'on le lui a dit ; la croyance est datée, donc révisable, donc faillible.

**Fichiers :**
- Créer : `src/agents/PlaceMemory.ts`
- Modifier : `src/agents/AgentState.ts:42-56` (interface) et `:58-` (fabrique), `src/agents/AgentRuntime.ts:402` (enregistrement) et `:176-196` (rumeur)
- Test : `test/place-memory.test.ts` (créé)

**Interfaces :**
- Consomme : `Observation.groundBiome` (tâche 3), `SCATTER_TILE = 32` depuis `../world/scatter`, `BiomeId` depuis `../world/biomes`.
- Produit : `PlaceBelief { key, biome, x, z, lastSeenTick }`, la classe `PlaceMemory` avec `record(obs, x, z)`, `learnPlace(belief)`, `placesOf(biome, fromX, fromZ)`, `all()`, `divergenceFrom(sample)`, `toJSON()`, et les fonctions `placeKey(biome, tileX, tileZ)` et `tileOf(v)`. `AgentState.places: PlaceMemory`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/place-memory.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { PlaceMemory, placeKey, tileOf, MAX_PLACE_BELIEFS } from '../src/agents/PlaceMemory';
import { perceive } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { SCATTER_TILE } from '../src/world/scatter';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

describe('PlaceMemory', () => {
  it("NE SAIT RIEN AVANT D'AVOIR MARCHÉ", () => {
    // Le cœur du modèle : la connaissance est acquise, jamais donnée.
    expect(new PlaceMemory().all()).toEqual([]);
    expect(new PlaceMemory().placesOf('forest', 0, 0)).toEqual([]);
  });

  it("APPREND LE LIEU QU'IL FOULE, et le date", () => {
    const world = makeWorld();
    const mem = new PlaceMemory();
    const obs = perceive(world, { id: 'a', x: 5, z: -7 }, [], 120);
    mem.record(obs, 5, -7);
    const known = mem.all();
    expect(known).toHaveLength(1);
    expect(known[0]!.biome).toBe(obs.groundBiome);
    expect(known[0]!.lastSeenTick).toBe(120);
  });

  it("RANGE LES LIEUX SUR LA MÊME GRILLE QUE LE SEMIS", () => {
    // Un lieu cru et un lieu semé doivent désigner exactement la même case,
    // sans quoi « il y a une forêt là » ne correspond à aucun arbre.
    const world = makeWorld();
    const mem = new PlaceMemory();
    const obs = perceive(world, { id: 'a', x: 1, z: 1 }, [], 0);
    mem.record(obs, 1, 1);
    const place = mem.all()[0]!;
    expect(place.key).toBe(placeKey(obs.groundBiome, tileOf(1), tileOf(1)));
    // Le centre mémorisé est celui de la case, non le pas de l'agent.
    expect(place.x).toBe(SCATTER_TILE / 2);
    expect(place.z).toBe(SCATTER_TILE / 2);

    // Un second pas dans la même case ne crée pas un second lieu du même
    // biome. (Une case de 32 m peut chevaucher deux biomes : on ne compare
    // donc que les lieux du biome observé au premier pas.)
    mem.record(perceive(world, { id: 'a', x: 3, z: 3 }, [], 1), 3, 3);
    expect(mem.all().filter((p) => p.biome === obs.groundBiome)).toHaveLength(1);
  });

  it('REVOIR UN LIEU LE REDATE au lieu de le dupliquer', () => {
    const world = makeWorld();
    const mem = new PlaceMemory();
    mem.record(perceive(world, { id: 'a', x: 2, z: 2 }, [], 10), 2, 2);
    mem.record(perceive(world, { id: 'a', x: 2, z: 2 }, [], 900), 2, 2);
    expect(mem.all()).toHaveLength(1);
    expect(mem.all()[0]!.lastSeenTick).toBe(900);
  });

  it('rend les lieux du biome demandé, du plus proche au plus lointain', () => {
    const mem = new PlaceMemory();
    mem.learnPlace({ key: placeKey('forest', 4, 0), biome: 'forest', x: 144, z: 16, lastSeenTick: 1 });
    mem.learnPlace({ key: placeKey('forest', 1, 0), biome: 'forest', x: 48, z: 16, lastSeenTick: 1 });
    mem.learnPlace({ key: placeKey('rock', 2, 0), biome: 'rock', x: 80, z: 16, lastSeenTick: 1 });
    const forests = mem.placesOf('forest', 0, 0);
    expect(forests.map((p) => p.x)).toEqual([48, 144]);
  });

  it("ADOPTE UN LIEU ENTENDU, DATÉ DU MOMENT OÙ ON L'ENTEND", () => {
    // Comme la rumeur des objets : ce qui est daté, c'est l'audition, pas le
    // fait. C'est ce qui rend la croyance faillible.
    const mem = new PlaceMemory();
    mem.learnPlace({ key: placeKey('forest', 3, 3), biome: 'forest', x: 112, z: 112, lastSeenTick: 700 });
    expect(mem.placesOf('forest', 0, 0)).toHaveLength(1);
    expect(mem.all()[0]!.lastSeenTick).toBe(700);
  });

  it("N'EXCÈDE JAMAIS SA BORNE, et oublie les lieux les plus anciens", () => {
    const mem = new PlaceMemory();
    for (let i = 0; i < MAX_PLACE_BELIEFS + 20; i++) {
      mem.learnPlace({ key: placeKey('forest', i, 0), biome: 'forest', x: i * 32, z: 0, lastSeenTick: i });
    }
    expect(mem.all()).toHaveLength(MAX_PLACE_BELIEFS);
    expect(mem.all().map((p) => p.key)).not.toContain(placeKey('forest', 0, 0));
  });

  it('MESURE SON PROPRE ÉCART À LA VÉRITÉ TERRAIN', () => {
    // Spec §8 : l'écart entre la croyance et le fait est la cible
    // d'entraînement. Une case de 32 m étiquetée d'après un seul pas est une
    // approximation assumée — et c'est précisément ce que cette métrique rend
    // mesurable, comme `BeliefState.divergenceFrom` le fait des objets.
    const mem = new PlaceMemory();
    mem.learnPlace({ key: placeKey('forest', 0, 0), biome: 'forest', x: 16, z: 16, lastSeenTick: 0 });
    mem.learnPlace({ key: placeKey('rock', 1, 0), biome: 'rock', x: 48, z: 16, lastSeenTick: 0 });
    expect(mem.divergenceFrom(() => 'forest')).toBeCloseTo(0.5, 9);
    expect(mem.divergenceFrom((x) => (x < 32 ? 'forest' : 'rock'))).toBe(0);
    expect(mem.divergenceFrom(() => 'alpine')).toBe(1);
  });

  it("ne s'écarte de rien quand il ne sait rien", () => {
    expect(new PlaceMemory().divergenceFrom(() => 'forest')).toBe(0);
  });

  it('reste déterministe : deux mêmes séquences donnent la même mémoire', () => {
    const build = () => {
      const mem = new PlaceMemory();
      for (let i = 0; i < MAX_PLACE_BELIEFS + 5; i++) {
        mem.learnPlace({ key: placeKey('forest', i, 0), biome: 'forest', x: i * 32, z: 0, lastSeenTick: 42 });
      }
      return mem.all().map((p) => p.key);
    };
    expect(build()).toEqual(build());
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
cd packages/simulation && npx vitest run test/place-memory.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "../src/agents/PlaceMemory"`.

- [ ] **Étape 3 : implémenter `PlaceMemory`**

Créer `src/agents/PlaceMemory.ts` :

```ts
import type { Observation } from './Perception';
import type { BiomeId } from '../world/biomes';
import { SCATTER_TILE } from '../world/scatter';

/**
 * La carte mentale d'un agent (spec E1 §5) : des lieux ACQUIS en marchant,
 * datés, donc faillibles. Aucune région n'est donnée d'emblée — un savoir
 * géographique fourni serait infaillible et non acquis, l'inverse d'une
 * croyance au sens du modèle du monde.
 *
 * La grille est celle du semis : un lieu cru et un lieu semé désignent
 * exactement la même case de 32 m.
 */
export interface PlaceBelief {
  /** Biome et tuile, par exemple 'forest@3,-2'. */
  readonly key: string;
  readonly biome: BiomeId;
  /** Centre de la tuile, non le pas de l'agent. */
  readonly x: number;
  readonly z: number;
  readonly lastSeenTick: number;
}

/**
 * Une centaine de tuiles couvre les 400 m simulés. La borne existe pour la
 * même raison que celle des objets : une mémoire qui décline est une mémoire
 * faillible.
 */
export const MAX_PLACE_BELIEFS = 128;

export function placeKey(biome: BiomeId, tileX: number, tileZ: number): string {
  return `${biome}@${tileX},${tileZ}`;
}

export function tileOf(v: number): number {
  return Math.floor(v / SCATTER_TILE);
}

function tileCenter(tile: number): number {
  return tile * SCATTER_TILE + SCATTER_TILE / 2;
}

export class PlaceMemory {
  private places = new Map<string, PlaceBelief>();

  /** Enregistre la tuile que l'agent foule à cet instant. */
  record(obs: Observation, x: number, z: number): void {
    const tileX = tileOf(x);
    const tileZ = tileOf(z);
    this.learnPlace({
      key: placeKey(obs.groundBiome, tileX, tileZ),
      biome: obs.groundBiome,
      x: tileCenter(tileX),
      z: tileCenter(tileZ),
      lastSeenTick: obs.tick,
    });
  }

  /**
   * Adopte un lieu, qu'il vienne des pieds de l'agent ou de la bouche d'un
   * autre. Comme pour les objets, la rumeur est datée du moment où on
   * l'entend, non du moment du fait.
   */
  learnPlace(belief: PlaceBelief): void {
    this.places.set(belief.key, { ...belief });
    if (this.places.size <= MAX_PLACE_BELIEFS) return;
    // À date égale, la clé tranche : l'éviction doit être déterministe.
    const oldestFirst = [...this.places.values()].sort(
      (a, b) => a.lastSeenTick - b.lastSeenTick || a.key.localeCompare(b.key)
    );
    const excess = this.places.size - MAX_PLACE_BELIEFS;
    for (let i = 0; i < excess; i++) this.places.delete(oldestFirst[i]!.key);
  }

  /** Tous les lieux connus, triés par clé. */
  all(): PlaceBelief[] {
    return [...this.places.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Les lieux connus d'un biome, du plus proche au plus lointain. C'est ce
   * qui donne à Mode-2 de quoi planifier un déplacement, au lieu de réagir à
   * ce qui passe à portée de vue.
   */
  placesOf(biome: BiomeId, fromX: number, fromZ: number): PlaceBelief[] {
    return this.all()
      .filter((p) => p.biome === biome)
      .sort(
        (a, b) =>
          Math.hypot(a.x - fromX, a.z - fromZ) - Math.hypot(b.x - fromX, b.z - fromZ) ||
          a.key.localeCompare(b.key)
      );
  }

  /**
   * Fraction des lieux crus dont le biome ne correspond plus à celui du
   * terrain, au centre mémorisé. Pendant du `divergenceFrom` des objets :
   * impossible à mesurer dans le monde réel, gratuit en simulation.
   *
   * Le tirage est injecté plutôt qu'importé, pour que la métrique se teste
   * sans dépendre du relief.
   */
  divergenceFrom(sample: (x: number, z: number) => BiomeId): number {
    const places = [...this.places.values()];
    if (places.length === 0) return 0;
    let wrong = 0;
    for (const place of places) {
      if (sample(place.x, place.z) !== place.biome) wrong++;
    }
    return wrong / places.length;
  }

  toJSON(): PlaceBelief[] {
    return this.all().map((p) => ({ ...p }));
  }
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/place-memory.test.ts
```

Attendu : SUCCÈS, 10 tests.

- [ ] **Étape 5 : donner une mémoire des lieux à l'agent**

Dans `src/agents/AgentState.ts` :

a. Ajouter l'import auprès de celui de `BeliefState` :

```ts
import { PlaceMemory } from './PlaceMemory';
```

b. Dans `interface AgentState`, après `beliefs: BeliefState;` :

```ts
  places: PlaceMemory;
```

c. Dans `createAgent`, après `beliefs: new BeliefState(),` :

```ts
    places: new PlaceMemory(),
```

- [ ] **Étape 6 : l'enregistrer à chaque tick**

Dans `src/agents/AgentRuntime.ts`, à la ligne qui met les croyances à jour :

```ts
      agent.beliefs.update(observation);
```

ajouter juste en dessous :

```ts
      // Le lieu foulé entre en mémoire du seul fait d'y passer : les agents
      // n'explorent pas délibérément, ils retiennent ce qu'ils traversent.
      agent.places.record(observation, agent.x, agent.z);
```

- [ ] **Étape 7 : transmettre les lieux par la rumeur**

Dans `src/agents/AgentRuntime.ts`, juste après le bloc `if (Array.isArray(payload.sharedFacts)) { ... }` (celui qui se termine par la fermeture de la boucle `for (const fact of ...)`), ajouter :

```ts
        // Les lieux se transmettent comme les objets, et sont datés de
        // l'audition : celui qui écoute croit désormais, sans avoir vu.
        if (Array.isArray(payload.sharedPlaces)) {
          for (const place of payload.sharedPlaces as Array<Record<string, unknown>>) {
            if (
              typeof place?.biome === 'string' &&
              typeof place?.x === 'number' &&
              typeof place?.z === 'number'
            ) {
              const biome = place.biome as BiomeId;
              participant.places.learnPlace({
                key: placeKey(biome, tileOf(place.x), tileOf(place.z)),
                biome,
                x: place.x,
                z: place.z,
                lastSeenTick: tick,
              });
            }
          }
        }
```

et ajouter les imports en tête du fichier :

```ts
import { placeKey, tileOf } from './PlaceMemory';
import type { BiomeId } from '../world/biomes';
```

- [ ] **Étape 8 : écrire le test de la rumeur de lieu**

Ajouter à la fin de `test/place-memory.test.ts`, dans un nouveau bloc :

```ts
describe('rumeur de lieu', () => {
  it("FAIT CROIRE À UN LIEU QU'ON N'A PAS VU", () => {
    // Un agent doit pouvoir apprendre « il y a une forêt au nord » sans y
    // être allé : c'est le seul moyen de partager la géographie, et cela
    // reste une croyance datée, donc révisable.
    const mem = new PlaceMemory();
    mem.learnPlace({ key: placeKey('forest', 2, -3), biome: 'forest', x: 80, z: -80, lastSeenTick: 55 });
    const heard = mem.placesOf('forest', 0, 0);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.x).toBe(80);
    expect(heard[0]!.lastSeenTick).toBe(55);
  });
});
```

- [ ] **Étape 9 : lancer toute la suite et le typecheck**

```bash
cd packages/simulation && npx vitest run
cd ../.. && pnpm typecheck
```

Attendu : SUCCÈS, 0 erreur. Si un test construit un `AgentState` littéral, le typecheck le signalera : lui ajouter `places: new PlaceMemory()`.

- [ ] **Étape 10 : commiter**

```bash
git add packages/simulation/src/agents/PlaceMemory.ts packages/simulation/src/agents/AgentState.ts \
        packages/simulation/src/agents/AgentRuntime.ts packages/simulation/test/place-memory.test.ts
git commit -m "feat(simulation): les lieux deviennent des croyances acquises en marchant, datées et transmissibles"
```

---

## Tâche 5 — Le semis peuple le monde, et la zone s'élargit

C'est la tâche qui donne son titre au sous-projet. `scatterAt` existe depuis la phase 5 et le rendu le consomme déjà : **la forêt se voit mais ne se coupe pas.** Le moteur en devient le second consommateur, et la zone simulée s'élargit pour que la rareté géographique ait où s'exprimer.

**Fichiers :**
- Créer : `src/content/scatterSpawn.ts`
- Modifier : `src/world/relief.ts:12`, `src/content/scenario.ts` (dans `buildVillageSim`), `src/world/WolfSystem.ts:96-100`
- Test : `test/scatter-spawn.test.ts` (créé)

**Interfaces :**
- Consomme : `scatterAt(tileX, tileZ): readonly ScatterItem[]`, `SCATTER_TILE = 32`, `FloraSpecies = 'oak' | 'aspen' | 'bush'` depuis `../world/scatter` ; `GroundTruthWorld.spawn(type, x, z)` ; `WORLD_SIZE` depuis `../world/terrain`.
- Produit : `SPECIES_OBJECT: Record<FloraSpecies, string>` et `spawnScatter(world: GroundTruthWorld, side: number): number` (rend le nombre d'objets semés) depuis `src/content/scatterSpawn.ts`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/scatter-spawn.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { spawnScatter, SPECIES_OBJECT } from '../src/content/scatterSpawn';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { scatterAt, SCATTER_TILE, FLORA_SPECIES } from '../src/world/scatter';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

describe('spawnScatter', () => {
  it('CHAQUE ESPÈCE SEMÉE A SON SMART OBJET, sans quoi la forêt reste inerte', () => {
    // Le défaut que cette phase corrige : le rendu plante des arbres que le
    // moteur ne connaît pas.
    for (const species of FLORA_SPECIES) {
      expect(SPECIES_OBJECT[species], `espèce ${species}`).toBeTruthy();
    }
  });

  it('les types produits sont tous déclarés par le contenu du moteur', () => {
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    for (const type of Object.values(SPECIES_OBJECT)) {
      expect(registry.has(type), `type ${type}`).toBe(true);
    }
  });

  it('SÈME AUTANT QUE LE RENDU EN MONTRE, ni plus ni moins', () => {
    // Moteur et rendu lisent la même vérité terrain : un arbre visible doit
    // être un arbre récoltable, sinon les agents bûcheronnent du vide.
    const world = makeWorld();
    const side = 128;
    const planted = spawnScatter(world, side);

    let expected = 0;
    const half = side / 2;
    const n = Math.ceil(half / SCATTER_TILE);
    for (let tx = -n; tx <= n; tx++) {
      for (let tz = -n; tz <= n; tz++) {
        for (const item of scatterAt(tx, tz)) {
          if (Math.abs(item.x) <= half && Math.abs(item.z) <= half) expected++;
        }
      }
    }
    expect(planted).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("NE SÈME RIEN DANS LE VILLAGE, dont les 23 objets sont calés à la main", () => {
    // scatterAt observe une réserve de 14 m ; si elle tombait, les huttes se
    // retrouveraient dans un bosquet et le garde-fou d'habitabilité sauterait.
    const world = makeWorld();
    spawnScatter(world, 128);
    const inside = world
      .objectsOfType('oak_tree')
      .concat(world.objectsOfType('berry_bush'))
      .filter((o) => Math.hypot(o.x, o.z) < 14);
    expect(inside).toEqual([]);
  });

  it('reste déterministe : deux mondes semés portent les mêmes objets', () => {
    const a = makeWorld();
    const b = makeWorld();
    spawnScatter(a, 128);
    spawnScatter(b, 128);
    const key = (w: GroundTruthWorld) =>
      w.objectsOfType('oak_tree').map((o) => `${o.id}:${o.x.toFixed(4)},${o.z.toFixed(4)}`);
    expect(key(a)).toEqual(key(b));
  });

  it('les objets semés sont récoltables, comme ceux du village', () => {
    const world = makeWorld();
    spawnScatter(world, 128);
    const oak = world.objectsOfType('oak_tree')[0]!;
    expect(oak.state.woodLeft).toBeGreaterThan(0);
    expect(world.affordancesOf('oak_tree').map((a) => a.verb)).toContain('gather_wood');
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
cd packages/simulation && npx vitest run test/scatter-spawn.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "../src/content/scatterSpawn"`.

- [ ] **Étape 3 : implémenter `spawnScatter`**

Créer `src/content/scatterSpawn.ts` :

```ts
import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import { scatterAt, SCATTER_TILE, type FloraSpecies } from '../world/scatter';

/**
 * Le second consommateur de `scatterAt` (spec E1 §3). Le rendu en tire ses
 * maillages depuis la phase 5 ; le moteur en tire désormais des objets
 * récoltables, lus sur la MÊME vérité terrain. Sans cela, la forêt se voit
 * mais ne se coupe pas.
 *
 * Aucun verbe nouveau n'est nécessaire : `gather_wood` et `gather_berries`
 * existent, et la régénération est déjà déclarée par le contenu.
 */
export const SPECIES_OBJECT: Record<FloraSpecies, string> = {
  oak: 'oak_tree',
  // Le tremble donne du bois comme le chêne ; le moteur n'a pas besoin d'en
  // distinguer l'essence, seul le rendu le fait.
  aspen: 'oak_tree',
  bush: 'berry_bush',
};

/**
 * Instancie le semis d'un carré de `side` mètres de côté, centré sur
 * l'origine. Tout est instancié d'emblée : une instanciation paresseuse
 * ferait dépendre l'identité d'un arbre de l'ordre dans lequel les agents
 * s'en approchent, et le déterminisme du moteur n'y survivrait pas.
 *
 * Rend le nombre d'objets semés.
 */
export function spawnScatter(world: GroundTruthWorld, side: number): number {
  const half = side / 2;
  const tiles = Math.ceil(half / SCATTER_TILE);
  let planted = 0;
  // Ordre de parcours fixe : les identifiants sont attribués séquentiellement
  // par `spawn`, donc l'ordre EST l'identité.
  for (let tileX = -tiles; tileX <= tiles; tileX++) {
    for (let tileZ = -tiles; tileZ <= tiles; tileZ++) {
      for (const item of scatterAt(tileX, tileZ)) {
        if (Math.abs(item.x) > half || Math.abs(item.z) > half) continue;
        world.spawn(SPECIES_OBJECT[item.species], item.x, item.z);
        planted++;
      }
    }
  }
  return planted;
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/scatter-spawn.test.ts
```

Attendu : SUCCÈS, 6 tests.

- [ ] **Étape 5 : élargir la zone simulée**

Dans `src/world/relief.ts`, remplacer

```ts
export const WORLD_SIZE = 64;
```

par

```ts
/**
 * Côté du carré simulé, en mètres — un CÔTÉ, non un rayon : la navigation
 * borne les agents à ±200 m de l'origine.
 *
 * Cette constante ne borne QUE la navigation : le champ de hauteur est défini
 * sur le plan infini et n'en dépend pas. La changer ne modifie ni le relief,
 * ni la rivière, ni l'habitabilité du village.
 *
 * 400 m donnent une centaine de tuiles de semis et plusieurs biomes à
 * parcourir, tout en restant très en deçà des 800 m qui séparent le village
 * de la mer : la côte reste hors d'atteinte, et c'est voulu.
 */
export const WORLD_SIZE = 400;
```

- [ ] **Étape 6 : élargir le rôdage du loup**

Dans `src/world/WolfSystem.ts`, remplacer

```ts
            wolf.targetX = ctx.rng.int(-20, 21);
            wolf.targetZ = ctx.rng.int(-20, 21);
```

par

```ts
            // Le rôdage suivait la zone de 64 m ; à 400 m, un loup confiné à
            // ±20 m ne serait plus qu'un décor du village.
            wolf.targetX = ctx.rng.int(-60, 61);
            wolf.targetZ = ctx.rng.int(-60, 61);
```

- [ ] **Étape 7 : le scénario sème**

Dans `src/content/scenario.ts` :

a. Ajouter aux imports :

```ts
import { spawnScatter } from './scatterSpawn';
import { WORLD_SIZE } from '../world/terrain';
```

b. Dans `buildVillageSim`, juste après la boucle `for (const obj of DEFAULT_VILLAGE.objects) { world.spawn(...); }`, ajouter :

```ts
  // Le village d'abord, la nature ensuite : les 23 objets calés à la main
  // gardent les identifiants les plus bas, et les tests qui les nomment
  // restent valables.
  spawnScatter(world, WORLD_SIZE);
```

- [ ] **Étape 8 : écrire le test du scénario peuplé**

Ajouter à `test/scatter-spawn.test.ts` :

```ts
describe('le scénario peuple le monde', () => {
  it('DONNE AUX AGENTS UN MONDE SUR LEQUEL AGIR, pas seulement 23 objets', async () => {
    // Le constat qui motive E1 : le moteur ne connaissait que le village.
    const { buildVillageSim } = await import('../src/content/scenario');
    const { world } = buildVillageSim(1);
    const trees = world.objectsOfType('oak_tree').length;
    const bushes = world.objectsOfType('berry_bush').length;
    expect(trees).toBeGreaterThan(500);
    expect(bushes).toBeGreaterThan(100);
  });

  it('GARDE LE VILLAGE INTACT : ses 23 objets sont toujours là', async () => {
    const { buildVillageSim, DEFAULT_VILLAGE } = await import('../src/content/scenario');
    const { world } = buildVillageSim(1);
    expect(DEFAULT_VILLAGE.objects).toHaveLength(23);
    expect(world.objectsOfType('campfire')).toHaveLength(3);
    expect(world.objectsOfType('shelter')).toHaveLength(3);
    expect(world.objectsOfType('hunting_ground')).toHaveLength(2);
    // Les feux du premier jour sont allumés, comme le village l'a toujours fait.
    expect(world.objectsOfType('campfire').every((f) => f.state.lit === 1)).toBe(true);
  });

  it('reste déterministe de bout en bout', async () => {
    const { buildVillageSim } = await import('../src/content/scenario');
    const snap = () => JSON.stringify(buildVillageSim(7).world.toJSON());
    expect(snap()).toEqual(snap());
  });
});
```

- [ ] **Étape 9 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/scatter-spawn.test.ts
```

Attendu : SUCCÈS, 9 tests.

- [ ] **Étape 10 : lancer toute la suite et constater les régressions**

```bash
cd packages/simulation && npx vitest run
```

Les échecs attendus, et quoi en faire :

| Échec | Cause | Correction |
| :--- | :--- | :--- |
| Une assertion de position hors de ±32 m | Le clamp de navigation était à ±32 m, il est à ±200 m | Corriger la valeur attendue : le nouveau comportement est le bon |
| `wolf.test` ne trouve plus le loup au même endroit | Rôdage élargi à ±60 m | Corriger la valeur attendue, ou élargir la fenêtre de recherche du test |
| Un instantané déterministe figé | Le monde compte 2 166 objets au lieu de 23 | Régénérer la référence, puis **vérifier que deux exécutions successives la reproduisent** : le déterminisme doit tenir, seule la valeur change |
| Un test lent qui expire | 2 166 objets à instancier | Lui donner `{ timeout: 20000 }`, comme `wolf.test` et `scenario.test` |

Ne masquer aucun échec : chacun doit être compris avant d'être corrigé. Un test qui échoue **parce qu'un agent tombe hors du monde** ou **parce que le loup ne trouve plus de proie** n'est pas une référence à régénérer, c'est un défaut.

- [ ] **Étape 11 : vérifier que le terrain n'a pas bougé**

```bash
cd packages/simulation && npx vitest run test/village-habitability.test.ts test/terrain.test.ts test/flow.test.ts test/biomes.test.ts
```

Attendu : SUCCÈS **sans aucune modification de ces fichiers**. C'est la preuve que `WORLD_SIZE` ne borne que la navigation. Si l'un d'eux échoue, arrêter : `WORLD_SIZE` a un consommateur caché dans la génération du relief, et la spec est fausse sur ce point.

- [ ] **Étape 12 : typecheck**

```bash
cd /Volumes/AZA-SSD/MyWorkspace/github/iwsdk-phoenix-monorepo/iwsdk-plugin-phoenix && pnpm typecheck
```

Attendu : 0 erreur.

- [ ] **Étape 13 : commiter**

```bash
git add packages/simulation/src/content/scatterSpawn.ts packages/simulation/src/content/scenario.ts \
        packages/simulation/src/world/relief.ts packages/simulation/src/world/WolfSystem.ts \
        packages/simulation/test/
git commit -m "feat(simulation): le semis engendre 2 143 objets récoltables et la zone simulée passe à 400 m"
```

---

## Tâche 6 — Un garde-fou de tenue en charge

Les trois défauts corrigés aux tâches 1, 2 et 5 étaient invisibles parce que le monde ne comptait que 23 objets. Sans banc qui les tienne, ils reviendront de la même façon : sans bruit, et seulement en casque.

**Fichiers :**
- Test : `test/load.test.ts` (créé)

**Interfaces :**
- Consomme : `buildVillageSim(seed): VillageSim`, `VillageSim.runtime.agents` (**une `Map`, non une méthode** — on itère `runtime.agents.values()`), `SimKernel.advance(realDeltaSeconds): number`, `MAX_OBJECT_BELIEFS`, `MAX_PLACE_BELIEFS`, `GroundTruthWorld.objectsOfType`.
- **Piège du moteur** : `SimKernel` plafonne à `MAX_TICKS_PER_ADVANCE = 1000` ticks par appel et remet son accumulateur à zéro au-delà. Un `advance(240)` ne simulerait donc PAS 2 400 ticks. On avance par tranches.

- [ ] **Étape 1 : écrire le test**

Créer `test/load.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildVillageSim, type VillageSim } from '../src/content/scenario';
import { MAX_OBJECT_BELIEFS } from '../src/agents/BeliefState';
import { MAX_PLACE_BELIEFS } from '../src/agents/PlaceMemory';

/**
 * Une journée entière, 2 400 ticks, par tranches de 100 : le noyau plafonne
 * à 1 000 ticks par appel et remet son accumulateur à zéro au-delà, si bien
 * qu'un seul advance(240) n'en simulerait qu'un millier.
 */
function simulateOneDay(sim: VillageSim): void {
  for (let i = 0; i < 24; i++) sim.kernel.advance(10);
}

describe('tenue en charge du monde peuplé', () => {
  it("LA MÉMOIRE D'UN AGENT RESTE BORNÉE APRÈS UNE JOURNÉE ENTIÈRE", { timeout: 60000 }, () => {
    // Le défaut que ce banc retient : sans borne, Mode-1 note toutes les
    // croyances à chaque décision, et le coût passe de 4 à 88 ms par seconde
    // simulée — sur le fil principal d'une application VR.
    const sim = buildVillageSim(3);
    simulateOneDay(sim);
    for (const agent of sim.runtime.agents.values()) {
      expect(
        agent.beliefs.known().length,
        `${agent.profile.id} : ${agent.beliefs.known().length} croyances`
      ).toBeLessThanOrEqual(MAX_OBJECT_BELIEFS);
      expect(agent.places.all().length).toBeLessThanOrEqual(MAX_PLACE_BELIEFS);
    }
  });

  it('LES AGENTS APPRENNENT DES LIEUX EN VAQUANT À LEURS BESOINS', { timeout: 60000 }, () => {
    // Sans exploration délibérée : ils retiennent ce qu'ils traversent. Si
    // personne n'apprend rien, l'enregistrement par tick n'est pas branché.
    const sim = buildVillageSim(3);
    simulateOneDay(sim);
    const learned = [...sim.runtime.agents.values()].reduce((n, a) => n + a.places.all().length, 0);
    expect(learned).toBeGreaterThan(0);
  });

  it('AUCUN AGENT NE SORT DU MONDE', { timeout: 60000 }, () => {
    const sim = buildVillageSim(3);
    simulateOneDay(sim);
    for (const agent of sim.runtime.agents.values()) {
      expect(Math.abs(agent.x), `${agent.profile.id} en x`).toBeLessThanOrEqual(200.001);
      expect(Math.abs(agent.z), `${agent.profile.id} en z`).toBeLessThanOrEqual(200.001);
    }
  });

  it('UNE JOURNÉE SIMULÉE TIENT DANS SON BUDGET', { timeout: 60000 }, () => {
    // 2 400 ticks représentent une journée. Le moteur tourne sur le fil
    // principal d'une application dont le budget d'image est de 11 ms ; une
    // journée doit rester très en deçà des dizaines de secondes.
    const sim = buildVillageSim(5);
    const t0 = performance.now();
    simulateOneDay(sim);
    const elapsed = performance.now() - t0;
    // Généreux d'un facteur cinq : ce banc retient un effondrement, pas une
    // fluctuation de machine.
    expect(elapsed, `une journée a pris ${elapsed.toFixed(0)} ms`).toBeLessThan(20000);
  });

  it('LE LOUP TROUVE ENCORE SES PROIES DANS LE MONDE ÉLARGI', () => {
    const sim = buildVillageSim(3);
    expect(sim.world.objectsOfType('hunting_ground').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Étape 2 : lancer le test**

```bash
cd packages/simulation && npx vitest run test/load.test.ts
```

Attendu : SUCCÈS, 5 tests. Si le budget de la journée est dépassé, ne pas relever le seuil : chercher ce qui, dans le tick, croît avec le nombre d'objets.

- [ ] **Étape 3 : lancer toute la suite et le typecheck**

```bash
cd packages/simulation && npx vitest run
cd ../.. && pnpm typecheck && pnpm -w run check:single-three
```

Attendu : SUCCÈS partout, 0 erreur de type, garde-fou `three` unique au vert.

- [ ] **Étape 4 : commiter**

```bash
git add packages/simulation/test/load.test.ts
git commit -m "test(simulation): banc de tenue en charge du monde peuplé"
```

---

## Vérification finale

- [ ] **Suites complètes des deux paquets et de la racine**

```bash
cd /Volumes/AZA-SSD/MyWorkspace/github/iwsdk-phoenix-monorepo/iwsdk-plugin-phoenix
pnpm test
pnpm typecheck
pnpm -w run check:single-three
node --test scripts/__tests__/
```

Attendu : tout au vert. Le paquet `@iwsdk/phoenix-world` et l'application de démonstration ne sont pas touchés par ce plan — s'ils échouent, la cause est ailleurs.

- [ ] **Vérifier de visu dans la démonstration**

Lancer `pnpm dev` dans `apps/demo`, ouvrir la page, et vérifier trois choses :

1. Le village est intact — trois foyers allumés, trois abris, onze villageois.
2. Les arbres visibles sont désormais récoltables : un villageois qui manque de bois doit s'éloigner du village vers un bosquet, au lieu de tourner autour des quatre chênes calés à la main.
3. La fréquence d'image ne s'effondre pas au fil des minutes. Laisser tourner **au moins cinq minutes** : le défaut de fuite de la flore de la phase 5 ne s'était vu qu'à ce prix.

Ce dernier point n'est pas une formalité. Aucun des dix-sept défauts trouvés dans les phases précédentes ne l'a été en lisant du code.
