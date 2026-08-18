import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Le rig de test vit dans `@iwsdk/cardinal-character-three`, avec
      // l'invariant qu'il encode (les 19 rôles d'os de HUMANOID) ; le
      // dupliquer ici le laisserait diverger en silence.
      //
      // Un alias plutôt qu'un `../../../packages/…` : le chemin relatif
      // traversait une frontière de paquet et cassait au premier déplacement
      // de fichier. Et un alias plutôt qu'un sous-chemin d'export du paquet :
      // ces fixtures sont du code de TEST, elles n'ont rien à faire dans la
      // surface publique que consomme la démo.
      '@character-three/fixtures': fileURLToPath(
        new URL('../../packages/character-three/test/fixtures', import.meta.url),
      ),
      // Même logique que l'alias ci-dessus, mais pour lire le texte source du
      // sous-chemin `/components` (voir test/components.test.ts) : un test
      // d'inertie a besoin du fichier SOURCE, pas du `dist/` construit — les
      // chunks de tsup portent un nom haché par le contenu, imprévisible. La
      // clé se termine par `?raw` (littéralement, dans le spécificateur
      // importé) pour retomber sur `declare module '*?raw'` de
      // `vite/client.d.ts` côté types, et pour que Vite lise le fichier comme
      // texte brut plutôt que de l'évaluer comme module côté runtime.
      '@character-three/components-source?raw': fileURLToPath(
        new URL('../../packages/character-three/src/components/index.ts', import.meta.url),
      ) + '?raw',
      // La SOURCE du paquet, pas son `dist/`.
      //
      // `character-panel-integration.test.ts` est la seule preuve de bout en
      // bout de l'étape — clic `[+]` jusqu'à l'os déplacé — et le champ
      // `exports` du paquet la faisait porter sur `./dist/index.js`. Or `dist`
      // est ignoré par git (`.gitignore`), le script racine `test` ne construit
      // rien avant les tests de la démo, et la CI lance `pnpm build` APRÈS
      // `pnpm test` : sur une machine où `dist/` est périmé, le garde le plus
      // important de la branche validait la dernière construction et non
      // l'arbre de travail ; sur une extraction propre, l'import ne résolvait
      // même plus. On pointe donc le répertoire `src` (Vite y résout
      // `index.ts`), et le test suit le code qu'on vient d'écrire.
      //
      // `@iwsdk/cardinal-character-three` a la même dette, ANTÉRIEURE à cette
      // étape et partagée avec d'autres tests ; l'aliaser ici ferait charger
      // ses composants une seconde fois (`createComponent` au niveau module
      // dans deux réalités), et elics lève sur le doublon. Elle se traite en
      // construisant avant les tests, pas ici.
      //
      // `tsconfig.json` porte le `paths` jumeau, pour que `pnpm typecheck` et
      // `vitest` vérifient le MÊME code.
      '@iwsdk/cardinal-character-ui': fileURLToPath(
        new URL('../../packages/character-ui/src', import.meta.url),
      ),
    },
  },
  test: { globals: true, environment: 'node', include: ['test/**/*.test.ts'] },
});
