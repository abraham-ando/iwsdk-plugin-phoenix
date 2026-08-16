import { defineConfig } from 'tsup';

// Two entries: the pure-ESM library (zero runtime deps, platform neutral)
// and the Node-only headless batch runner (node:fs for dataset writing).
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    platform: 'neutral',
  },
  {
    entry: { headless: 'src/headless.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'node',
  },
  {
    entry: { 'dataset-cli': 'src/dataset-cli.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'node',
  },
]);
