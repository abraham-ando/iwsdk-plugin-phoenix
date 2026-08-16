import { defineConfig } from 'tsup';

// Une seule entrée, ESM, sans dépendance externe à exclure : le paquet n'en a
// aucune. `platform: neutral` interdit toute résolution de module Node, ce qui
// fait échouer la construction si quelqu'un importe `node:fs` par accident.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
});
