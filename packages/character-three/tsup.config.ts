import { defineConfig } from 'tsup';

// `@iwsdk/core` (qui réexporte Three) reste externe : l'application doit
// résoudre une seule instance de Three, sans quoi les `instanceof` cassent.
export default defineConfig({
  // Second point d'entrée : `./components` n'importe que `createComponent` et
  // `Types` depuis `@iwsdk/core`, donc n'entraîne ni les systèmes ni
  // `@iwsdk/cardinal-character` (dont `registerFamily(HUMANOID)` s'exécute au
  // chargement du module). Le manifeste de la démo l'utilise pour rester
  // sans effet de bord dans les deux réalités JS où il est évalué.
  entry: { index: 'src/index.ts', 'components/index': 'src/components/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'browser',
  external: ['@iwsdk/core', 'three', 'elics', '@iwsdk/cardinal-character'],
});
