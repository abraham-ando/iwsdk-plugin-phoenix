import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CharacterIdentity, CharacterStructure, CharacterFace,
  CharacterSurface, CharacterSelection,
} from '@iwsdk/cardinal-character-three/components';
import { Robot } from '../src/robot-component.js';
import components from '../src/components';
// `?raw` : texte brut, pas un module évalué — voir la note d'inertie
// ci-dessous sur pourquoi on ne peut pas simplement importer et observer.
// Typé par `declare module '*?raw'` de `vite/client.d.ts`.
import demoComponentsSource from '../src/components.ts?raw';
import componentsSubpathSource from '@character-three/components-source?raw';

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
    // `toContain(Robot)`, pas un simple compte de longueur : `length >= 6`
    // laisserait passer un sixième composant arbitraire sans jamais vérifier
    // que c'est bien Robot qui est encore là.
    expect(components).toContain(Robot);
  });
});

describe('inertie du manifeste au chargement', () => {
  // `apps/demo/src/components.ts` est évalué deux fois, dans deux réalités JS
  // (application et éditeur) : il doit rester sans effet de bord. Or
  // `@iwsdk/cardinal-character/src/index.ts` appelle `registerFamily(HUMANOID)`
  // SANS CONDITION dès que ce module est évalué.
  //
  // On ne peut pas vérifier ça en important `getFamily` « dans un contexte
  // frais » : importer `getFamily` importe ce même module et déclenche
  // l'enregistrement, quel que soit ce qui a été chargé avant — il n'y a
  // aucune fenêtre où « la famille n'y est pas encore » est observable après
  // l'import. Une tentative avec `vi.resetModules()` + réimport dynamique du
  // sous-chemin `/components` a aussi été écartée : elics tient son registre
  // de composants (`ComponentRegistry.components`) comme un singleton de
  // module, et `resetModules()` ne le réinstancie pas — réimporter
  // `createComponent('CharacterIdentity', …)` fait alors lever elics avec
  // « Component with id 'CharacterIdentity' already exists », un échec qui ne
  // prouve rien sur l'inertie, seulement sur la ré-exécution.
  //
  // On inspecte donc la chaîne d'import STATIQUEMENT, sur le texte SOURCE
  // (pas `dist/` : les chunks de tsup portent un nom haché par le contenu,
  // imprévisible d'un build à l'autre) :
  it("le sous-chemin `/components` de cardinal-character-three ne référence jamais @iwsdk/cardinal-character", () => {
    expect(componentsSubpathSource).not.toMatch(/['"]@iwsdk\/cardinal-character['"]/);
  });

  it('le manifeste de la démo importe le sous-chemin `/components`, pas la racine du paquet ni la famille directement', () => {
    expect(demoComponentsSource).toMatch(/@iwsdk\/cardinal-character-three\/components/);
    expect(demoComponentsSource).not.toMatch(/['"]@iwsdk\/cardinal-character-three['"]/);
    expect(demoComponentsSource).not.toMatch(/['"]@iwsdk\/cardinal-character['"]/);
  });

  // Le test ci-dessus lit un FICHIER, désigné par l'alias `?raw` de
  // `vitest.config.ts`. Rien ne garantissait que ce fichier soit celui que le
  // sous-chemin public `./components` publie : renommer
  // `src/components/index.ts` cassait l'export du paquet en laissant le test
  // vert, sur un fichier que plus personne ne construit. Les trois
  // déclarations doivent nommer le même chemin.
  const CHEMIN_SOURCE = 'src/components/index.ts';
  const racineDuPaquet = join(__dirname, '../../../packages/character-three');

  it("le fichier que l alias `?raw` lit est bien celui que `./components` publie", () => {
    const pkg = JSON.parse(
      readFileSync(join(racineDuPaquet, 'package.json'), 'utf8'),
    ) as { exports: Record<string, { import?: string }> };
    // Le sous-chemin public existe, et il pointe la sortie construite…
    expect(pkg.exports['./components']?.import).toBe('./dist/components/index.js');
    // …que `tsup` construit depuis CE fichier source, et pas un autre.
    const tsup = readFileSync(join(racineDuPaquet, 'tsup.config.ts'), 'utf8');
    expect(tsup).toContain(`'components/index': '${CHEMIN_SOURCE}'`);
    // …celui-là même que l'alias de test désigne.
    const configDeTest = readFileSync(join(__dirname, '../vitest.config.ts'), 'utf8');
    expect(configDeTest).toContain(`packages/character-three/${CHEMIN_SOURCE}`);
    // …et il existe.
    expect(readFileSync(join(racineDuPaquet, CHEMIN_SOURCE), 'utf8').length).toBeGreaterThan(0);
  });
});
