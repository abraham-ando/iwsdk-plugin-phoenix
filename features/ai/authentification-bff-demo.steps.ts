/**
 * Steps for TS-A2 — the demo must never hold a provider API key: it gets a
 * short-lived JWT from a mock BFF (`POST /api/auth/session`) and proxies all
 * chat through it (`POST /api/v1/cardinal/chat`).
 *
 * These are DOM/network steps only (see features/README.md): a real
 * `apps/bff-server` process is not started. Instead `page.route` replays its
 * documented contract — issue a JWT, then relay chat — without ever holding
 * (or leaking) a real provider key, which is exactly the property under
 * test. Real chat traffic here comes from `NPCBanterSystem`'s spontaneous
 * banter loop (the only network-reaching path the demo drives without a
 * scripted HUD click — see apps/demo/src/ai-village.ts); it is gated by a
 * per-NPC cooldown (7-10s) and a talkativeness coin flip, hence the generous
 * timeouts below.
 */
import { expect, type Page, type Request } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

const AUTH_PATH = '/api/auth/session';
const CHAT_PATH = '/api/v1/cardinal/chat';
// Matches apps/demo/src/ai-bff-auth.ts's `resolveBffBaseUrl()` default — no
// VITE_BFF_URL is set for this test run, so this is where the demo actually
// sends its auth/chat requests, and where these steps mock the BFF.
const MOCK_BFF_ORIGIN = 'http://localhost:3001';
// Measured locally: first spontaneous banter lands at 8-15s (per-NPC 7-10s
// cooldown + a talkativeness coin flip). 45s leaves headroom under the
// playwright.config.ts 60s test timeout for CI/cold-cache variance.
const BANTER_TIMEOUT_MS = 45_000;

/** Patterns that would only ever appear if a real provider key leaked client-side. */
const PROVIDER_KEY_LEAK_MARKERS = [
  /demo_key/i,
  /gsk_[a-z0-9]/i, // Groq key prefix
  /sk-[a-z0-9]/i, // OpenAI-style key prefix
  /api\.groq\.com/i,
  /api\.openai\.com/i,
  /api\.deepseek\.com/i,
];

interface RequestRecord {
  url: string;
  postData: string | null;
  authorization: string | null;
}

const requestLogs = new WeakMap<Page, RequestRecord[]>();

function recordRequests(page: Page): RequestRecord[] {
  const log: RequestRecord[] = [];
  requestLogs.set(page, log);
  page.on('request', (request: Request) => {
    log.push({
      url: request.url(),
      postData: request.postData(),
      authorization: request.headers()['authorization'] ?? null,
    });
  });
  return log;
}

/**
 * Two complementary checks, deliberately not just one (per security review):
 * a pattern denylist only catches leak *shapes* we already know about (a new
 * provider with an unlisted key prefix would slip through silently), so this
 * also asserts every AI-related request's origin is exactly the mocked BFF —
 * an allowlist that holds regardless of which provider the BFF proxies to.
 */
function assertNoProviderKeyLeak(log: RequestRecord[], bffOrigin: string): void {
  for (const entry of log) {
    const haystack = `${entry.url} ${entry.postData ?? ''} ${entry.authorization ?? ''}`;
    for (const marker of PROVIDER_KEY_LEAK_MARKERS) {
      expect(haystack, `requête suspecte (fuite possible de clé fournisseur) : ${entry.url}`).not.toMatch(marker);
    }

    if (entry.url.includes(AUTH_PATH) || entry.url.includes(CHAT_PATH)) {
      expect(new URL(entry.url).origin, `requête IA hors du BFF mocké : ${entry.url}`).toBe(bffOrigin);
    }
  }
}

/** Installs the mock BFF: issues a JWT, then relays chat OpenAI-style. */
async function mockBff(page: Page, expiresInSeconds: number): Promise<{ sessionCalls: number }> {
  const state = { sessionCalls: 0 };

  await page.route(`**${AUTH_PATH}`, async (route) => {
    state.sessionCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        token: `mock-session-jwt-${state.sessionCalls}`,
        expiresInSeconds,
      }),
    });
  });

  await page.route(`**${CHAT_PATH}`, async (route) => {
    const request = route.request();
    // Mirrors apps/bff-server: 401 without a bearer token from a session
    // this mock actually issued — proves the client never falls back to a
    // provider key when the BFF-issued JWT is missing.
    const authHeader = request.headers()['authorization'] ?? '';
    if (!authHeader.startsWith('Bearer mock-session-jwt-')) {
      await route.fulfill({ status: 401, body: JSON.stringify({ error: 'unauthorized' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        choices: [{ message: { content: 'Salutations, voyageur !' } }],
        usage: { total_tokens: 12 },
      }),
    });
  });

  return state;
}

Given('le BFF démarré avec une clé fournisseur dans son environnement', async ({ page }) => {
  recordRequests(page);
  await mockBff(page, 3600);
});

Given('une session dont le jeton expire dans {int} secondes', async ({ page }, ttlSeconds: number) => {
  recordRequests(page);
  const state = await mockBff(page, ttlSeconds);
  (page as unknown as { _tsA2State: { sessionCalls: () => number } })._tsA2State = {
    sessionCalls: () => state.sessionCalls,
  };
});

When('la démo démarre son village IA', async ({ page }) => {
  await page.goto('/');
});

When('le joueur dialogue avec un PNJ après l\'expiration', async ({ page }) => {
  await page.goto('/');
  // The village's own spontaneous banter is the only real chat traffic this
  // demo drives without a scripted HUD click; wait for at least two chat
  // exchanges so a renewal (triggered by the 5s TTL beating TokenManager's
  // 10s expiry buffer) is guaranteed to have happened by the second one.
  let chatCalls = 0;
  await page.waitForRequest(
    (request) => {
      if (request.url().includes(CHAT_PATH) && request.method() === 'POST') {
        chatCalls += 1;
      }
      return chatCalls >= 2;
    },
    { timeout: BANTER_TIMEOUT_MS }
  );
});

Then('une requête POST {word} a été émise', async ({ page }, path: string) => {
  await page.waitForRequest(
    (request) => request.url().includes(path) && request.method() === 'POST',
    { timeout: BANTER_TIMEOUT_MS }
  );
});

Then('les requêtes de chat partent vers {word}', async ({ page }, path: string) => {
  await page.waitForRequest(
    (request) => request.url().includes(path) && request.method() === 'POST',
    { timeout: BANTER_TIMEOUT_MS }
  );
});

Then('aucune requête sortante ne porte la clé fournisseur', async ({ page }) => {
  const log = requestLogs.get(page) ?? [];
  assertNoProviderKeyLeak(log, MOCK_BFF_ORIGIN);
});

Then('une nouvelle session est obtenue automatiquement', async ({ page }) => {
  const state = (page as unknown as { _tsA2State?: { sessionCalls: () => number } })._tsA2State;
  expect(state, 'le step Given de ce scénario doit initialiser _tsA2State').toBeTruthy();
  expect(state!.sessionCalls()).toBeGreaterThan(1);
});

Then("la réponse du PNJ arrive sans erreur affichée", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  // Give in-flight handlers a beat to settle before asserting silence.
  await page.waitForTimeout(500);
  expect(errors, `erreurs inattendues en console : ${errors.join('; ')}`).toEqual([]);
});
