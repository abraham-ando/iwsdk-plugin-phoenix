import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudInferenceAdapter } from '../src/adapters/CloudInferenceAdapter';

describe('CloudInferenceAdapter', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should initialize successfully with API key', async () => {
    const adapter = new CloudInferenceAdapter({
      provider: 'groq',
      apiKey: 'gsk_test_key',
      model: 'llama-3.1-8b-instant',
    });

    await adapter.init();
    expect(adapter.isReady).toBe(true);
  });

  it('should throw if API key is missing on init', async () => {
    const adapter = new CloudInferenceAdapter({
      apiKey: '',
      model: 'gpt-4o-mini',
    });

    await expect(adapter.init()).rejects.toThrow('Authentication required');
  });

  it('should format request and send to correct Groq endpoint', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: 'Bonjour voyageur céleste !',
          },
        },
      ],
      usage: { total_tokens: 42 },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const adapter = new CloudInferenceAdapter({
      provider: 'groq',
      apiKey: 'gsk_test_key',
      model: 'llama-3.1-8b-instant',
    });

    await adapter.init();
    const result = await adapter.generate({
      npcId: 1,
      systemPrompt: 'Tu es un marchand sage.',
      worldContext: 'Ta taverne est animée.',
      playerMessage: 'Qui es-tu ?',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer gsk_test_key');
    expect(result.text).toBe('Bonjour voyageur céleste !');
    expect(result.tokensGenerated).toBe(42);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle custom baseURL and errors gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as any;

    const adapter = new CloudInferenceAdapter({
      provider: 'custom',
      baseURL: 'https://my-proxy.com/api',
      apiKey: 'bad_key',
      model: 'custom-model',
    });

    await adapter.init();
    await expect(
      adapter.generate({
        npcId: 1,
        systemPrompt: 'System',
        playerMessage: 'Hello',
      })
    ).rejects.toThrow('Request failed with status 401: Unauthorized');
  });

  it('should warm the session token via tokenProvider during init() when using a BFF proxy', async () => {
    const tokenProvider = vi.fn().mockResolvedValue({ token: 'jwt_session_1', expiresInSeconds: 3600 });

    const adapter = new CloudInferenceAdapter({
      proxyUrl: '/api/v1/cardinal/chat',
      tokenProvider,
      model: 'llama-3.1-8b-instant',
    });

    await adapter.init();

    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(adapter.isReady).toBe(true);
  });

  it('should not throw during init() when the BFF is unreachable (tokenProvider rejects)', async () => {
    const tokenProvider = vi.fn().mockRejectedValue(new Error('network error: BFF unreachable'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const adapter = new CloudInferenceAdapter({
      proxyUrl: '/api/v1/cardinal/chat',
      tokenProvider,
      model: 'llama-3.1-8b-instant',
    });

    await expect(adapter.init()).resolves.toBeUndefined();
    expect(adapter.isReady).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('routes chat through the BFF proxyUrl with the session bearer token, never a provider apiKey', async () => {
    const tokenProvider = vi.fn().mockResolvedValue({ token: 'jwt_session_1', expiresInSeconds: 3600 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Bienvenue au village !' } }],
        usage: { total_tokens: 8 },
      }),
    }) as any;

    // No apiKey anywhere in this config — exactly what apps/demo/src/ai-village.ts
    // configures (TS-A2): the provider key never leaves the BFF's environment.
    const adapter = new CloudInferenceAdapter({
      proxyUrl: '/api/v1/cardinal/chat',
      tokenProvider,
      model: 'llama-3.1-8b-instant',
    });

    await adapter.init();
    await adapter.generate({
      npcId: 1,
      systemPrompt: 'Tu es Eldrin.',
      playerMessage: 'Bonjour',
    });

    const [url, options] = (global.fetch as any).mock.calls.at(-1);
    expect(url).toBe('/api/v1/cardinal/chat');
    expect(options.headers.Authorization).toBe('Bearer jwt_session_1');
    expect(JSON.stringify(options)).not.toMatch(/apiKey|demo_key/i);
  });

  it('renews an expired session token automatically mid-session, without the caller ever seeing an auth error', async () => {
    let sessionCalls = 0;
    const tokenProvider = vi.fn().mockImplementation(async () => {
      sessionCalls += 1;
      // A 5s TTL is shorter than TokenManager's 10s expiry safety buffer,
      // so it is already due for renewal on the very next request —
      // exactly the "token expires mid-dialogue" scenario from TS-A2's BDD.
      return { token: `jwt_session_${sessionCalls}`, expiresInSeconds: 5 };
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Salutations !' } }], usage: { total_tokens: 4 } }),
    }) as any;

    const adapter = new CloudInferenceAdapter({
      proxyUrl: '/api/v1/cardinal/chat',
      tokenProvider,
      model: 'llama-3.1-8b-instant',
    });
    await adapter.init();

    const first = await adapter.generate({ npcId: 1, systemPrompt: 'S', playerMessage: 'Un' });
    const second = await adapter.generate({ npcId: 1, systemPrompt: 'S', playerMessage: 'Deux' });

    expect(first.text).toBe('Salutations !');
    expect(second.text).toBe('Salutations !');
    expect(sessionCalls).toBeGreaterThan(1);

    const authHeaders = (global.fetch as any).mock.calls.map(([, opts]: any) => opts.headers.Authorization);
    expect(new Set(authHeaders).size).toBeGreaterThan(1);
  });
});
