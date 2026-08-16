export * from './jwt.js';
export * from './rate-limiter.js';
export * from './server.js';

import { CardinalBFFServer } from './server.js';

// Auto-run if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 3001);
  const server = new CardinalBFFServer({ port });
  server.start();
}
