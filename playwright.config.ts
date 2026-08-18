import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: 'features/**/*.steps.ts',
});

export default defineConfig({
  testDir,
  reporter: 'list',
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
