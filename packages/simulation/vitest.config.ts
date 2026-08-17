import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Plusieurs tests d'ici font tourner une journée entière de simulation :
    // déterministes, mais entre une et une seconde et demie chacun à froid.
    // Sous `pnpm -r test`, où les sept paquets se disputent les cœurs, ils
    // passent à cinq secondes et dépassent le délai par défaut de vitest —
    // un échec qui ne dit rien du code, et qui ne se reproduit jamais quand
    // on relance le paquet seul. Le budget est ce qui est faux, pas le test.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
