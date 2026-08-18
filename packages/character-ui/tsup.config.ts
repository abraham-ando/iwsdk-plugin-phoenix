import { defineConfig } from 'tsup';

// `@iwsdk/core` (qui réexporte Three) reste externe : l'application doit
// résoudre une seule instance de Three, sans quoi les `instanceof` cassent.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'browser',
  external: [
    '@iwsdk/core',
    'three',
    'elics',
    '@iwsdk/cardinal-character',
    '@iwsdk/cardinal-character-three',
  ],
});
