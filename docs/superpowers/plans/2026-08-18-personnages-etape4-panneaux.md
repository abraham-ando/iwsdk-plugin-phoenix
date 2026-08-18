# Étape 4 — Les panneaux spatiaux : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** viser un villageois, voir un panneau apparaître à côté de lui, régler ses gènes et lire son état mental — en immersion comme hors immersion.

**Architecture :** un paquet `@iwsdk/cardinal-character-ui` qui expose `installCharacterUI(world, options)`. Un seul document UIKitML à trois zones (Réglages, Persona, pied de page), un routeur d'onglets par `classList`, une jauge `[−]`/`[+]` faute de curseur natif, et trois systèmes : sélection au rayon, placement auprès de la cible, rafraîchissement de Persona. Le paquet ne dépend jamais de la simulation : l'application lui injecte un résolveur de persona.

**Tech Stack :** TypeScript 5.9, pnpm workspace, vitest, tsup, `@iwsdk/core@0.5.3` (UIKitML via `@drawcall/uikitml`, Three r181 réexporté), elics 3.4.2, Node ≥ 20.19.

**Spec :** `docs/superpowers/specs/2026-08-18-personnages-etape4-panneaux-design.md`

## Global Constraints

- **Three s'importe depuis `@iwsdk/core`**, jamais depuis `three`.
- **`skeleton.calculateInverses()` ne doit apparaître nulle part.**
- **Les assets se chargent par `AssetManager` / le manifeste**, jamais par un chargeur brut dans `src/`.
- **Aucune allocation dans `update()`.** Allouer dans `init()` en propriétés de classe. Budget VR : 11–14 ms par frame.
- **`setValue` lève sur `Types.Color`, `Vec2/3/4`** en elics 3.4.x : passer par `entity.getVectorView(...)`.
- **`Types.Enum` attend une MAP `{ clé: valeur }`, jamais un tableau** — elics valide le défaut par `Object.values(enum).includes(default)`.
- **`entity.dispose()`, jamais `entity.destroy()`** ; **`document.dispose()`** au démontage du panneau.
- **`noUncheckedIndexedAccess` est actif** dans les paquets : tout accès indexé gardé ou suffixé de `!`.
- **Les tailles du document sont écrites en centimètres**, sans suffixe `px`, une fois la tâche 1 confirmée.
- **Commentaires en français**, descriptions de tests comprises.
- Ne pas retirer le correctif `@pmndrs/uikit` de `patchedDependencies` : les accents en dépendent, et `scripts/__tests__/uikit-charset.test.mjs` tombe s'il disparaît.
- Avant chaque commit : `pnpm --filter <paquet> test`, `pnpm typecheck`, `pnpm build`.

---

## Structure des fichiers

| fichier | responsabilité |
| :--- | :--- |
| `packages/character-ui/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` | **créés** — échafaudage, calqué sur `character-three` |
| `packages/character-ui/src/components.ts` | **créé** — `CharacterUIRoute` |
| `packages/character-ui/src/document.ts` | **créé** — `PanelDocument`/`PanelElement`, l'interface étroite sans Three |
| `packages/character-ui/src/gauge.ts` | **créé** — le widget de jauge, pur |
| `packages/character-ui/src/router.ts` | **créé** — le routeur d'onglets |
| `packages/character-ui/src/tabs/settings.ts` | **créé** — contrôleur de l'onglet Réglages |
| `packages/character-ui/src/tabs/persona.ts` | **créé** — contrôleur de l'onglet Persona, et `PersonaView` |
| `packages/character-ui/src/systems/CharacterPickSystem.ts` | **créé** — `Pressed` → `CharacterSelection.target` |
| `packages/character-ui/src/systems/CharacterPanelPlacementSystem.ts` | **créé** — position auprès de la cible, orientation vers la caméra |
| `packages/character-ui/src/install.ts` | **créé** — `installCharacterUI` |
| `packages/character-ui/src/index.ts` | **créé** — surface publique |
| `apps/demo/public/ui/character.uikitml` | **créé** — le document |
| `apps/demo/src/components.ts` | **modifié** — les cinq composants déclarés |
| `apps/demo/src/index.ts` | **modifié** — installation et résolveur de persona |
| `apps/demo/src/assets.ts` | **modifié** — l'entrée de manifeste du panneau |
| `apps/demo/src/simulation/VillagerBody.ts` | **modifié** — `RayInteractable` sur les rigs |

---

## Task 1 : La sonde des centimètres

**Cette tâche ne produit aucun code de production. Elle produit un chiffre**, et ce chiffre décide de tous les autres. Elle passe en premier pour la même raison que l'applicateur skinné ouvrait l'étape 2 et la sonde réseau l'étape 3.

**Files :**
- Aucun fichier de production. Un fichier jetable, supprimé au Step 5.

**Interfaces :**
- Consumes : rien.
- Produces : la largeur monde, en mètres, d'un document déclarant `width: 400`.

- [ ] **Step 1 : Écrire un document de largeur connue**

Créer `apps/demo/public/ui/__probe.uikitml` :

```html
<style>
  .probe-root { width: 400; height: 200; background-color: #ff00ff; }
</style>
<div class="probe-root" id="probe-root"></div>
```

Pas de suffixe, pas de police, pas de réseau : uniquement ce qu'on mesure.

- [ ] **Step 2 : Le déclarer au manifeste**

Dans `apps/demo/src/assets.ts`, à l'intérieur de `defineAssets({ ... })` :

```ts
  'probe-panel': {
    url: publicAssetUrl('ui/__probe.uikitml'),
    type: AssetType.UIKitML,
    name: 'Sonde de mesure (jetable)',
    priority: 'lazy',
  },
```

- [ ] **Step 3 : Le monter et le mesurer**

Ajouter temporairement dans `apps/demo/src/index.ts`, après la création de la scène :

```ts
    void world.assets.instantiate('probe-panel').then((panel) => {
      world.createTransformEntity(panel);
      // Une frame de mise en page avant de mesurer : UIKit calcule sa taille
      // intrinsèque au premier rendu, pas à l'instanciation.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const boite = new Box3().setFromObject(panel);
          const taille = boite.getSize(new Vector3());
          console.log(
            `[SONDE] width déclarée 400 → ${taille.x.toFixed(4)} m × ${taille.y.toFixed(4)} m`,
          );
        });
      });
    });
```

Importer `Box3` et `Vector3` depuis `@iwsdk/core`.

- [ ] **Step 4 : Lire le résultat**

```bash
cd apps/demo && npx iwsdk dev up
```

Attendre `browserCommandReady: true`, puis :

```bash
npx iwsdk browser logs --count 200 | grep SONDE
```

**Interpréter, sans arrondir :**

- `4.0000 m` → l'unité est le **centimètre**. Le §2.1 de la spec est confirmé, la suite l'écrit en centimètres.
- `0.4000 m` → l'unité est le **millimètre**, ou une unité arbitraire à 1000 pour 1. La spec doit être corrigée avant la tâche 3.
- toute autre valeur → la noter telle quelle et corriger la spec avec le facteur observé.

Si `browser logs` n'existe pas sous ce nom, découvrir la bonne action par `npx iwsdk browser --help`.

- [ ] **Step 5 : Tout retirer**

```bash
rm apps/demo/public/ui/__probe.uikitml
```

Retirer l'entrée `probe-panel` du manifeste et le bloc de mesure d'`index.ts`.

```bash
git status --porcelain   # attendu : vide
```

- [ ] **Step 6 : Consigner**

Écrire le chiffre mesuré dans le §2.1 de la spec, en remplaçant « Cette règle est déduite, pas observée » par ce qui a été vu. Commiter **seulement** la spec :

```bash
git add docs/superpowers/specs/2026-08-18-personnages-etape4-panneaux-design.md
git commit -m "docs: mesurer l'unité UIKit au lieu de la déduire"
```

---

## Task 2 : Les composants déclarés à l'application

Trois lignes qui donnent les curseurs de l'inspecteur bureau avant qu'un panneau n'existe.

**Files :**
- Modify: `apps/demo/src/components.ts`
- Test: `apps/demo/test/components.test.ts` (créé)

**Interfaces :**
- Consumes : `CharacterIdentity`, `CharacterStructure`, `CharacterFace`, `CharacterSurface`, `CharacterSelection` de `@iwsdk/cardinal-character-three`.
- Produces : rien de nouveau — l'inspecteur les découvre par le manifeste de composants.

- [ ] **Step 1 : Écrire le test qui échoue**

Create `apps/demo/test/components.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  CharacterIdentity, CharacterStructure, CharacterFace,
  CharacterSurface, CharacterSelection,
} from '@iwsdk/cardinal-character-three';
import components from '../src/components';

describe('le manifeste de composants de la démo', () => {
  it('déclare les cinq composants de personnage', () => {
    // L'inspecteur IWSDK construit ses curseurs à partir de CE manifeste : un
    // composant absent d'ici n'est pas éditable, quelles que soient ses
    // métadonnées `min`/`max`/`step`.
    for (const composant of [
      CharacterIdentity, CharacterStructure, CharacterFace,
      CharacterSurface, CharacterSelection,
    ]) {
      expect(components).toContain(composant);
    }
  });

  it('garde le composant Robot préexistant', () => {
    // Retirer un composant du manifeste casse silencieusement l'édition de
    // scène : ce garde empêche de le faire en passant.
    expect(components.length).toBeGreaterThanOrEqual(6);
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo test components`
Expected : ÉCHEC — le manifeste ne contient que `Robot`.

- [ ] **Step 3 : Déclarer les composants**

Modify `apps/demo/src/components.ts` :

