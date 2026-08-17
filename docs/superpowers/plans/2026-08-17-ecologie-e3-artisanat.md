# Écologie E3 — Chaînes d'artisanat — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner une raison de vouloir plus que le strict nécessaire — un outil qui multiplie le travail par trois, s'use, et renvoie chercher sa matière.

**Architecture:** Tout se joue dans le **contenu**, pas dans le moteur. Là où un multiplicateur d'outil exigerait des effets conditionnels, deux affordances distinctes sur le même objet suffisent : `gather_wood` à mains nues, `fell_tree` à la lame. Mode-1 note déjà les deux et retient la mieux notée. L'usure ne demande aucun état neuf : `flint_blade` **est** le compteur de durabilité.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Vitest, aucune dépendance nouvelle. Le paquet `@iwsdk/cardinal-simulation` pour le contenu, `apps/demo` pour la narration seulement.

**Spec:** `docs/superpowers/specs/2026-08-17-ecologie-e3-artisanat-design.md`

## Contraintes globales

- **Rien ne se crée.** `applyAffordance` borne les états à zéro, ce qui protège l'objet mais **pas le bilan** : une affordance qui prélève 3 unités doit exiger `>=3` en précondition, sinon un chêne à 2 bois en rendrait 3. La règle vaut pour toute affordance prélevant plus d'une unité.
- **Aucune modification de Mode-1.** Sa profondeur de chaînage reste à 3 et son amortissement à 0,7. Ce sous-projet est conçu pour ne pas en dépendre.
- **L'outil multiplie, il ne conditionne jamais.** Toute action outillée doit avoir son équivalent à mains nues, faute de quoi la survie dépendrait d'une délibération — donc d'un service externe.
- **Le déterminisme est non négociable.** Deux exécutions au même seed rendent le même instantané.
- **Commandes.** Depuis `packages/simulation` : `npx vitest run test/<fichier>` pour un test, `npx vitest run` pour la suite. Depuis la racine : `pnpm typecheck`, `pnpm test`.
- **Français pour les commentaires neufs**, comme les phases récentes.

---

## Structure des fichiers

| Fichier | Responsabilité | Tâche |
| :--- | :--- | :--- |
| `packages/simulation/src/content/objects.ts` (modifié) | `fell_tree`, `craft_spear`, `hunt_spear`, `knap_flint` à trois lames | 1, 2 |
| `packages/simulation/test/crafting.test.ts` (créé) | Les deux voies, la conservation, l'usure, la préférence de Mode-1 | 1, 2 |
| `apps/demo/src/simulation/CardinalSimulationSystem.ts` (modifié) | Les phrases françaises des verbes | 3 |
| `packages/simulation/src/content/verbs.ts` (créé) | La liste des verbes du contenu, pour que la narration ne puisse plus en oublier | 3 |
| `packages/simulation/test/verbs.test.ts` (créé) | Tout verbe déclaré est un verbe connu | 3 |
| `packages/simulation/test/crafting-behaviour.test.ts` (créé) | La prédiction du §5, et le budget par tick | 4 |

---

## Tâche 1 — La chaîne du bois

La plus courte, et celle qui prouve le mécanisme. `flint_blade` cesse d'être un produit sans usage.

**Fichiers :**
- Modifier : `packages/simulation/src/content/objects.ts` (définitions `oak_tree` et `river_bank`)
- Test : `packages/simulation/test/crafting.test.ts` (créé)

**Interfaces :**
- Consomme : `SmartObjectRegistry`, `registerDefaultContent`, `checkAffordance`, `applyAffordance` — tous existants.
- Produit : le verbe `fell_tree` sur `oak_tree` ; `knap_flint` rend désormais `flint_blade: 3`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/simulation/test/crafting.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { checkAffordance, applyAffordance } from '../src/world/affordances';

function registry(): SmartObjectRegistry {
  const r = new SmartObjectRegistry();
  registerDefaultContent(r);
  return r;
}

function affordance(type: string, verb: string) {
  const def = registry().get(type).affordances.find((a) => a.verb === verb);
  expect(def, `${type} n'a pas de verbe ${verb}`).toBeDefined();
  return def!;
}

const acteur = (inventory: Record<string, number> = {}) => ({
  x: 0,
  z: 0,
  inventory,
  needs: { hunger: 80, warmth: 80, energy: 80, affection: 80, stress: 0 },
});

