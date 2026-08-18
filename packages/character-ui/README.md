# @iwsdk/cardinal-character-ui

Panneaux spatiaux UIKitML pour viser un villageois, régler ses gènes et lire
son état mental.

## Ce que fait ce paquet

Un panneau UIKitML est un document : des éléments identifiés par `id`, dont on
peut changer les propriétés (`display`, `backgroundOpacity`, …) et le texte.
Ce paquet définit ce contrat sous une interface minimale, `PanelDocument` /
`PanelElement` (voir `src/document.ts`), qui ne dépend ni de Three ni
d'UIKitML : un contrôleur écrit contre cette interface se teste en Node avec
un document factice, sans analyseur de balisage, sans polices, sans réseau.

`CharacterUIRoute` (`src/components.ts`) est le composant ECS qui porte
l'onglet visible — `settings` ou `persona`. `TabRouter` (`src/router.ts`) est
le routeur qui applique cette route au document : un onglet en
`display: flex`, les autres en `display: none`, et le bouton du pied de page
correspondant marqué actif.

## IWSDK ne fournit aucune navigation entre panneaux

C'est pourquoi ce paquet existe : le routeur est notre propre code, pas une
fonctionnalité du moteur. Il tient une seule règle — ne jamais laisser deux
onglets visibles à la fois — et un test le vérifie explicitement.

## Usage

```ts
import { TabRouter, TAB_IDS, TAB_BUTTON_IDS, type PanelDocument } from '@iwsdk/cardinal-character-ui';

declare const panel: PanelDocument; // ex. un UIKitMLAsset instancié

const router = new TabRouter(panel);
router.show('persona');
router.current; // 'persona'
```

## `installCharacterUI` — le seul point d'entrée pour une application

Tout ce qui précède (document, routeur, jauge, onglets, sélection au rayon,
placement) est câblé par une seule fonction :

```ts
import { installCharacterUI } from '@iwsdk/cardinal-character-ui';

const ui = await installCharacterUI(world, {
  assetId: 'character-panel', // optionnel — c'est déjà le défaut
  persona: (entity) => { /* résout un PersonaView, ou null */ },
  inertGenes: (entity) => new Set(['jawWidth', /* … */]),
});

// plus tard, au démontage du panneau :
ui.dispose();
```

Elle :

- enregistre `CharacterUIRoute` et les deux systèmes du paquet,
  `CharacterPickSystem` à la **priorité 90** (après l'animation, 80) et
  `CharacterPanelPlacementSystem` à la **priorité 92** (après la sélection,
  puisque le placement a besoin de sa cible) ;
- instancie le panneau depuis le manifeste (`options.assetId`, par défaut
  `'character-panel'`) via `world.assets.instantiate` — jamais un chargeur
  brut — et le monte dans le graphe de scène avec
  `world.createTransformEntity` ;
- crée l'entité de sélection (singleton `CharacterSelection` +
  `CharacterUIRoute`) que `CharacterPickSystem` alimente quand un rayon (ou
  clic souris, même chemin) presse un personnage ;
- fait tourner une boucle de rafraîchissement toutes les 100 ms : le nom de
  la cible au pied de page, l'onglet Réglages (toujours), l'onglet Persona
  seulement s'il est actif et au plus 4 fois par seconde (`PERSONA_PERIOD_MS`
  = 250 ms — Persona porte des données par frame côté simulation, les relire
  à 90 Hz allouerait pour un texte que l'œil ne suit pas) ;
- route l'écriture d'un gène vers le bon composant : `CharacterStructure` si
  la clé appartient à son schéma, `CharacterFace` sinon (les gènes de
  surface ne sont jamais transmis jusqu'ici — voir `NON_EDITABLE_GENES`).

`ui.dispose()` coupe le minuteur et dispose le document UIKitML — même
raison que `entity.dispose()` plutôt que `destroy()` : un document non
disposé fuit.

### `PersonaView` — le contrat à la frontière

`@iwsdk/cardinal-character-ui` ne dépend **jamais** de
`@iwsdk/cardinal-simulation`. `CharacterSelection` porte une `Entity`, pas un
identifiant d'agent ; l'état mental d'un agent (besoins, action, plan) se lit
par identifiant dans le moteur de simulation, et seule l'application connaît
les deux à la fois. C'est pourquoi `persona` et `inertGenes` sont des
fonctions **injectées** : `installCharacterUI` prend une `Entity`, l'appelant
rend soit `null` (rien à montrer), soit un `PersonaView` — nom, tribu, rôle,
texte de persona, cinq besoins 0–100, action en cours, plan. Importer la
simulation depuis ce paquet le rendrait inutilisable dans tout projet qui n'a
pas ce moteur, pour un onglet sur deux.

Même logique pour `inertGenes` : les gènes sans effet sur le rig COURANT
(zéro morph target, un seul maillage) dépendent du `ImportReport` que
`createCharacterFromAsset` rend à la création de CHAQUE personnage — ce
paquet ne le garde pas, donc il ne peut pas le dériver lui-même. L'appelant
type le passe en fonction de l'entité.

Dans la démo (`apps/demo/src/index.ts`), le pont est deux `Map` remplies
dans `buildRig`, au moment où l'entité, l'agent et le rapport d'import sont
tous les trois en main :

```ts
agentIdParEntite.set(entity, agent.id);
rapportsParEntite.set(entity, new Set([...report.missingMorphs, ...report.missingSurfaces]));
```

### Le contrat d'identifiants

Les contrôleurs de ce paquet (`GENE_ROW_IDS`, `NEED_ROW_IDS`, `PERSONA_IDS`,
`TAB_IDS`, `TAB_BUTTON_IDS`, `PANEL_IDS`) appellent `getElementById` avec des
identifiants FIXES. Un document UIKitML réel qui n'en porte pas un échoue en
silence — `getElementById` rend `null`, et l'appel optionnel (`?.`) ne lève
jamais. `apps/demo/test/uikitml-ids.test.ts` confronte le fichier
`apps/demo/public/ui/character.uikitml` à ces mêmes exports et tombe si l'un
manque : c'est le seul test qui peut attraper cette panne, puisqu'un document
factice (celui de ce paquet) ne la voit jamais par construction.

## Tests

```bash
pnpm --filter @iwsdk/cardinal-character-ui test
```

`test/install.test.ts` couvre `installCharacterUI` avec un monde réel
(`@iwsdk/cardinal-character-three` installé) et un document UIKitML factice —
seul le CHARGEMENT de l'asset est simulé, tout le reste (composants,
systèmes, entités) est le code de production. Le squelette compilé, lui,
n'existe que dans une vraie application : `apps/demo/test/character-panel-integration.test.ts`
monte un personnage complet, sélectionne-le au rayon, clique sur `[+]` via le
gestionnaire posé par `installCharacterUI`, fait tourner
`CharacterCompileSystem`, et vérifie qu'un OS a réellement bougé.
