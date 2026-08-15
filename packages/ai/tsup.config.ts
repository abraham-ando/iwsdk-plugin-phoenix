import { defineConfig } from 'tsup';

/**
 * Three build targets for @iwsdk/plugin-cardinal-ai:
 *
 * 1. The library entry (`src/index.ts`) keeps `@iwsdk/core`, `three`, and `elics`
 *    external so the host application resolves a single copy.
 * 2. `gemma.worker.ts` is a self-contained Web Worker entry for WebGPU LLM compute.
 * 3. `tts.worker.ts` is a self-contained Web Worker entry for Piper TTS WASM.
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
    external: ['@iwsdk/core', 'three', 'elics'],
  },
  {
    entry: { 'gemma.worker': 'src/workers/gemma.worker.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    external: ['@iwsdk/core', 'three', 'elics'],
  },
  {
    entry: { 'tts.worker': 'src/workers/tts.worker.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    external: ['@iwsdk/core', 'three', 'elics'],
  },
  {
    entry: { 'stt.worker': 'src/workers/stt.worker.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    external: ['@iwsdk/core', 'three', 'elics'],
  },
]);