describe('la lame de silex sert enfin à quelque chose', () => {
  it("ABATTRE REND TROIS FOIS PLUS QUE RAMASSER, et use la lame", () => {
    // `flint_blade` était produit par knap_flint et consommé par personne :
    // une chaîne d'artisanat qui s'arrêtait à son premier maillon.
    const chene = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 8 } };
    const acteurAvecLame = acteur({ flint_blade: 1 });

    const abattre = affordance('oak_tree', 'fell_tree');
    expect(checkAffordance(abattre, chene, acteurAvecLame).ok).toBe(true);
    applyAffordance(abattre, chene, acteurAvecLame);

    expect(acteurAvecLame.inventory.wood).toBe(3);
    expect(acteurAvecLame.inventory.flint_blade).toBe(0); // la lame s'est usée
    expect(chene.state.woodLeft).toBe(5);
  });

  it('LAISSE TOUJOURS RAMASSER À MAINS NUES', () => {
    // Le principe directeur : l'outil multiplie, il ne conditionne jamais.
    // Sans cette voie, la survie dépendrait d'une délibération — donc d'un
    // service externe qui peut être éteint.
    const chene = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 8 } };
    const nu = acteur();
    const ramasser = affordance('oak_tree', 'gather_wood');
    expect(checkAffordance(ramasser, chene, nu).ok).toBe(true);
    applyAffordance(ramasser, chene, nu);
    expect(nu.inventory.wood).toBe(1);
  });

  it("REFUSE D'ABATTRE SANS LAME, et le dit", () => {
    const chene = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 8 } };
    const refus = checkAffordance(affordance('oak_tree', 'fell_tree'), chene, acteur());
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.reason).toContain('flint_blade');
  });

  it('RIEN NE SE CRÉE : un chêne presque vide ne rend pas trois bois', () => {
    // applyAffordance borne les états à zéro, ce qui protège l'objet mais non
    // le bilan : sans précondition, deux bois restants en donneraient trois.
    const presqueVide = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 2 } };
    const refus = checkAffordance(affordance('oak_tree', 'fell_tree'), presqueVide, acteur({ flint_blade: 1 }));
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.reason).toContain('woodLeft');
  });

  it("UN ROGNON DONNE TROIS LAMES : c'est l'usure qui crée la demande", () => {
    // Sans plusieurs lames par rognon, chaque abattage renverrait tailler,
    // et le silex du village s'épuiserait en une journée.
    const berge = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 6 } };
    const tailleur = acteur({ flint: 1 });
    applyAffordance(affordance('river_bank', 'knap_flint'), berge, tailleur);
    expect(tailleur.inventory.flint_blade).toBe(3);
    expect(tailleur.inventory.flint).toBe(0);
  });

  it('la boucle se ferme : trois abattages épuisent un rognon', () => {
    const berge = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 6 } };
    const chene = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 40 } };
    const bucheron = acteur({ flint: 1 });
    applyAffordance(affordance('river_bank', 'knap_flint'), berge, bucheron);

    const abattre = affordance('oak_tree', 'fell_tree');
    for (let i = 0; i < 3; i++) {
      expect(checkAffordance(abattre, chene, bucheron).ok, `abattage ${i + 1}`).toBe(true);
      applyAffordance(abattre, chene, bucheron);
    }
    expect(bucheron.inventory.flint_blade).toBe(0);
    expect(bucheron.inventory.wood).toBe(9);
    expect(checkAffordance(abattre, chene, bucheron).ok).toBe(false);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
cd packages/simulation && npx vitest run test/crafting.test.ts
```

Attendu : ÉCHEC — `oak_tree n'a pas de verbe fell_tree: expected undefined to be defined`.

- [ ] **Étape 3 : ajouter `fell_tree` au chêne**

Dans `packages/simulation/src/content/objects.ts`, remplacer la définition de `oak_tree` :

