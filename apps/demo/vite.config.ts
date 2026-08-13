/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

/**
 * `@iwsdk/plugin-phoenix` reads inbound frames through a `SharedArrayBuffer`
 * ring shared with its network worker, which the browser only hands out to a
 * cross-origin isolated page. Without these two headers the plugin silently
 * falls back to `postMessage` — everything still works, just with a copy and a
 * task per frame instead of a shared ring, which is precisely the cost the
 * worker exists to avoid.
 *
 * A production deployment has to send the same pair.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [iwsdkDev()],
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
    headers: crossOriginIsolation,
  },
  preview: { headers: crossOriginIsolation },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  optimizeDeps: {
    // The plugin ships as ESM with its worker resolved through
    // `new URL(..., import.meta.url)`; prebundling it would rewrite that
    // reference and the worker would 404.
    exclude: ['@babylonjs/havok', '@iwsdk/plugin-phoenix'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
