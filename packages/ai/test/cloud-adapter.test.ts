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

    await expect(adapter.init()).rejects.toThrow('API key is required');
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
});