```ts
  registry.define('oak_tree', {
    affordances: [
      {
        verb: 'gather_wood',
        durationTicks: 40,
        preconditions: { objectState: { woodLeft: '>0' }, actorDistance: '<2' },
        effects: { object: { woodLeft: -1 }, actorInventory: { wood: 1 } },
      },
      {
        // L'outil multiplie le travail ; il ne le conditionne jamais. Ramasser
        // du bois mort reste possible à mains nues — c'est ce qui garantit que
        // la survie ne dépend d'aucune délibération.
        //
        // `woodLeft: '>=3'` n'est pas un détail : applyAffordance borne les
        // états à zéro, ce qui protège l'arbre mais non le bilan. Sans cette
        // précondition, un chêne où il reste deux bois en rendrait trois.
        verb: 'fell_tree',
        durationTicks: 90,
        preconditions: {
          objectState: { woodLeft: '>=3' },
          actorDistance: '<2',
          actorInventory: { flint_blade: '>=1' },
        },
        effects: {
          object: { woodLeft: -3 },
          actorInventory: { wood: 3, flint_blade: -1 },
        },
      },
    ],
    state: { woodLeft: 8 },
    regrowth: [{ field: 'woodLeft', perDay: 2, max: 8 }],
  });
```

- [ ] **Étape 4 : faire rendre trois lames à `knap_flint`**

Dans la définition de `river_bank`, remplacer l'affordance `knap_flint` :

```ts
      {
        // Un rognon de silex donne plusieurs lames — c'est littéralement vrai
        // de la taille du silex, et c'est ce qui fait de `flint_blade` un
        // compteur de durabilité sans qu'aucun état nouveau soit nécessaire.
        verb: 'knap_flint',
        durationTicks: 60,
        preconditions: { actorDistance: '<2', actorInventory: { flint: '>=1' } },
        effects: { actorInventory: { flint_blade: 3, flint: -1 } },
      },
```