```ts
import { defineComponents } from '@iwsdk/core';
import {
  CharacterIdentity, CharacterStructure, CharacterFace,
  CharacterSurface, CharacterSelection,
} from '@iwsdk/cardinal-character-three';
import { Robot } from './robot-component.js';

// Les cinq composants de personnage figurent ici pour que l'inspecteur de
// l'éditeur managé rende leurs curseurs : il lit CE manifeste, et les
// métadonnées `label`, `min`, `max`, `step` que `gene()` porte déjà suffisent
// à produire une ligne bornée et étiquetée. Sans cette déclaration, aucune des
// treize valeurs n'est éditable hors du panneau spatial.
export default defineComponents([
  Robot,
  CharacterIdentity,
  CharacterStructure,
  CharacterFace,
  CharacterSurface,
  CharacterSelection,
]);
```

- [ ] **Step 4 : Vérifier**

Run : `pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck`
Expected : PASS

- [ ] **Step 5 : Commiter**

```bash
git add apps/demo/src/components.ts apps/demo/test/components.test.ts
git commit -m "feat(demo): declare the character components so the inspector can edit them"
```

---

## Task 3 : Le paquet, le document et le routeur

**Files :**
- Create: `packages/character-ui/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `README.md`
- Create: `packages/character-ui/src/components.ts`
- Create: `packages/character-ui/src/document.ts`
- Create: `packages/character-ui/src/router.ts`
- Create: `packages/character-ui/src/index.ts`
- Create: `packages/character-ui/test/fixtures/fakeDocument.ts`
- Create: `packages/character-ui/test/router.test.ts`
- Modify: `package.json` (racine — chaînes `build`, `test`, `typecheck`)

**Interfaces :**
- Consumes : `createComponent`, `Types` de `@iwsdk/core`.
- Produces :
  - `CharacterUIRoute` — composant à un champ `tab: Types.Enum`, valeurs `{ settings: 'settings', persona: 'persona' }`, défaut `'settings'`.
  - `interface PanelElement { setProperties(props: Record<string, unknown>): void; setText?(text: string): void; addEventListener?(type: string, handler: () => void): void; }`
  - `interface PanelDocument { getElementById(id: string): PanelElement | null | undefined; }`
  - `type TabId = 'settings' | 'persona';`
  - `class TabRouter { constructor(doc: PanelDocument); show(tab: TabId): void; get current(): TabId; }`
  - `makeFakeDocument(ids: readonly string[]): { doc: PanelDocument; props: Map<string, Record<string, unknown>>; texts: Map<string, string>; clicks: Map<string, () => void> }`

- [ ] **Step 1 : Échafauder le paquet**

Create `packages/character-ui/package.json` :

```json
{
  "name": "@iwsdk/cardinal-character-ui",
  "version": "0.1.0",
  "description": "Panneaux spatiaux UIKitML pour régler et inspecter un personnage",
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
  "dependencies": {
    "@iwsdk/cardinal-character": "workspace:*",
    "@iwsdk/cardinal-character-three": "workspace:*"
  },
  "engines": { "node": ">=20.19.0" }
}
```

Copier `tsconfig.json`, `tsup.config.ts` et `vitest.config.ts` depuis `packages/character-three/`, sans modification autre que les chemins s'il y en a.

Puis `pnpm install`.

- [ ] **Step 2 : Écrire l'interface de document**

Create `packages/character-ui/src/document.ts` :

```ts
/**
 * Ce que les panneaux savent faire d'un élément, sans dépendre de Three.
 *
 * Même motif que `LocalAiPanel` de la démo, et pour la même raison : un
 * contrôleur qui ne connaît que cette interface se teste en Node avec un
 * document factice — pas d'analyseur UIKitML, pas de polices, pas de réseau.
 * `LocalAiPanel` avait posé le motif sans jamais l'employer ; ici il sert.
 */
export interface PanelElement {
  setProperties(props: Record<string, unknown>): void;
  setText?(text: string): void;
  addEventListener?(type: string, handler: () => void): void;
}

export interface PanelDocument {
  getElementById(id: string): PanelElement | null | undefined;
}

/** Montre ou cache un élément. `flex` et non `block` : UIKit est en flexbox. */
export function show(el: PanelElement | null | undefined, visible: boolean): void {
  el?.setProperties({ display: visible ? 'flex' : 'none' });
}

/** Écrit un texte, si l'élément sait en porter un. */
export function setText(el: PanelElement | null | undefined, texte: string): void {
  el?.setText?.(texte);
}
```

- [ ] **Step 3 : Écrire le composant de route**

Create `packages/character-ui/src/components.ts` :

```ts
import { createComponent, Types } from '@iwsdk/core';

/**
 * L'onglet visible. UNIQUE source de vérité du routeur : IWSDK ne fournit
 * aucune navigation entre panneaux, donc c'est nous qui la tenons, et la tenir
 * à deux endroits est le moyen le plus sûr de les faire diverger.
 *
 * `Types.Enum` attend une MAP `{ clé: valeur }`, jamais un tableau : elics
 * valide le défaut par `Object.values(enum).includes(default)`, et le type
 * `EnumType` n'accepte pas `string[]`.
 */
export const CharacterUIRoute = createComponent('CharacterUIRoute', {
  tab: {
    type: Types.Enum,
    enum: { settings: 'settings', persona: 'persona' },
    default: 'settings',
    label: 'Onglet',
  },
});
```

- [ ] **Step 4 : Écrire le document factice**

Create `packages/character-ui/test/fixtures/fakeDocument.ts` :

```ts
import type { PanelDocument, PanelElement } from '../../src/document';

/**
 * Un document en mémoire qui enregistre ce qu'on lui fait.
 *
 * Il ne connaît QUE les identifiants qu'on lui déclare : demander un
 * identifiant absent rend `null`, exactement comme un vrai document dont
 * l'élément n'existe pas. C'est ce qui permet aux tests de distinguer « le
 * contrôleur n'a rien écrit » de « le contrôleur a écrit ailleurs ».
 */
export function makeFakeDocument(ids: readonly string[]): {
  doc: PanelDocument;
  props: Map<string, Record<string, unknown>>;
  texts: Map<string, string>;
  clicks: Map<string, () => void>;
} {
  const props = new Map<string, Record<string, unknown>>();
  const texts = new Map<string, string>();
  const clicks = new Map<string, () => void>();
  const elements = new Map<string, PanelElement>();

  for (const id of ids) {
    elements.set(id, {
      setProperties(p) {
        props.set(id, { ...(props.get(id) ?? {}), ...p });
      },
      setText(t) {
        texts.set(id, t);
      },
      addEventListener(type, handler) {
        if (type === 'click') clicks.set(id, handler);
      },
    });
  }

  return {
    doc: { getElementById: (id) => elements.get(id) ?? null },
    props,
    texts,
    clicks,
  };
}
```

- [ ] **Step 5 : Écrire les tests du routeur**

Create `packages/character-ui/test/router.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { TabRouter, TAB_IDS, TAB_BUTTON_IDS } from '../src/router';
import { makeFakeDocument } from './fixtures/fakeDocument';

function build() {
  const { doc, props, clicks } = makeFakeDocument([
    ...Object.values(TAB_IDS),
    ...Object.values(TAB_BUTTON_IDS),
  ]);
  return { router: new TabRouter(doc), props, clicks };
}

describe('le routeur d onglets', () => {
  it('ouvre sur Réglages', () => {
    const { router } = build();
    expect(router.current).toBe('settings');
  });

  it('un seul onglet est visible à la fois', () => {
    const { router, props } = build();
    router.show('persona');
    expect(props.get(TAB_IDS.persona)?.display).toBe('flex');
    expect(props.get(TAB_IDS.settings)?.display).toBe('none');

    router.show('settings');
    expect(props.get(TAB_IDS.settings)?.display).toBe('flex');
    expect(props.get(TAB_IDS.persona)?.display).toBe('none');
  });

  it('le bouton d onglet change la route', () => {
    const { router, clicks } = build();
    clicks.get(TAB_BUTTON_IDS.persona)?.();
    expect(router.current).toBe('persona');
  });

  it('marque le bouton actif, et un seul', () => {
    // Sans ce garde, les deux boutons peuvent rester allumés : `classList` est
    // additif, et oublier le `remove` ne casse rien de visible en test.
    const { router, props } = build();
    router.show('persona');
    expect(props.get(TAB_BUTTON_IDS.persona)?.backgroundOpacity).toBe(1);
    expect(props.get(TAB_BUTTON_IDS.settings)?.backgroundOpacity).toBe(0.35);
  });

  it('ne lève pas quand un élément manque du document', () => {
    // Un document incomplet est un bug, mais il ne doit pas emporter la frame.
    const { doc } = makeFakeDocument([]);
    const router = new TabRouter(doc);
    expect(() => router.show('persona')).not.toThrow();
  });
});
```

- [ ] **Step 6 : Lancer pour voir échouer**

Run : `pnpm --filter @iwsdk/cardinal-character-ui test`
Expected : ÉCHEC — `../src/router` n'existe pas.

- [ ] **Step 7 : Écrire le routeur**

Create `packages/character-ui/src/router.ts` :

```ts
import { show, type PanelDocument } from './document';

export type TabId = 'settings' | 'persona';

/** Les conteneurs d'onglet dans le document. */
export const TAB_IDS: Readonly<Record<TabId, string>> = {
  settings: 'tab-settings',
  persona: 'tab-persona',
};

/** Les boutons du pied de page qui les appellent. */
export const TAB_BUTTON_IDS: Readonly<Record<TabId, string>> = {
  settings: 'btn-tab-settings',
  persona: 'btn-tab-persona',
};

/** Les éléments du panneau qui n'appartiennent à aucun onglet. */
export const PANEL_IDS = Object.freeze({
  root: 'panel-root',
  targetName: 'target-name',
});

const ORDRE: readonly TabId[] = ['settings', 'persona'];

