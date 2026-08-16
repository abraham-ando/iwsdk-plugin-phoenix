import { defineConfig } from 'tsup';

// Single ESM library entry. `@iwsdk/core` (which re-exports Three) stays
// external so the host application resolves a single Three instance.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'browser',
  external: ['@iwsdk/core', 'three', 'elics', '@iwsdk/cardinal-simulation'],
});