- [ ] **Étape 5 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/crafting.test.ts
```

Attendu : SUCCÈS, 6 tests.

- [ ] **Étape 6 : lancer toute la suite et le typecheck**

```bash
cd packages/simulation && npx vitest run
cd ../.. && pnpm typecheck
```

Attendu : SUCCÈS, 0 erreur. `flint_blade` n'était consommé par personne, donc aucun test existant ne dépend de son ancien rendement.

- [ ] **Étape 7 : commiter**

```bash
git add packages/simulation/src/content/objects.ts packages/simulation/test/crafting.test.ts
git commit -m "feat(simulation): la lame de silex sert enfin — abattre rend trois fois plus, et l'use"
```

---

## Tâche 2 — La chaîne de la chasse

Plus longue d'un maillon, et c'est elle qui éloigne : les terrains de chasse sont à 15 m du village, contre 2 m pour les buissons.

**Fichiers :**
- Modifier : `packages/simulation/src/content/objects.ts` (définitions `river_bank` et `hunting_ground`)
- Test : `packages/simulation/test/crafting.test.ts` (étendu)

**Interfaces :**
- Consomme : le verbe `knap_flint` rendant `flint_blade: 3` (tâche 1).
- Produit : `craft_spear` sur `river_bank`, `hunt_spear` sur `hunting_ground`, et l'objet d'inventaire `spear`.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à la fin de `packages/simulation/test/crafting.test.ts` :

```ts
describe('le javelot, deuxième chaîne', () => {
  it('SE FABRIQUE D’UNE LAME ET D’UN BOIS, et les consomme', () => {
    const berge = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 6 } };
    const artisan = acteur({ flint_blade: 1, wood: 1 });
    const fabriquer = affordance('river_bank', 'craft_spear');

    expect(checkAffordance(fabriquer, berge, artisan).ok).toBe(true);
    applyAffordance(fabriquer, berge, artisan);

    expect(artisan.inventory.spear).toBe(1);
    expect(artisan.inventory.flint_blade).toBe(0);
    expect(artisan.inventory.wood).toBe(0);
  });

  it('ne se fabrique pas avec une lame seule', () => {
    const berge = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 6 } };
    const refus = checkAffordance(affordance('river_bank', 'craft_spear'), berge, acteur({ flint_blade: 1 }));
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.reason).toContain('wood');
  });

  it("REND TROIS FOIS PLUS DE VIANDE POUR UNE MÊME BÊTE", () => {
    // Le javelot ne donne pas plus d'animaux : il en tire davantage. Le stock
    // du terrain baisse d'une unité dans les deux cas, ce qui interdit à
    // l'outil de multiplier la ressource elle-même.
    const terrain = { id: 'hunting_ground_1', type: 'hunting_ground', x: 0, z: 0, state: { gameLeft: 5 } };
    const chasseur = acteur({ spear: 1 });
    applyAffordance(affordance('hunting_ground', 'hunt_spear'), terrain, chasseur);

    expect(chasseur.inventory.meat).toBe(3);
    expect(chasseur.inventory.spear).toBe(0); // le javelot se brise
    expect(terrain.state.gameLeft).toBe(4);
  });

  it('LAISSE TOUJOURS CHASSER À MAINS NUES', () => {
    const terrain = { id: 'hunting_ground_1', type: 'hunting_ground', x: 0, z: 0, state: { gameLeft: 5 } };
    const nu = acteur();
    expect(checkAffordance(affordance('hunting_ground', 'hunt'), terrain, nu).ok).toBe(true);
    applyAffordance(affordance('hunting_ground', 'hunt'), terrain, nu);
    expect(nu.inventory.meat).toBe(1);
  });

  it('refuse le javelot sur un terrain vide, comme la chasse à mains nues', () => {
    const vide = { id: 'hunting_ground_1', type: 'hunting_ground', x: 0, z: 0, state: { gameLeft: 0 } };
    expect(checkAffordance(affordance('hunting_ground', 'hunt_spear'), vide, acteur({ spear: 1 })).ok).toBe(false);
    expect(checkAffordance(affordance('hunting_ground', 'hunt'), vide, acteur()).ok).toBe(false);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
cd packages/simulation && npx vitest run test/crafting.test.ts
```

Attendu : ÉCHEC — `river_bank n'a pas de verbe craft_spear`.

- [ ] **Étape 3 : ajouter `craft_spear` à la berge**

Dans `packages/simulation/src/content/objects.ts`, ajouter cette affordance à `river_bank`, après `knap_flint` :

```ts
      {
        // Assembler se fait là où l'on taille. Aucun établi : le lieu suffit,
        // et un objet de plus dans le monde n'apporterait rien au modèle.
        verb: 'craft_spear',
        durationTicks: 90,
        preconditions: {
          actorDistance: '<2',
          actorInventory: { flint_blade: '>=1', wood: '>=1' },
        },
        effects: { actorInventory: { spear: 1, flint_blade: -1, wood: -1 } },
      },
```

- [ ] **Étape 4 : ajouter `hunt_spear` au terrain de chasse**

Dans la définition de `hunting_ground`, ajouter après `hunt` :

```ts
      {
        // Le javelot ne donne pas plus de bêtes : il en tire davantage. Le
        // stock baisse d'une unité comme à mains nues, ce qui interdit à
        // l'outil de multiplier la ressource elle-même.
        verb: 'hunt_spear',
        durationTicks: 80,
        preconditions: {
          objectState: { gameLeft: '>0' },
          actorDistance: '<3',
          actorInventory: { spear: '>=1' },
        },
        effects: { object: { gameLeft: -1 }, actorInventory: { meat: 3, spear: -1 } },
      },
```

- [ ] **Étape 5 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/crafting.test.ts
```

Attendu : SUCCÈS, 11 tests.

- [ ] **Étape 6 : lancer toute la suite et le typecheck**

```bash
cd packages/simulation && npx vitest run
cd ../.. && pnpm typecheck
```

Attendu : SUCCÈS, 0 erreur.

- [ ] **Étape 7 : commiter**

```bash
git add packages/simulation/src/content/objects.ts packages/simulation/test/crafting.test.ts
git commit -m "feat(simulation): le javelot — une lame et un bois, trois fois plus de viande"
```

---

## Tâche 3 — Aucun verbe ne reste muet

Le HUD affiche déjà « Narek hunt. » et « Aya eat_meat. » : deux verbes du contenu que la table française a oubliés. Trois verbes neufs arrivent — sans garde-fou, ils s'y ajouteront.

**Fichiers :**
- Créer : `packages/simulation/src/content/verbs.ts`
- Modifier : `packages/simulation/src/index.ts`, `apps/demo/src/simulation/CardinalSimulationSystem.ts:38-57`
- Test : `packages/simulation/test/verbs.test.ts` (créé)

**Interfaces :**
- Consomme : `SmartObjectRegistry.types(): string[]` et `.get(type).affordances` — tous deux **déjà présents** —, `registerDefaultContent`, `defaultIntrinsics`.
- Produit : `contentVerbs(): string[]`, exporté depuis `@iwsdk/cardinal-simulation`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/simulation/test/verbs.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { contentVerbs } from '../src/content/verbs';

describe('contentVerbs', () => {
  it('ÉNUMÈRE TOUT CE QUE LES AGENTS PEUVENT FAIRE, objets et gestes propres', () => {
    // La narration, les jeux de données et l'interface doivent pouvoir demander
    // « quels verbes existe-t-il ? » à une seule source. Sans elle, un verbe
    // neuf sort en anglais dans le HUD, comme `hunt` et `eat_meat` l'ont fait.
    const verbes = contentVerbs();
    for (const attendu of [
      'gather_wood',
      'fell_tree',
      'hunt',
      'hunt_spear',
      'craft_spear',
      'knap_flint',
      'eat_meat',
      'nap',
    ]) {
      expect(verbes, attendu).toContain(attendu);
    }
  });

  it('ne rend aucun doublon, et les rend triés', () => {
    const verbes = contentVerbs();
    expect(new Set(verbes).size).toBe(verbes.length);
    expect([...verbes].sort()).toEqual(verbes);
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```bash
cd packages/simulation && npx vitest run test/verbs.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "../src/content/verbs"`.

- [ ] **Étape 3 : implémenter**

Créer `packages/simulation/src/content/verbs.ts` :

```ts
import { SmartObjectRegistry } from '../world/SmartObject';
import { registerDefaultContent } from './objects';
import { defaultIntrinsics } from '../agents/intrinsics';

/**
 * Tous les verbes que le contenu déclare — affordances d'objets et gestes
 * propres confondus, triés et sans doublon.
 *
 * La narration du HUD tenait sa propre liste, et en avait oublié deux :
 * « Narek hunt. », « Aya eat_meat. » s'affichaient en anglais au milieu du
 * français. Une source unique rend l'oubli détectable.
 */
export function contentVerbs(): string[] {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  const verbes = new Set<string>();
  for (const type of registry.types()) {
    for (const affordance of registry.get(type).affordances) verbes.add(affordance.verb);
  }
  for (const intrinsic of defaultIntrinsics()) verbes.add(intrinsic.verb);
  return [...verbes].sort();
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```bash
cd packages/simulation && npx vitest run test/verbs.test.ts
```

Attendu : SUCCÈS, 2 tests.

- [ ] **Étape 5 : exporter depuis le paquet**

Dans `packages/simulation/src/index.ts`, à côté des autres exports de contenu :

```ts
export { contentVerbs } from './content/verbs';
```

Puis reconstruire le paquet, sans quoi la démo compilera contre des types périmés :

```bash
cd packages/simulation && npx tsup
```

- [ ] **Étape 6 : compléter la table française et la garder**

Dans `apps/demo/src/simulation/CardinalSimulationSystem.ts`, remplacer le bloc `VERB_LABELS` :

```ts
const VERB_LABELS: Record<string, string> = {
  gather_berries: 'cueille des baies',
  gather_wood: 'ramasse du bois mort',
  fell_tree: 'abat un chêne à la lame',
  gather_flint: 'extrait un éclat de silex',
  knap_flint: 'taille des lames de silex',
  craft_spear: 'monte un javelot',
  hunt: 'chasse à mains nues',
  hunt_spear: 'chasse au javelot',
  light_fire: 'allume le feu de camp',
  add_wood: 'nourrit le feu',
  rest_nearby: 'se repose près du feu',
  sleep_inside: "dort à l'abri",
  build: "renforce l'abri",
  drink: 'boit à la rivière',
  fish: 'pêche dans la rivière',
  deposit_berries: 'dépose des baies au campement',
  take_berries: 'prend des baies de la réserve',
  deposit_wood: 'dépose du bois au campement',
  take_wood: 'prend du bois de la réserve',
  eat_berries: 'mange des baies',
  eat_fish: 'mange un poisson',
  eat_meat: 'mange de la viande',
  nap: 'fait une sieste',
};
```

- [ ] **Étape 7 : ajouter le garde-fou qui empêche l'oubli de revenir**

Dans `packages/simulation/test/verbs.test.ts`, compléter l'en-tête d'imports avec `import { readFileSync } from 'node:fs';`, puis ajouter à la fin du fichier :

```ts
describe('la narration française ne laisse aucun verbe derrière', () => {
  it('TRADUIT CHAQUE VERBE DU CONTENU', () => {
    // Le HUD affichait « Narek hunt. » et « Aya eat_meat. » : la table
    // française vivait de son côté et avait pris du retard sur le contenu.
    const source = readFileSync(
      new URL('../../../apps/demo/src/simulation/CardinalSimulationSystem.ts', import.meta.url),
      'utf8'
    );
    const bloc = source.slice(source.indexOf('const VERB_LABELS'), source.indexOf('const WEATHER_LABELS'));
    for (const verbe of contentVerbs()) {
      expect(bloc, `${verbe} n'a pas de phrase française`).toContain(`${verbe}:`);
    }
  });
});
```

- [ ] **Étape 8 : lancer les tests et le typecheck**

```bash
cd packages/simulation && npx vitest run test/verbs.test.ts && npx vitest run
cd ../.. && pnpm typecheck
```

Attendu : SUCCÈS, 3 tests dans `verbs.test.ts`, 0 erreur de type.

- [ ] **Étape 9 : commiter**

```bash
git add packages/simulation/src/content/verbs.ts packages/simulation/src/index.ts \
        packages/simulation/src/world/SmartObject.ts packages/simulation/test/verbs.test.ts \
        apps/demo/src/simulation/CardinalSimulationSystem.ts