/**
 * Un onglet visible, les autres en `display: none`.
 *
 * IWSDK ne fournit AUCUNE navigation entre panneaux — la documentation
 * l'énonce. Le routeur est donc trois lignes de `classList` et de `display`,
 * et son seul devoir est de ne jamais laisser deux onglets allumés.
 */
export class TabRouter {
  private tab: TabId = 'settings';

  constructor(private readonly doc: PanelDocument) {
    for (const id of ORDRE) {
      this.doc
        .getElementById(TAB_BUTTON_IDS[id])
        ?.addEventListener?.('click', () => this.show(id));
    }
    this.apply();
  }

  get current(): TabId {
    return this.tab;
  }

  show(tab: TabId): void {
    this.tab = tab;
    this.apply();
  }

  private apply(): void {
    for (const id of ORDRE) {
      show(this.doc.getElementById(TAB_IDS[id]), id === this.tab);
      // Le bouton actif est plein, les autres translucides. `backgroundOpacity`
      // plutôt qu'une classe : `classList` est additif et oublier le `remove`
      // laisserait deux boutons allumés sans rien casser de visible.
      this.doc.getElementById(TAB_BUTTON_IDS[id])?.setProperties({
        backgroundOpacity: id === this.tab ? 1 : 0.35,
      });
    }
  }
}
```

- [ ] **Step 8 : Écrire l'index**

Create `packages/character-ui/src/index.ts` :

```ts
export const ENGINE_NAME = '@iwsdk/cardinal-character-ui';

export type { PanelDocument, PanelElement } from './document';
export { show, setText } from './document';
export { CharacterUIRoute } from './components';
export { TabRouter, TAB_IDS, TAB_BUTTON_IDS, PANEL_IDS, type TabId } from './router';
```

- [ ] **Step 9 : Câbler le paquet dans les chaînes de la racine**

Dans `package.json` à la racine, ajouter `pnpm --filter @iwsdk/cardinal-character-ui build`, `… test` et `… typecheck` dans les trois chaînes, **après** `cardinal-character-three` — l'ordre compte pour `build`, le paquet en dépend.

- [ ] **Step 10 : Vérifier et commiter**

Run : `pnpm --filter @iwsdk/cardinal-character-ui test && pnpm typecheck && pnpm build`
Expected : PASS

```bash
git add packages/character-ui package.json pnpm-lock.yaml
git commit -m "feat(character-ui): package scaffold, panel document contract, tab router"
```

---

## Task 4 : La jauge, l'onglet Réglages, et le document

C'est la tâche la plus longue, et son test le plus important n'est pas sur le contrôleur : c'est celui qui confronte les identifiants au **vrai fichier**.

**Files :**
- Create: `packages/character-ui/src/gauge.ts`
- Create: `packages/character-ui/src/tabs/settings.ts`
- Create: `apps/demo/public/ui/character.uikitml`
- Create: `packages/character-ui/test/gauge.test.ts`
- Create: `packages/character-ui/test/settings.test.ts`
- Create: `apps/demo/test/uikitml-ids.test.ts`
- Modify: `packages/character-ui/src/index.ts`

**Interfaces :**
- Consumes : `PanelDocument`, `show`, `setText` (tâche 3) ; `HUMANOID`, `type Genome` de `@iwsdk/cardinal-character` ; `CharacterStructure`, `CharacterFace`, `CharacterSurface`, `type ImportReport` de `@iwsdk/cardinal-character-three`.
- Produces :
  - `GENE_ROW_IDS: Readonly<Record<string, { row: string; bar: string; value: string; minus: string; plus: string; label: string; note: string }>>`
  - `function renderGauge(doc: PanelDocument, barId: string, valueId: string, fraction: number, texte: string): void`
  - `class SettingsTab { constructor(doc: PanelDocument, hooks: SettingsHooks); refresh(): void; }`
  - `interface SettingsHooks { read(gene: string): number; write(gene: string, value: number): void; inertGenes(): ReadonlySet<string>; }`

- [ ] **Step 1 : Écrire les tests de la jauge**

Create `packages/character-ui/test/gauge.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { renderGauge } from '../src/gauge';
import { makeFakeDocument } from './fixtures/fakeDocument';

describe('la jauge', () => {
  it('pilote la largeur de la barre en pourcentage', () => {
    const { doc, props } = makeFakeDocument(['bar', 'val']);
    renderGauge(doc, 'bar', 'val', 0.72, '0.72');
    expect(props.get('bar')?.width).toBe('72%');
  });

  it('borne la fraction hors de [0,1] au lieu de produire une largeur absurde', () => {
    const { doc, props } = makeFakeDocument(['bar', 'val']);
    renderGauge(doc, 'bar', 'val', 1.4, 'x');
    expect(props.get('bar')?.width).toBe('100%');
    renderGauge(doc, 'bar', 'val', -0.3, 'x');
    expect(props.get('bar')?.width).toBe('0%');
  });

  it('écrit le texte de valeur séparément de la barre', () => {
    // Une barre juste et un texte faux est le pire des deux mondes : on voit
    // une valeur et on en lit une autre.
    const { doc, texts } = makeFakeDocument(['bar', 'val']);
    renderGauge(doc, 'bar', 'val', 0.5, '0.50');
    expect(texts.get('val')).toBe('0.50');
  });

  it('ne lève pas si la barre manque du document', () => {
    const { doc } = makeFakeDocument([]);
    expect(() => renderGauge(doc, 'bar', 'val', 0.5, '0.50')).not.toThrow();
  });
});
```

- [ ] **Step 2 : Écrire la jauge**

Create `packages/character-ui/src/gauge.ts` :

```ts
import { setText, type PanelDocument } from './document';

/**
 * Une barre de progression faite d'un `div` dont on pilote la largeur.
 *
 * UIKitML n'a pas de `type="range"` : il n'existe aucun curseur natif, et la
 * documentation officielle ne liste que `div`, `p`, `h1`, `button`, `ul`/`li`,
 * `img`, `svg`, `video`, `input` et `textarea`. La largeur en POURCENTAGE et
 * non en unités absolues : le conteneur peut changer de taille avec le
 * panneau, la barre suit.
 *
 * `fraction` est normalisée dans `[0,1]`. Les gènes la fournissent
 * directement ; les besoins, dont l'échelle est 0–100, divisent avant
 * d'appeler.
 */
export function renderGauge(
  doc: PanelDocument,
  barId: string,
  valueId: string,
  fraction: number,
  texte: string,
): void {
  const borne = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  doc.getElementById(barId)?.setProperties({ width: `${Math.round(borne * 100)}%` });
  setText(doc.getElementById(valueId), texte);
}
```

- [ ] **Step 3 : Lancer**

Run : `pnpm --filter @iwsdk/cardinal-character-ui test gauge`
Expected : PASS

- [ ] **Step 4 : Écrire les tests de l'onglet Réglages**

Create `packages/character-ui/test/settings.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { SettingsTab, GENE_ROW_IDS, GENE_STEP, NON_EDITABLE_GENES } from '../src/tabs/settings';
import { makeFakeDocument } from './fixtures/fakeDocument';

/** Tous les identifiants que l'onglet peut demander. */
function tousLesIds(): string[] {
  return Object.values(GENE_ROW_IDS).flatMap((r) => [
    r.row, r.bar, r.value, r.minus, r.plus, r.label, r.note,
  ]);
}

function build(inertes: readonly string[] = []) {
  const { doc, props, texts, clicks } = makeFakeDocument(tousLesIds());
  const valeurs = new Map<string, number>();
  for (const cle of Object.keys(HUMANOID.genes)) valeurs.set(cle, 0.5);
  const ecrits: Array<[string, number]> = [];
  const tab = new SettingsTab(doc, {
    read: (g) => valeurs.get(g) ?? 0.5,
    write: (g, v) => {
      valeurs.set(g, v);
      ecrits.push([g, v]);
    },
    inertGenes: () => new Set(inertes),
  });
  return { tab, props, texts, clicks, valeurs, ecrits };
}

