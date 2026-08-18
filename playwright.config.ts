import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: 'features/**/*.steps.ts',
});

export default defineConfig({
  testDir,
  reporter: 'list',
  // TS-A2's two @dom scenarios wait on NPCBanterSystem's spontaneous banter
  // loop (7-10s per-NPC cooldown + a talkativeness coin flip) as the only
  // real chat traffic the demo drives without a scripted HUD click — the
  // default 30s budget isn't enough headroom for that. Measured locally at
  // 11-22s; 60s leaves headroom for CI/cold-cache variance.
  timeout: 60_000,
  use: {
    // The IWSDK dev plugin serves HTTPS-only on 8081 (WebXR requires a
    // secure context) with a self-signed cert — hence https + ignore.
    baseURL: 'https://localhost:8081',
    ignoreHTTPSErrors: true,
  },
  webServer: {
    // Build first: the demo imports compiled workspace packages — same
    // reason the repo's `demo` script is `pnpm build && ... dev`.
    command: 'pnpm build && pnpm --filter @iwsdk/plugin-phoenix-demo dev:runtime',
    url: 'https://localhost:8081',
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