git commit -m "feat(simulation): une source unique des verbes, et plus aucune chronique en anglais"
```

---

## Tâche 4 — La prédiction, mise à l'épreuve

Le §5 de la spec annonce que **le réflexe seul ne fabriquera jamais d'outil** : `knap_flint` et `craft_spear` n'ont aucun effet sur un besoin, donc un gain propre nul, et la chaîne du javelot compte cinq étages quand Mode-1 s'arrête à trois. Ce test fige cette prédiction — et devra être révisé le jour où Mode-1 chaînera plus profond.

**Fichiers :**
- Test : `packages/simulation/test/crafting-behaviour.test.ts` (créé)

**Interfaces :**
- Consomme : `buildVillageSim(seed): VillageSim`, `VillageSim.runtime.agents` (**une `Map`**), `SimKernel.advance(realDeltaSeconds)`, `runtime.subscribeEvents`.
- **Piège du moteur** : `SimKernel` plafonne à `MAX_TICKS_PER_ADVANCE = 1000` ticks par appel et remet son accumulateur à zéro au-delà. Un `advance(240)` ne simulerait donc PAS 2 400 ticks. On avance par tranches.

- [ ] **Étape 1 : écrire le test**

Créer `packages/simulation/test/crafting-behaviour.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildVillageSim, type VillageSim } from '../src/content/scenario';