describe('l onglet Réglages', () => {
  it('affiche une ligne par gène de la famille', () => {
    const { tab, texts } = build();
    tab.refresh();
    expect(Object.keys(GENE_ROW_IDS).length).toBe(Object.keys(HUMANOID.genes).length);
    expect(texts.get(GENE_ROW_IDS['stature']!.value)).toBe('0.50');
  });

  it('« + » avance d exactement un pas, et écrit le gène demandé', () => {
    const { tab, clicks, ecrits } = build();
    tab.refresh();
    clicks.get(GENE_ROW_IDS['stature']!.plus)?.();
    expect(ecrits).toEqual([['stature', 0.5 + GENE_STEP]]);
  });

  it('« − » recule d exactement un pas', () => {
    const { tab, clicks, ecrits } = build();
    tab.refresh();
    clicks.get(GENE_ROW_IDS['stature']!.minus)?.();
    expect(ecrits).toEqual([['stature', 0.5 - GENE_STEP]]);
  });

  it('borne à [0,1] au lieu de sortir de l intervalle du gène', () => {
    const { tab, clicks, valeurs, ecrits } = build();
    valeurs.set('stature', 1);
    tab.refresh();
    clicks.get(GENE_ROW_IDS['stature']!.plus)?.();
    expect(ecrits).toEqual([['stature', 1]]);
    valeurs.set('stature', 0);
    tab.refresh();
    clicks.get(GENE_ROW_IDS['stature']!.minus)?.();
    expect(ecrits[1]).toEqual(['stature', 0]);
  });

  it('grise les gènes inertes et cache leurs boutons', () => {
    const { tab, props } = build(['jawWidth']);
    tab.refresh();
    expect(props.get(GENE_ROW_IDS['jawWidth']!.minus)?.display).toBe('none');
    expect(props.get(GENE_ROW_IDS['jawWidth']!.plus)?.display).toBe('none');
    expect(props.get(GENE_ROW_IDS['jawWidth']!.row)?.opacity).toBe(0.4);
    // Et il DIT pourquoi. Une ligne grise sans raison est une panne muette.
    expect(props.get(GENE_ROW_IDS['jawWidth']!.note)?.display).toBe('flex');
  });

  it('un clic sur un gène inerte n écrit rien', () => {
    // Le garde qui compte : cacher le bouton ne suffit pas si le gestionnaire
    // reste branché — un rayon peut encore l atteindre.
    const { tab, clicks, ecrits } = build(['jawWidth']);
    tab.refresh();
    clicks.get(GENE_ROW_IDS['jawWidth']!.plus)?.();
    expect(ecrits).toEqual([]);
  });

  it('rallume une ligne quand le gène cesse d être inerte', () => {
    // La liste vient du rapport d import de la CIBLE : changer de cible change
    // la liste, et une ligne éteinte doit pouvoir se rallumer.
    const { doc, props, clicks } = makeFakeDocument(tousLesIds());
    let inertes = new Set(['jawWidth']);
    const tab = new SettingsTab(doc, {
      read: () => 0.5,
      write: () => {},
      inertGenes: () => inertes,
    });
    tab.refresh();
    expect(props.get(GENE_ROW_IDS['jawWidth']!.plus)?.display).toBe('none');
    inertes = new Set();
    tab.refresh();
    expect(props.get(GENE_ROW_IDS['jawWidth']!.plus)?.display).toBe('flex');
    void clicks;
  });

  it('le pas vient du schéma ECS, pas d une constante recopiée', () => {
    expect(GENE_STEP).toBe(0.01);
  });

  it('les trois gènes de surface ne sont pas éditables, et pour une autre raison', () => {
    // `CharacterSurface` ne porte que `skin` et `hair`, deux Types.Color :
    // les couleurs RÉSOLUES. Aucun champ scalaire n accueille `skinTone`,
    // `hairTone` ni `hairStyle` — les éditer voudrait dire écrire le génome,
    // qui n a pas de mutateur public. Sans ce garde, un clic les enverrait
    // vers CharacterFace, qui ne les a pas non plus.
    expect([...NON_EDITABLE_GENES].sort()).toEqual(['hairStyle', 'hairTone', 'skinTone']);
    const { tab, clicks, ecrits, props } = build();
    tab.refresh();
    clicks.get(GENE_ROW_IDS['skinTone']!.plus)?.();
    expect(ecrits).toEqual([]);
    expect(props.get(GENE_ROW_IDS['skinTone']!.plus)?.display).toBe('none');
  });
});
```

- [ ] **Step 5 : Lancer pour voir échouer**

Run : `pnpm --filter @iwsdk/cardinal-character-ui test settings`
Expected : ÉCHEC — `../src/tabs/settings` n'existe pas.

- [ ] **Step 6 : Écrire l'onglet Réglages**

Create `packages/character-ui/src/tabs/settings.ts` :

```ts
import { HUMANOID } from '@iwsdk/cardinal-character';
import { CharacterStructure } from '@iwsdk/cardinal-character-three';
import { renderGauge } from '../gauge';
import { show, setText, type PanelDocument } from '../document';

/**
 * Le pas d'un clic, pris dans le SCHÉMA du composant et non recopié.
 *
 * L'inspecteur bureau et le panneau spatial doivent avancer du même pas ; la
 * seule façon de le garantir est de le lire au même endroit. `stature` sert de
 * représentant : `gene()` donne le même `step` aux treize.
 */
export const GENE_STEP: number =
  (CharacterStructure.schema.stature as { step?: number }).step ?? 0.01;

interface GeneRowIds {
  row: string;
  bar: string;
  value: string;
  minus: string;
  plus: string;
  label: string;
  note: string;
}

/** Les identifiants du document, dérivés des gènes de la famille. */
export const GENE_ROW_IDS: Readonly<Record<string, GeneRowIds>> = Object.freeze(
  Object.fromEntries(
    Object.keys(HUMANOID.genes).map((cle) => [
      cle,
      {
        row: `gene-row-${cle}`,
        bar: `gene-bar-${cle}`,
        value: `gene-val-${cle}`,
        minus: `gene-minus-${cle}`,
        plus: `gene-plus-${cle}`,
        label: `gene-label-${cle}`,
        note: `gene-note-${cle}`,
      },
    ]),
  ),
);

/**
 * Les gènes qu'aucun composant ne peut recevoir.
 *
 * `CharacterSurface` ne porte que `skin` et `hair`, deux `Types.Color` : ce
 * sont les couleurs RÉSOLUES, écrites par le système de compilation depuis le
 * génome. Les trois gènes du groupe `surface` n'ont donc aucun champ scalaire
 * où s'écrire — les éditer voudrait dire écrire le génome lui-même, qui vit
 * dans `CharacterCompileSystem.genomes` et n'a pas de mutateur public.
 *
 * Dérivée du descripteur, jamais écrite en dur : le jour où une famille change
 * de groupes, la liste suit.
 */
export const NON_EDITABLE_GENES: ReadonlySet<string> = new Set(
  Object.entries(HUMANOID.genes)
    .filter(([, def]) => def.group === 'surface')
    .map(([cle]) => cle),
);

export interface SettingsHooks {
  /** Valeur courante du gène, dans `[0,1]`. */
  read(gene: string): number;
  /** Écrit la valeur, déjà bornée. */
  write(gene: string, value: number): void;
  /**
   * Les gènes sans effet sur le rig courant, DÉRIVÉS de son `ImportReport` —
   * jamais d'une liste en dur. Le jour où un rig complet arrive, les lignes se
   * rallument sans une ligne de code de plus.
   */
  inertGenes(): ReadonlySet<string>;
}

/** Étiquettes lisibles, dans l'ordre du panneau. */
const LIBELLES: Readonly<Record<string, string>> = {
  stature: 'Stature', armLength: 'Longueur de bras', legLength: 'Longueur de jambe',
  torsoLength: 'Longueur de tronc', shoulderWidth: "Largeur d'épaules",
  jawWidth: 'Mâchoire', noseSize: 'Nez', eyeScale: 'Yeux',
  cheekbone: 'Pommettes', bodyMass: 'Corpulence',
  skinTone: 'Teint', hairTone: 'Cheveux', hairStyle: 'Coiffure',
};

export class SettingsTab {
  /** Les gènes inertes au dernier `refresh()`, relus à chaque clic. */
  private inertes: ReadonlySet<string> = new Set();

  constructor(
    private readonly doc: PanelDocument,
    private readonly hooks: SettingsHooks,
  ) {
    for (const cle of Object.keys(GENE_ROW_IDS)) {
      const ids = GENE_ROW_IDS[cle]!;
      setText(this.doc.getElementById(ids.label), LIBELLES[cle] ?? cle);
      this.doc
        .getElementById(ids.minus)
        ?.addEventListener?.('click', () => this.bump(cle, -GENE_STEP));
      this.doc
        .getElementById(ids.plus)
        ?.addEventListener?.('click', () => this.bump(cle, +GENE_STEP));
    }
  }

  refresh(): void {
    this.inertes = this.hooks.inertGenes();
    for (const cle of Object.keys(GENE_ROW_IDS)) {
      const ids = GENE_ROW_IDS[cle]!;
      // Deux raisons distinctes de ne pas offrir de bouton, et la ligne le dit :
      // le rig ne porte pas la cible (inerte), ou aucun composant ne peut
      // recevoir la valeur (non éditable).
      const inerte = this.inertes.has(cle) || NON_EDITABLE_GENES.has(cle);
      const valeur = this.hooks.read(cle);
      renderGauge(this.doc, ids.bar, ids.value, valeur, valeur.toFixed(2));
      // Grisée, sans boutons, et avec sa raison : une ligne éteinte sans
      // explication est une panne muette.
      this.doc.getElementById(ids.row)?.setProperties({ opacity: inerte ? 0.4 : 1 });
      show(this.doc.getElementById(ids.minus), !inerte);
      show(this.doc.getElementById(ids.plus), !inerte);
      show(this.doc.getElementById(ids.note), inerte);
    }
  }

  private bump(cle: string, delta: number): void {
    // Cacher le bouton ne suffit pas : un rayon peut encore atteindre un
    // élément masqué selon l'implémentation, et le gestionnaire reste branché.
    // La garde est ici, pas dans l'affichage.
    if (this.inertes.has(cle) || NON_EDITABLE_GENES.has(cle)) return;
    const suivant = this.hooks.read(cle) + delta;
    this.hooks.write(cle, suivant < 0 ? 0 : suivant > 1 ? 1 : suivant);
    this.refresh();
  }
}
```

- [ ] **Step 7 : Écrire le document UIKitML**

Create `apps/demo/public/ui/character.uikitml`. Les treize lignes de gène suivent toutes le même patron ; les écrire une par une, avec les identifiants exacts de `GENE_ROW_IDS`.

**Les tailles sont en centimètres, sans suffixe `px`** (§2.1 de la spec, confirmé par la tâche 1).

```html
<!--
  Panneau de personnage : deux onglets et un pied de page.

  Les identifiants sont le CONTRAT avec `@iwsdk/cardinal-character-ui` :
  `apps/demo/test/uikitml-ids.test.ts` confronte ce fichier aux identifiants que
  les contrôleurs demandent, et tombe si l'un manque. Un document factice ne
  voit jamais cette panne — c'est la plus probable de l'étape.

  Les tailles sont en CENTIMÈTRES, sans suffixe. `width: 60` fait 60 cm. Les
  deux autres panneaux du dépôt écrivent `px` et compensent par un
  `scale.setScalar(0.5)` ; celui-ci déclare sa taille réelle.

  Les accents dépendent d'un correctif @pmndrs/uikit déclaré dans
  `patchedDependencies`, gardé par `scripts/__tests__/uikit-charset.test.mjs`.
