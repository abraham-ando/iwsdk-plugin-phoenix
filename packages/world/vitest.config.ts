import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Swap the DOM-bound `@iwsdk/core` for a shim over the real `elics`
      // runtime — same trick as packages/ai. See test/mocks/iwsdk-core.ts.
      '@iwsdk/core': fileURLToPath(new URL('./test/mocks/iwsdk-core.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.ts'] },
  },
});