/** Huit jours, par tranches de 100 ticks : le noyau plafonne à 1 000 par appel. */
function simulate(sim: VillageSim, jours: number): Record<string, number> {
  const faits: Record<string, number> = {};
  sim.runtime.subscribeEvents((e) => {
    if (e.type === 'completed') faits[e.verb] = (faits[e.verb] ?? 0) + 1;
  });
  for (let j = 0; j < jours; j++) for (let i = 0; i < 24; i++) sim.kernel.advance(10);
  return faits;
}

describe('en réflexe pur, le village ne fabrique aucun outil', () => {
  it("NE TAILLE NI NE MONTE RIEN, faute de pouvoir planifier si loin", { timeout: 180000 }, () => {
    // Prédiction centrale du sous-projet (spec §5). Ce n'est PAS un défaut :
    // c'est le prix assumé du principe « l'outil multiplie, il ne conditionne
    // jamais ». Le jour où Mode-1 chaînera au-delà de trois niveaux, ou où une
    // délibération tournera dans ces tests, ce test devra être révisé — et son
    // échec sera une bonne nouvelle.
    const faits = simulate(buildVillageSim(3), 8);
    expect(faits.knap_flint ?? 0, 'des lames taillées sans délibération').toBe(0);
    expect(faits.craft_spear ?? 0, 'un javelot monté sans délibération').toBe(0);
    expect(faits.fell_tree ?? 0, 'un chêne abattu sans lame').toBe(0);
    expect(faits.hunt_spear ?? 0, 'une chasse au javelot sans javelot').toBe(0);
  });

  it('CONTINUE DE VIVRE malgré tout : les voies à mains nues suffisent', () => {
    // La contrepartie du même principe, et la plus importante : le village
    // survit sans outil. Si ce test tombait, la survie dépendrait d'un LLM.
    const faits = simulate(buildVillageSim(3), 8);
    expect(faits.gather_wood ?? 0, 'du bois ramassé').toBeGreaterThan(0);
    expect(faits.hunt ?? 0, 'de la chasse à mains nues').toBeGreaterThan(0);
    expect(faits.eat_berries ?? 0, 'des repas').toBeGreaterThan(0);
  });

  it('LE BUDGET PAR TICK TIENT malgré six affordances de plus', { timeout: 180000 }, () => {
    // Le coût de selectAction croît avec le nombre d'affordances par objet cru.
    // Généreux d'un facteur cinq : ce banc retient un effondrement, pas une
    // fluctuation de machine.
    const sim = buildVillageSim(5);
    const t0 = performance.now();
    for (let i = 0; i < 24; i++) sim.kernel.advance(10);
    const elapsed = performance.now() - t0;
    expect(elapsed, `une journée a pris ${elapsed.toFixed(0)} ms`).toBeLessThan(20000);
  });
});
```

- [ ] **Étape 2 : lancer le test**

```bash
cd packages/simulation && npx vitest run test/crafting-behaviour.test.ts
```

Attendu : SUCCÈS, 3 tests.

**Si le premier test ÉCHOUE** — c'est-à-dire si des outils sont fabriqués sans délibération — ne pas le « corriger » en assouplissant l'assertion. Cela signifierait que la prédiction du §5 est fausse, ce qui est une découverte : mesurer par quel chemin Mode-1 y parvient (probablement un gain hérité plus élevé que prévu), le rapporter, et réviser la spec avant de continuer.

- [ ] **Étape 3 : mesurer ce que le monde y gagne, pour mémoire**

Écrire un fichier de mesure jetable `packages/simulation/test/_e3.test.ts` :

```ts
import { it } from 'vitest';
import { buildVillageSim } from '../src/content/scenario';
it('ce que E3 change au village', { timeout: 180000 }, () => {
  const sim = buildVillageSim(3);
  const faits: Record<string, number> = {};
  sim.runtime.subscribeEvents((e) => {
    if (e.type === 'completed') faits[e.verb] = (faits[e.verb] ?? 0) + 1;
  });
  let loin = 0;
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 24; i++) {
      sim.kernel.advance(10);
      for (const a of sim.runtime.agents.values()) loin = Math.max(loin, Math.hypot(a.x, a.z));
    }
  console.log(`eloignement max : ${loin.toFixed(1)} m`);
  console.log('actions :', Object.entries(faits).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
});
```

Le lancer, noter les chiffres dans le message de commit, puis le supprimer :

```bash
cd packages/simulation && npx vitest run test/_e3.test.ts && rm test/_e3.test.ts
```

- [ ] **Étape 4 : vérification complète**

```bash
cd /Volumes/AZA-SSD/MyWorkspace/github/iwsdk-phoenix-monorepo/iwsdk-plugin-phoenix
pnpm test
pnpm typecheck
node scripts/check-single-three.mjs
```

Attendu : tout au vert, 0 erreur de type, garde-fou `three` unique OK.

- [ ] **Étape 5 : commiter**

```bash
git add packages/simulation/test/crafting-behaviour.test.ts
git commit -m "test(simulation): la prédiction du §5 — le réflexe seul ne fabrique aucun outil"
```

---

## Vérification finale

- [ ] **Vérifier de visu dans la démonstration**

Lancer `npx iwsdk dev up` depuis `apps/demo`, puis :

```bash
npx iwsdk browser logs --input-json '{"pattern":"chasse|abat|javelot|lame","count":40}'
```

Trois choses à constater :

1. **Aucune chronique en anglais.** Plus de « Narek hunt. » : les phrases françaises couvrent tous les verbes.
2. **Les villageois chassent et ramassent** comme avant — les voies à mains nues n'ont pas régressé.
3. **Aucun outil fabriqué**, tant qu'aucune délibération ne tourne. C'est attendu, et c'est ce que le prochain jalon changera.

- [ ] **La suite naturelle, à ne pas faire dans ce plan**

Activer la délibération — le panneau d'IA locale, ou le BFF — et remesurer. **L'écart entre les deux exécutions est le premier chiffre du banc d'essai** : ce que vaut le raisonnement d'un modèle, en unités du monde. C'est un travail à part, avec sa propre mesure.