-->
<style>
  .root { flex-direction: column; width: 60; height: 78; background-color: #14161c;
          border-radius: 1.2; padding: 1.6; gap: 1.0; }
  .tab { flex-direction: column; gap: 0.5; flex-grow: 1; }
  .row { flex-direction: row; align-items: center; gap: 0.6; height: 3.2; }
  .name { width: 16; font-size: 1.3; color: #d8dde8; }
  .track { flex-grow: 1; height: 0.9; background-color: #2a2f3a; border-radius: 0.45; }
  .bar { height: 0.9; background-color: #6ea8fe; border-radius: 0.45; }
  .val { width: 5; font-size: 1.2; color: #9aa4b8; }
  .step { width: 3.4; height: 2.6; background-color: #2a2f3a; border-radius: 0.5;
          align-items: center; justify-content: center; }
  .step:hover { background-color: #3a4150; }
  .note { font-size: 1.0; color: #8a93a6; }
  .foot { flex-direction: row; align-items: center; gap: 0.8; height: 4; }
  .tabbtn { width: 14; height: 3; background-color: #2a2f3a; border-radius: 0.5;
            align-items: center; justify-content: center; }
  .h { font-size: 1.6; color: #ffffff; }
</style>

<div class="root" id="panel-root">
  <p class="h" id="target-name">Aucune cible</p>

  <div class="tab" id="tab-settings">
    <div class="row" id="gene-row-stature">
      <p class="name" id="gene-label-stature">Stature</p>
      <button class="step" id="gene-minus-stature"><p>−</p></button>
      <div class="track"><div class="bar" id="gene-bar-stature"></div></div>
      <p class="val" id="gene-val-stature">0.50</p>
      <button class="step" id="gene-plus-stature"><p>+</p></button>
      <p class="note" id="gene-note-stature">inerte sur ce rig</p>
    </div>
    <!-- Répéter le bloc ci-dessus pour les douze autres gènes, en remplaçant
         `stature` par : armLength, legLength, torsoLength, shoulderWidth,
         jawWidth, noseSize, eyeScale, cheekbone, bodyMass, skinTone, hairTone,
         hairStyle. Les identifiants doivent correspondre EXACTEMENT à
         GENE_ROW_IDS ; le test uikitml-ids.test.ts le vérifie. -->
  </div>

  <div class="tab" id="tab-persona">
    <p class="name" id="persona-role">—</p>
    <p class="note" id="persona-text">—</p>
    <div class="row" id="need-row-hunger">
      <p class="name" id="need-label-hunger">Faim</p>
      <div class="track"><div class="bar" id="need-bar-hunger"></div></div>
      <p class="val" id="need-val-hunger">—</p>
    </div>
    <!-- Répéter pour : warmth, energy, affection, stress. -->
    <p class="note" id="persona-action">—</p>
    <p class="note" id="persona-plan">—</p>
    <p class="note" id="persona-absent">aucune source de persona</p>
  </div>

  <div class="foot">
    <button class="tabbtn" id="btn-tab-settings"><p>Réglages</p></button>
    <button class="tabbtn" id="btn-tab-persona"><p>Persona</p></button>
  </div>
</div>
```

- [ ] **Step 8 : Écrire le test du contrat d'identifiants**

C'est le garde le plus important de l'étape.

Create `apps/demo/test/uikitml-ids.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENE_ROW_IDS, NEED_ROW_IDS, PERSONA_IDS, TAB_IDS, TAB_BUTTON_IDS, PANEL_IDS }
  from '@iwsdk/cardinal-character-ui';

/**
 * Confronte le document RÉEL aux identifiants que les contrôleurs demandent.
 *
 * Un document factice ne voit jamais cette panne : le contrôleur appelle
 * `getElementById('gene-bar-stature')`, le document écrit `geneBarStature`, et
 * tous les tests à document factice passent pendant que le panneau reste vide.
 * C'est la panne la plus probable de cette étape, et la seule qu'aucun autre
 * test ne peut attraper.
 */
function idsDuDocument(): Set<string> {
  const chemin = join(__dirname, '../public/ui/character.uikitml');
  const source = readFileSync(chemin, 'utf8');
  const trouves = new Set<string>();
  for (const m of source.matchAll(/\bid="([^"]+)"/g)) trouves.add(m[1]!);
  return trouves;
}

describe('le contrat d identifiants du document', () => {
  const presents = idsDuDocument();

  it('le document en déclare un nombre plausible', () => {
    // Garde contre un fichier vide ou une regex qui ne matche rien : sans lui,
    // un document introuvable ferait passer tous les tests ci-dessous.
    expect(presents.size).toBeGreaterThan(50);
  });

  it('porte les treize lignes de gène, au complet', () => {
    const manquants: string[] = [];
    for (const [gene, ids] of Object.entries(GENE_ROW_IDS)) {
      for (const [role, id] of Object.entries(ids)) {
        if (!presents.has(id)) manquants.push(`${gene}.${role} → ${id}`);
      }
    }
    expect(manquants).toEqual([]);
  });

  it('porte les cinq lignes de besoin', () => {
    const manquants: string[] = [];
    for (const [besoin, ids] of Object.entries(NEED_ROW_IDS)) {
      for (const [role, id] of Object.entries(ids)) {
        if (!presents.has(id)) manquants.push(`${besoin}.${role} → ${id}`);
      }
    }
    expect(manquants).toEqual([]);
  });

  it('porte les conteneurs d onglet, leurs boutons, et les champs de persona', () => {
    const attendus = [
      ...Object.values(TAB_IDS),
      ...Object.values(TAB_BUTTON_IDS),
      ...Object.values(PERSONA_IDS),
      ...Object.values(PANEL_IDS),
    ];
    expect(attendus.filter((id) => !presents.has(id))).toEqual([]);
  });
});
```

`NEED_ROW_IDS`, `PERSONA_IDS` et `PANEL_IDS` arrivent à la tâche 6 ; ce fichier ne compilera qu'à ce moment. Le créer maintenant, avec les deux premiers tests actifs, et **le laisser échouer à la compilation jusqu'à la tâche 6** n'est pas acceptable : écrire d'abord la version qui ne référence que `GENE_ROW_IDS`, `TAB_IDS`, `TAB_BUTTON_IDS` et `PANEL_IDS`, et **ajouter les deux blocs manquants à la tâche 6**.

`PANEL_IDS` vient de la tâche 3, où il est défini dans `router.ts` et exporté.

- [ ] **Step 9 : Exporter et lancer**

Ajouter à `packages/character-ui/src/index.ts` :

```ts
export { renderGauge } from './gauge';
export { SettingsTab, GENE_ROW_IDS, GENE_STEP, NON_EDITABLE_GENES, type SettingsHooks } from './tabs/settings';
```

Run : `pnpm --filter @iwsdk/cardinal-character-ui test && pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck && pnpm build`
Expected : PASS

- [ ] **Step 10 : Vérifier que le contrat peut tomber**

Renommer temporairement `id="gene-bar-stature"` en `id="gene-bar-statureX"` dans le document, relancer `pnpm --filter @iwsdk/plugin-phoenix-demo test uikitml-ids`, et **confirmer que le test tombe en nommant `stature.bar`**. Rétablir.

Si le test passe malgré le renommage, il ne prouve rien : le corriger avant de continuer.

- [ ] **Step 11 : Commiter**

```bash
git add packages/character-ui apps/demo/public/ui/character.uikitml apps/demo/src/assets.ts apps/demo/test/uikitml-ids.test.ts
git commit -m "feat(character-ui): gauge, settings tab, and the id contract against the real document"
```

---

## Task 5 : La sélection et le placement

**Files :**
- Create: `packages/character-ui/src/systems/CharacterPickSystem.ts`
- Create: `packages/character-ui/src/systems/CharacterPanelPlacementSystem.ts`
- Create: `packages/character-ui/test/pick.test.ts`
- Create: `packages/character-ui/test/placement.test.ts`
- Modify: `apps/demo/src/simulation/VillagerBody.ts`
- Modify: `packages/character-ui/src/index.ts`

**Interfaces :**
- Consumes : `CharacterSelection`, `CharacterIdentity` de `@iwsdk/cardinal-character-three` ; `RayInteractable`, `Pressed`, `createSystem`, `Types` de `@iwsdk/core`.
- Produces :
  - `class CharacterPickSystem` — priorité **90**, après le mixer (80).
  - `class CharacterPanelPlacementSystem` — priorité **92**.
  - `function placePanel(panel: Object3D, cible: Object3D, camera: Object3D, offset: number, scaleMin: number, scaleMax: number): void` — pure, testable sans monde.

- [ ] **Step 1 : Écrire les tests du placement**

Create `packages/character-ui/test/placement.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { Object3D, Vector3 } from '@iwsdk/core';
import { placePanel } from '../src/systems/CharacterPanelPlacementSystem';

function scene() {
  const panel = new Object3D();
  const cible = new Object3D();
  const camera = new Object3D();
  return { panel, cible, camera };
}

describe('le placement du panneau', () => {
  it('se pose à côté de la cible, pas dessus', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(3, 0, -2);
    camera.position.set(0, 1.6, 0);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.position.distanceTo(cible.position)).toBeCloseTo(0.8, 2);
  });

  it('se tourne vers la CAMÉRA, pas vers la cible', () => {
    // Le piège : `Follower` en FaceTarget oriente vers sa cible de suivi. Ici
    // la cible de position et la cible d orientation diffèrent.
    const { panel, cible, camera } = scene();
    cible.position.set(5, 0, 0);
    camera.position.set(0, 0, 10);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    const versCamera = new Vector3().subVectors(camera.position, panel.position).normalize();
    const avant = new Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    expect(avant.dot(versCamera)).toBeGreaterThan(0.99);
  });

  it('grandit avec la distance, pour garder la même taille apparente', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(0, 0, 0);
    camera.position.set(0, 0, 2);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    const proche = panel.scale.x;
    camera.position.set(0, 0, 12);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.scale.x).toBeGreaterThan(proche);
  });

  it('borne l échelle aux deux extrémités', () => {
    const { panel, cible, camera } = scene();
    cible.position.set(0, 0, 0);
    camera.position.set(0, 0, 0.1);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.scale.x).toBeCloseTo(0.5, 5);
    camera.position.set(0, 0, 500);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.scale.x).toBeCloseTo(3, 5);
  });

  it('n alloue rien : deux appels ne créent aucun vecteur neuf', () => {
    // La fonction tourne à 90 Hz. Les vecteurs de travail sont des propriétés
    // de module, pas des littéraux d appel.
    const { panel, cible, camera } = scene();
    const avant = panel.position.clone();
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    placePanel(panel, cible, camera, 0.8, 0.5, 3);
    expect(panel.position.equals(avant)).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

Run : `pnpm --filter @iwsdk/cardinal-character-ui test placement`
Expected : ÉCHEC — le module n'existe pas.

- [ ] **Step 3 : Écrire le placement**

Create `packages/character-ui/src/systems/CharacterPanelPlacementSystem.ts` :

```ts
import { createSystem, Types, Vector3, type Object3D } from '@iwsdk/core';
import { CharacterSelection } from '@iwsdk/cardinal-character-three';

// Vecteurs de travail au niveau du module : la fonction tourne à 90 Hz, et un
// littéral par appel serait onze allocations par seconde et par personnage.
const _versCamera = new Vector3();
const _cote = new Vector3();
const _haut = new Vector3(0, 1, 0);

/**
 * Pose le panneau à côté de la cible et le tourne vers la caméra active.
 *
 * Le composant `Follower` du cœur oriente vers sa CIBLE DE SUIVI ; ici la
 * cible de position (le villageois) et la cible d'orientation (la caméra)
 * diffèrent, d'où cette fonction plutôt que le composant.
 *
 * L'échelle est proportionnelle à la distance caméra, bornée : le panneau
 * occupe la même part du champ de vision de près comme de loin. Hors
 * immersion, la caméra bureau peut être à vingt mètres du villageois ; une
 * taille métrique fixe le rendrait illisible.
 */
export function placePanel(
  panel: Object3D,
  cible: Object3D,
  camera: Object3D,
  offset: number,
  scaleMin: number,
  scaleMax: number,
): void {
  _versCamera.subVectors(camera.position, cible.position);
  const distance = _versCamera.length();
  if (distance < 1e-4) return;
  _versCamera.divideScalar(distance);

  // Le côté : perpendiculaire à l'axe caméra-cible, dans le plan horizontal.
  _cote.crossVectors(_haut, _versCamera).normalize();
  panel.position.copy(cible.position).addScaledVector(_cote, offset);
  panel.position.y = cible.position.y + 1.2;

  panel.lookAt(camera.position);

  // 1 mètre de référence : à cette distance l'échelle vaut 1.
  const echelle = Math.min(scaleMax, Math.max(scaleMin, distance / 3));
  panel.scale.setScalar(echelle);
}

/** Priorité 92 : après la sélection (90), qui décide de la cible. */
export class CharacterPanelPlacementSystem extends createSystem(
  { selections: { required: [CharacterSelection] } },
  {
    offsetMeters: { type: Types.Float32, default: 0.8 },
    scaleMin: { type: Types.Float32, default: 0.5 },
    scaleMax: { type: Types.Float32, default: 3 },
  },
) {
  /** Le nœud du panneau, posé par `installCharacterUI`. */
  public panel: Object3D | null = null;

  public override update(): void {
    if (this.panel === null) return;
    const selection = this.queries.selections.entities[0];
    if (selection === undefined) return;
    const cible = selection.getValue(CharacterSelection, 'target');
    const node = (cible as { object3D?: Object3D } | null)?.object3D;
    if (node === undefined || node === null) {
      this.panel.visible = false;
      return;
    }
    this.panel.visible = true;
    placePanel(
      this.panel, node, this.world.camera,
      this.config.offsetMeters.peek(),
      this.config.scaleMin.peek(),
      this.config.scaleMax.peek(),
    );
  }
}
```

- [ ] **Step 4 : Écrire les tests de la sélection**

Create `packages/character-ui/test/pick.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World, Object3D, Pressed } from '@iwsdk/core';
import { CharacterIdentity, CharacterSelection, installCharacterThree }
  from '@iwsdk/cardinal-character-three';
import { CharacterPickSystem } from '../src/systems/CharacterPickSystem';

function build() {
  const world = new World();
  installCharacterThree(world);
  world.registerComponent(CharacterSelection);
  world.registerSystem(CharacterPickSystem, { priority: 90 });
  const system = world.getSystem(CharacterPickSystem)!;
  const selection = world.createEntity();
  selection.addComponent(CharacterSelection, {});
  const villageois = (): ReturnType<World['createTransformEntity']> => {
    const e = world.createTransformEntity(new Object3D());
    e.addComponent(CharacterIdentity, { family: 'humanoid', age: 30 });
    return e;
  };
  return { world, system, selection, villageois };
}

describe('la sélection au rayon', () => {
  it('un appui sur un villageois écrit la cible', () => {
    const { system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    system.update(0.016, 16);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(a);
  });

  it('viser un autre villageois REMPLACE la cible', () => {
    // Sans ce garde, une implémentation qui n écrirait que si la cible est
    // nulle passerait le test précédent et figerait la sélection à jamais.
    const { system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    system.update(0.016, 16);
    a.removeComponent(Pressed);
    const b = villageois();
    b.addComponent(Pressed, {});
    system.update(0.016, 32);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(b);
  });

  it('un appui sur autre chose qu un personnage ne change rien', () => {
    const { world, system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    system.update(0.016, 16);
    const caillou = world.createTransformEntity(new Object3D());
    caillou.addComponent(Pressed, {});
    system.update(0.016, 32);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(a);
  });

  it('sans appui, la cible ne bouge pas', () => {
    const { system, selection, villageois } = build();
    const a = villageois();
    a.addComponent(Pressed, {});
    system.update(0.016, 16);
    a.removeComponent(Pressed);
    system.update(0.016, 32);
    expect(selection.getValue(CharacterSelection, 'target')).toBe(a);
  });
});
```

- [ ] **Step 5 : Écrire le système de sélection**

Create `packages/character-ui/src/systems/CharacterPickSystem.ts` :

```ts
import { createSystem, Pressed } from '@iwsdk/core';
import { CharacterIdentity, CharacterSelection } from '@iwsdk/cardinal-character-three';

/**
 * Écrit `CharacterSelection.target` quand un personnage est pressé.
 *
 * `RayInteractable` plus `Pressed` couvre le rayon du casque ET le pointeur
 * souris — l'`AGENTS.md` du projet l'énonce, et `canvasPointerEvents` est déjà
 * actif dans la démo. Une seule voie de code sert donc les deux modes ; c'est
 * la raison pour laquelle il n'existe aucun chemin bureau séparé.
 *
 * Priorité 90 : après le système d'animation (80), dont la cible ne dépend pas.
 */
export class CharacterPickSystem extends createSystem({
  pressedCharacters: { required: [CharacterIdentity, Pressed] },
  selections: { required: [CharacterSelection] },
}) {
  public override update(): void {
    const selection = this.queries.selections.entities[0];
    if (selection === undefined) return;
    // Le premier pressé de la frame gagne. Une frame où deux personnages sont
    // pressés simultanément n'existe pas en pratique — un seul rayon, un seul
    // pointeur — et arbitrer coûterait plus que le cas ne vaut.
    const vise = this.queries.pressedCharacters.entities[0];
    if (vise === undefined) return;
    selection.setValue(CharacterSelection, 'target', vise);
  }
}
```

- [ ] **Step 6 : Rendre les villageois visables**

Modify `apps/demo/src/simulation/VillagerBody.ts`, dans `makeRiggedBody`, juste après la résolution de `node` :

```ts
    // Visable au rayon du casque comme au pointeur souris : c'est le même
    // composant qui sert les deux, et c'est ce qui rend le panneau utilisable
    // en immersion et hors immersion sans chemin séparé.
    entity.addComponent(RayInteractable, {});
```

Importer `RayInteractable` depuis `@iwsdk/core`.

Ajouter à `apps/demo/test/villager-body.test.ts` :

```ts
  it('le rig est visable au rayon', () => {
    const { world, entity } = makeCharacter();
    makeRiggedBody(world, entity, { idle: walkClip() }, new PuppetBody(new Group(), 'mira'));
    // Sans ce composant, aucun villageois n est sélectionnable et le panneau
    // reste sans cible pour toujours.
    expect(entity.hasComponent(RayInteractable)).toBe(true);
  });
```

- [ ] **Step 7 : Exporter, lancer, commiter**

Ajouter à `packages/character-ui/src/index.ts` :

```ts
export { CharacterPickSystem } from './systems/CharacterPickSystem';
export { CharacterPanelPlacementSystem, placePanel } from './systems/CharacterPanelPlacementSystem';
```

Run : `pnpm --filter @iwsdk/cardinal-character-ui test && pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck && pnpm build`

```bash
git add packages/character-ui apps/demo/src/simulation/VillagerBody.ts apps/demo/test/villager-body.test.ts
git commit -m "feat(character-ui): ray selection and panel placement facing the active camera"
```

---

## Task 6 : L'onglet Persona

**Files :**
- Create: `packages/character-ui/src/tabs/persona.ts`
- Create: `packages/character-ui/test/persona.test.ts`
- Modify: `apps/demo/test/uikitml-ids.test.ts` (ajouter les deux blocs annoncés à la tâche 4)
- Modify: `packages/character-ui/src/index.ts`

**Interfaces :**
- Consumes : `PanelDocument`, `renderGauge`, `show`, `setText`.
- Produces :
  - `interface PersonaView { name: string; tribe: string; role: string; persona: string | null; needs: Readonly<Record<NeedId, number>>; action: string | null; plan: readonly string[] }`
  - `type NeedId = 'hunger' | 'warmth' | 'energy' | 'affection' | 'stress'`
  - `NEED_ROW_IDS`, `PERSONA_IDS`
  - `class PersonaTab { constructor(doc: PanelDocument); render(view: PersonaView | null): void; }`

- [ ] **Step 1 : Écrire les tests**

Create `packages/character-ui/test/persona.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { PersonaTab, NEED_ROW_IDS, PERSONA_IDS, type PersonaView } from '../src/tabs/persona';
import { makeFakeDocument } from './fixtures/fakeDocument';

const VUE: PersonaView = {
  name: 'Mira', tribe: 'Aube', role: 'Mère & Gardienne',
  persona: "Douce et prévoyante, partage toujours ce qu'elle cueille",
  needs: { hunger: 80, warmth: 60, energy: 100, affection: 40, stress: 10 },
  action: 'gather_berries',
  plan: ['nourrir la famille', 'rentrer avant la nuit'],
};

function build() {
  const ids = [
    ...Object.values(NEED_ROW_IDS).flatMap((r) => [r.label, r.bar, r.value]),
    ...Object.values(PERSONA_IDS),
  ];
  const { doc, props, texts } = makeFakeDocument(ids);
  return { tab: new PersonaTab(doc), props, texts };
}

describe('l onglet Persona', () => {
  it('affiche le nom, le rôle et la tribu', () => {
    const { tab, texts } = build();
    tab.render(VUE);
    expect(texts.get(PERSONA_IDS.role)).toContain('Mira');
    expect(texts.get(PERSONA_IDS.role)).toContain('Aube');
  });

  it('normalise les besoins de 0–100 vers la jauge en 0–1', () => {
    // Le piège : la jauge prend une FRACTION. Passer 80 tel quel donnerait
    // 8000 %, borné à 100 % — donc toutes les barres pleines, et un panneau
    // qui semble marcher.
    const { tab, props } = build();
    tab.render(VUE);
    expect(props.get(NEED_ROW_IDS.warmth.bar)?.width).toBe('60%');
    expect(props.get(NEED_ROW_IDS.affection.bar)?.width).toBe('40%');
    expect(props.get(NEED_ROW_IDS.stress.bar)?.width).toBe('10%');
  });

  it('affiche l action en cours, et « au repos » quand il n y en a pas', () => {
    const { tab, texts } = build();
    tab.render(VUE);
    expect(texts.get(PERSONA_IDS.action)).toContain('gather_berries');
    tab.render({ ...VUE, action: null });
    expect(texts.get(PERSONA_IDS.action)).toContain('repos');
  });

  it('affiche le plan Mode-2, et « aucun plan » quand il est vide', () => {
    const { tab, texts } = build();
    tab.render(VUE);
    expect(texts.get(PERSONA_IDS.plan)).toContain('nourrir la famille');
    tab.render({ ...VUE, plan: [] });
    expect(texts.get(PERSONA_IDS.plan)).toContain('aucun plan');
  });

  it('sans vue, affiche le message d absence et NE LÈVE PAS', () => {
    // C est le cas où l application n a fourni aucun résolveur — l onglet
    // Réglages doit rester pleinement utilisable.
    const { tab, props } = build();
    expect(() => tab.render(null)).not.toThrow();
    expect(props.get(PERSONA_IDS.absent)?.display).toBe('flex');
  });

  it('cache le message d absence dès qu une vue arrive', () => {
    const { tab, props } = build();
    tab.render(null);
    tab.render(VUE);
    expect(props.get(PERSONA_IDS.absent)?.display).toBe('none');
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

Run : `pnpm --filter @iwsdk/cardinal-character-ui test persona`
Expected : ÉCHEC — le module n'existe pas.

- [ ] **Step 3 : Écrire l'onglet**

Create `packages/character-ui/src/tabs/persona.ts` :

```ts
import { renderGauge } from '../gauge';
import { show, setText, type PanelDocument } from '../document';

export type NeedId = 'hunger' | 'warmth' | 'energy' | 'affection' | 'stress';

/**
 * Ce dont l'onglet a besoin, et rien de plus.
 *
 * Le paquet ne dépend PAS de `@iwsdk/cardinal-simulation` : `CharacterSelection`
 * porte une entité, l'état d'un agent se lit par identifiant, et seul l'appelant
 * connaît le lien. Importer la simulation depuis ici rendrait le paquet
 * inutilisable dans tout projet qui n'a pas ce moteur, pour un onglet sur deux.
 */
export interface PersonaView {
  name: string;
  tribe: string;
  role: string;
  persona: string | null;
  /** Cinq besoins, échelle 0–100. */
  needs: Readonly<Record<NeedId, number>>;
  action: string | null;
  plan: readonly string[];
}

const BESOINS: readonly NeedId[] = ['hunger', 'warmth', 'energy', 'affection', 'stress'];

const LIBELLES: Readonly<Record<NeedId, string>> = {
  hunger: 'Faim', warmth: 'Chaleur', energy: 'Énergie',
  affection: 'Affection', stress: 'Stress',
};

export const NEED_ROW_IDS: Readonly<Record<NeedId, { label: string; bar: string; value: string }>> =
  Object.freeze(
    Object.fromEntries(
      BESOINS.map((b) => [b, {
        label: `need-label-${b}`, bar: `need-bar-${b}`, value: `need-val-${b}`,
      }]),
    ),
  ) as Readonly<Record<NeedId, { label: string; bar: string; value: string }>>;

export const PERSONA_IDS = Object.freeze({
  role: 'persona-role',
  text: 'persona-text',
  action: 'persona-action',
  plan: 'persona-plan',
  absent: 'persona-absent',
});

export class PersonaTab {
  constructor(private readonly doc: PanelDocument) {
    for (const b of BESOINS) {
      setText(this.doc.getElementById(NEED_ROW_IDS[b].label), LIBELLES[b]);
    }
  }

  render(view: PersonaView | null): void {
    show(this.doc.getElementById(PERSONA_IDS.absent), view === null);
    if (view === null) return;

    setText(this.doc.getElementById(PERSONA_IDS.role), `${view.name} — ${view.role} (${view.tribe})`);
    setText(this.doc.getElementById(PERSONA_IDS.text), view.persona ?? '—');

    for (const b of BESOINS) {
      const valeur = view.needs[b];
      // Les besoins sont sur 0–100 ; la jauge prend une FRACTION. Passer 80
      // tel quel donnerait 8000 %, borné à 100 % — toutes les barres pleines,
      // et un panneau qui semble marcher.
      renderGauge(this.doc, NEED_ROW_IDS[b].bar, NEED_ROW_IDS[b].value, valeur / 100, String(Math.round(valeur)));
    }

    setText(this.doc.getElementById(PERSONA_IDS.action), view.action ?? 'au repos');
    setText(
      this.doc.getElementById(PERSONA_IDS.plan),
      view.plan.length === 0 ? 'aucun plan' : view.plan.join(' → '),
    );
  }
}
```

- [ ] **Step 4 : Compléter le test du contrat d'identifiants**

Dans `apps/demo/test/uikitml-ids.test.ts`, ajouter les deux blocs annoncés à la tâche 4 : l'import de `NEED_ROW_IDS` et `PERSONA_IDS`, le test « porte les cinq lignes de besoin », et l'ajout de `PERSONA_IDS` au test des conteneurs.

- [ ] **Step 5 : Exporter, lancer, commiter**

Ajouter à `packages/character-ui/src/index.ts` :

```ts
export { PersonaTab, NEED_ROW_IDS, PERSONA_IDS, type PersonaView, type NeedId } from './tabs/persona';
```

Run : `pnpm --filter @iwsdk/cardinal-character-ui test && pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck && pnpm build`

```bash
git add packages/character-ui apps/demo/test/uikitml-ids.test.ts
git commit -m "feat(character-ui): persona tab, with the app supplying its data"
```

---

## Task 7 : L'installation, l'intégration, et la preuve à l'écran

**Files :**
- Create: `packages/character-ui/src/install.ts`
- Create: `packages/character-ui/README.md`
- Create: `packages/character-ui/test/install.test.ts`
- Modify: `apps/demo/src/assets.ts`, `apps/demo/src/index.ts`, `apps/demo/package.json`
- Modify: `packages/character-ui/src/index.ts`

**Interfaces :**
- Consumes : tout ce qui précède.
- Produces : `installCharacterUI(world, options?): Promise<CharacterUI>`.

- [ ] **Step 1 : Écrire l'installation**

Create `packages/character-ui/src/install.ts` :

```ts
import { UIKitMLAsset, type Entity, type Object3D, type World } from '@iwsdk/core';
import { CharacterSelection, CharacterStructure, CharacterFace } from '@iwsdk/cardinal-character-three';
import { CharacterUIRoute } from './components';
import { TabRouter, PANEL_IDS } from './router';
import { SettingsTab } from './tabs/settings';
import { PersonaTab, type PersonaView } from './tabs/persona';
import { CharacterPickSystem } from './systems/CharacterPickSystem';
import { CharacterPanelPlacementSystem } from './systems/CharacterPanelPlacementSystem';
import { setText, type PanelDocument } from './document';

export interface CharacterUIOptions {
  /** Identifiant du panneau au manifeste. */
  assetId?: string;
  /** Résout l'état de persona d'une entité. Sans lui, l'onglet le dit. */
  persona?: (entity: Entity) => PersonaView | null;
  /** Les gènes sans effet sur ce rig, dérivés de son rapport d'import. */
  inertGenes?: (entity: Entity) => ReadonlySet<string>;
}

export interface CharacterUI {
  readonly node: Object3D;
  dispose(): void;
}

/** Persona se relit quatre fois par seconde, pas quatre-vingt-dix. */
const PERSONA_PERIOD_MS = 250;

export async function installCharacterUI(
  world: World,
  options: CharacterUIOptions = {},
): Promise<CharacterUI> {
  world.registerComponent(CharacterUIRoute);
  world.registerSystem(CharacterPickSystem, { priority: 90 });
  world.registerSystem(CharacterPanelPlacementSystem, { priority: 92 });

  const panel = await world.assets.instantiate<UIKitMLAsset>(options.assetId ?? 'character-panel');
  const doc = panel as unknown as PanelDocument;
  const node = panel as unknown as Object3D;

  const selection = world.createEntity();
  selection.addComponent(CharacterSelection, {});
  selection.addComponent(CharacterUIRoute, {});
  world.createTransformEntity(node);

  const router = new TabRouter(doc);
  const persona = new PersonaTab(doc);

  const cible = (): Entity | null =>
    (selection.getValue(CharacterSelection, 'target') as Entity | null) ?? null;

  const settings = new SettingsTab(doc, {
    read: (gene) => {
      const e = cible();
      if (e === null) return 0.5;
      const composant = gene in CharacterStructure.schema ? CharacterStructure : CharacterFace;
      return (e.getValue(composant as never, gene) as number | null) ?? 0.5;
    },
    write: (gene, valeur) => {
      const e = cible();
      if (e === null) return;
      // Deux composants seulement : les gènes de surface ne sont pas
      // éditables (voir NON_EDITABLE_GENES), et `SettingsTab` ne les fait
      // jamais parvenir jusqu'ici.
      const composant = gene in CharacterStructure.schema ? CharacterStructure : CharacterFace;
      e.setValue(composant as never, gene, valeur);
    },
    inertGenes: () => {
      const e = cible();
      return e === null ? new Set<string>() : (options.inertGenes?.(e) ?? new Set<string>());
    },
  });

  const placement = world.getSystem(CharacterPanelPlacementSystem);
  if (placement !== undefined) placement.panel = node;

  let dernier = 0;
  const tick = (now: number): void => {
    const e = cible();
    setText(doc.getElementById(PANEL_IDS.targetName), e === null ? 'Aucune cible' : 'Villageois');
    settings.refresh();
    // Persona lit des données PAR FRAME : les relire à 90 Hz allouerait dans
    // la boucle de rendu pour un texte que l'œil ne suit pas.
    if (router.current === 'persona' && now - dernier >= PERSONA_PERIOD_MS) {
      dernier = now;
      persona.render(e === null ? null : (options.persona?.(e) ?? null));
    }
  };

  const timer = setInterval(() => tick(Date.now()), 100);

  return {
    node,
    dispose(): void {
      clearInterval(timer);
      // Un document UIKitML non disposé fuit — même famille de règle que
      // `entity.dispose()` plutôt que `destroy()`.
      (panel as unknown as { dispose?: () => void }).dispose?.();
    },
  };
}
```

- [ ] **Step 2 : Déclarer le panneau au manifeste**

Dans `apps/demo/src/assets.ts` :

```ts
  'character-panel': {
    url: publicAssetUrl('ui/character.uikitml'),
    type: AssetType.UIKitML,
    name: 'Panneau de personnage',
    priority: 'lazy',
  },
```

- [ ] **Step 3 : Brancher dans la démo**

Dans `apps/demo/src/index.ts`, après le basculement des villageois :

```ts
    void installCharacterUI(world, {
      // Le pont entité → agent : seule la démo le connaît, sa carte étant
      // clavée par identifiant. C'est pourquoi le paquet ne dépend pas de
      // `cardinal-simulation`.
      persona: (entity) => {
        const id = agentIdParEntite.get(entity);
        if (id === undefined) return null;
        const etat = simSystem.runtime.agents.get(id);
        if (etat === undefined) return null;
        return {
          name: etat.profile.name,
          tribe: etat.profile.tribe,
          role: etat.profile.role,
          persona: etat.profile.persona ?? null,
          needs: etat.needs,
          action: etat.currentAction?.verb ?? null,
          plan: etat.plan.map((p) => p.goal),
        };
      },
      inertGenes: (entity) => rapportsParEntite.get(entity) ?? new Set<string>(),
    }).catch((error: unknown) => {
      // Le panneau est un confort : son absence ne doit jamais empêcher le
      // monde de tourner.
      console.warn('[cardinal-demo] panneau de personnage indisponible :', error);
    });
```

`agentIdParEntite` et `rapportsParEntite` sont deux `Map` remplies dans `buildRig` de `upgradeVillagers` — l'entité y est connue en même temps que l'agent et que le `ImportReport`. Les déclarer à côté de `genomes`, et les remplir juste après `createCharacterFromAsset` :

```ts
const agentIdParEntite = new Map<Entity, string>();
const rapportsParEntite = new Map<Entity, ReadonlySet<string>>();
// …dans buildRig, après createCharacterFromAsset :
agentIdParEntite.set(entity, agent.id);
rapportsParEntite.set(entity, new Set([...report.missingMorphs, ...report.missingSurfaces]));
```

- [ ] **Step 4 : Ajouter la dépendance**

Dans `apps/demo/package.json`, ajouter `"@iwsdk/cardinal-character-ui": "workspace:*"` aux `dependencies`, puis `pnpm install`.

- [ ] **Step 5 : Vérifier headless**

Run : `pnpm clips && pnpm -r test && pnpm typecheck && pnpm build`
Expected : tout vert, **aucun test sauté**.

- [ ] **Step 6 : Regarder l'écran, hors immersion**

```bash
cd apps/demo && npx iwsdk dev up
npx iwsdk browser logs --count 200
```

Puis, via la séquence établie à l'étape 3 (`xr enter`, `xr look-at`, `xr exit`, `browser screenshot`) ou directement si le panneau est en vue :

1. le panneau s'affiche et se lit ;
2. cliquer un villageois écrit son nom dans le pied de page ;
3. cliquer `[+]` sur `stature` **fait grandir le villageois**.

**La capture doit montrer le changement**, pas le panneau. Prendre deux captures — avant et après — et les joindre.

- [ ] **Step 7 : Regarder l'écran, en immersion**

Même séquence en session XR. **Si le rendu en immersion reste inobservable** — l'étape 3 a mesuré qu'une session `immersive-vr` active coupe le miroir 2D et rend un écran noir — le dire, et s'en tenir à la preuve hors immersion. **Ne pas annoncer un succès qui n'a pas été vu.**

- [ ] **Step 8 : README et commit**

Écrire `packages/character-ui/README.md` : `installCharacterUI` et ses options, les priorités 90 et 92, le contrat `PersonaView`, la raison pour laquelle le paquet ne dépend pas de la simulation, et le fait que les identifiants du document sont un contrat gardé par `uikitml-ids.test.ts`.

```bash
git add packages/character-ui apps/demo
git commit -m "feat(demo): mount the character panel, and see a villager change from it"
```

---

## Auto-revue

**Couverture de la spec.** §2.1 unité → tâche 1. §2.3 composants → tâche 2. §4 paquet et surface → tâches 3 et 7. §5 sélection → tâche 5. §6 placement → tâche 5. §7 jauge → tâche 4. §8 Réglages et lignes inertes → tâche 4 (le pilotage par `ImportReport` est câblé en tâche 7, step 3). §9 Persona → tâche 6, rafraîchissement 4 Hz en tâche 7. §10 frontière → tâche 6 (`PersonaView`) et tâche 7 (le pont dans la démo). §12.1 tests 1 à 11 → répartis : 1 en tâche 4, 2 à 4 et 6 en tâche 4, 5 en tâche 3, 7 et 8 en tâche 5, 9 et 10 en tâche 6, 11 en tâche 5. §12.2 écran → tâches 1, 6 et 7.

**Un manque trouvé et comblé :** la spec ne disait pas **qui** calcule les gènes inertes. Le paquet ne peut pas : il faudrait qu'il garde le `ImportReport` de chaque entité. C'est donc une option injectée, `inertGenes`, remplie par la démo depuis le rapport que `createCharacterFromAsset` rend déjà.

**Un test de la spec qui n'a pas de tâche :** le test 2 du §12.1 — « `[+]` change le composant **et le squelette compilé** » — traverse le paquet d'UI et le pont. Il est écrit en tâche 4 côté contrôleur (l'écriture) ; **sa moitié « squelette » appartient à la tâche 7**, où le monde réel existe. Ajouté au Step 5 de la tâche 7 : un test d'intégration dans `apps/demo/test/` qui monte un personnage, appelle le `write` du contrôleur, fait tourner `CharacterCompileSystem`, et vérifie que la position d'un os a changé.

**Cohérence des types.** `PanelDocument`/`PanelElement` identiques en tâches 3, 4, 6, 7. `GENE_ROW_IDS` produit en tâche 4, consommé en tâche 4 (test d'identifiants) et 7. `NEED_ROW_IDS`/`PERSONA_IDS` produits en tâche 6, consommés par le test d'identifiants complété au même endroit. `PersonaView` produit en tâche 6, rempli en tâche 7. `placePanel` signature identique en tâches 5 (test et code).

**Un risque d'exécution :** la tâche 4 crée `apps/demo/test/uikitml-ids.test.ts` qui référence des exports de la tâche 6. Le Step 8 de la tâche 4 le dit explicitement et fait écrire d'abord la version réduite. Ne pas l'oublier, sous peine d'un typecheck rouge entre les deux tâches.
