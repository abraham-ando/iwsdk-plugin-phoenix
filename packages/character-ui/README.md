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

## Tests

```bash
pnpm --filter @iwsdk/cardinal-character-ui test
```
