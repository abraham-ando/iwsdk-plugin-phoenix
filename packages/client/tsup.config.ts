import { defineConfig } from 'tsup';

/**
 * Two build targets:
 *
 * 1. The library entry (`src/index.ts`) keeps every dependency external so the
 *    host application resolves a single copy of `@iwsdk/core` / `three`.
 * 2. The worker entry (`src/workers/network.worker.ts`) is fully self-contained:
 *    `phoenix` is inlined so the emitted file can be booted directly through
 *    `new Worker(new URL('./network.worker.js', import.meta.url), { type: 'module' })`
 *    without the host bundler having to resolve bare specifiers inside a worker
 *    graph.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    platform: 'browser',
    external: ['@iwsdk/core', 'three', 'elics', 'phoenix'],
  },
  {
    entry: { 'network.worker': 'src/workers/network.worker.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    noExternal: ['phoenix'],
  },
]);
