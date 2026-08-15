import { defineConfig } from 'tsup';

// Single pure-ESM library entry. No externals needed: the engine has zero
// runtime dependencies by design (spec §3 — headless, no renderer imports).
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
});
