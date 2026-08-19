export * from './jwt.js';
export * from './rate-limiter.js';
export * from './server.js';

import { CardinalBFFServer } from './server.js';

// Auto-run if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 3001);

  // `--dev` is the explicit, deliberate opt-in for running without
  // CARDINAL_JWT_SECRET set (e.g. local development). JWTService still
  // refuses the hardcoded default outside dev unless this is set.
  if (process.argv.includes('--dev')) {
    process.env.ALLOW_DEFAULT_JWT_SECRET = 'true';
  }

  try {
    const server = new CardinalBFFServer({ port });
    server.start();
  } catch (err) {
    console.error(`[Cardinal BFF Server] Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
