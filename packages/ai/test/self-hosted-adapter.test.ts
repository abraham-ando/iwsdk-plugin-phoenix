import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SelfHostedInferenceAdapter } from '../src/adapters/SelfHostedInferenceAdapter';

describe('SelfHostedInferenceAdapter', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should initialize successfully with valid endpoint', async () => {
    const adapter = new SelfHostedInferenceAdapter({
      endpoint: 'http://192.168.1.50:11434',
      model: 'llama3.2:3b',
      serverType: 'ollama',
    });

    await adapter.init();
    expect(adapter.isReady).toBe(true);
  });

  it('should send request to Ollama /api/chat format', async () => {
    const mockOllamaResponse = {
      model: 'llama3.2:3b',
      message: {
        role: 'assistant',
        content: 'Je suis un forgeron nain.',
      },
      eval_count: 32,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOllamaResponse,
    }) as any;

    const adapter = new SelfHostedInferenceAdapter({
      endpoint: 'http://192.168.1.50:11434',
      model: 'llama3.2:3b',
      serverType: 'ollama',
    });

    await adapter.init();
    const result = await adapter.generate({
      npcId: 2,
      systemPrompt: 'Tu es un forgeron.',
      playerMessage: 'Que forges-tu ?',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('http://192.168.1.50:11434/api/chat');
    expect(JSON.parse(options.body).stream).toBe(false);
    expect(result.text).toBe('Je suis un forgeron nain.');
    expect(result.tokensGenerated).toBe(32);
  });

  it('should send request to LM Studio /v1/chat/completions format', async () => {
    const mockLMStudioResponse = {
      choices: [
        {
          message: {
            content: 'Bienvenue dans la tour de magie.',
          },
        },
      ],
      usage: { total_tokens: 28 },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockLMStudioResponse,
    }) as any;

    const adapter = new SelfHostedInferenceAdapter({
      endpoint: 'http://192.168.1.50:1234',
      model: 'qwen2.5-7b-instruct',
      serverType: 'lmstudio',
    });

    await adapter.init();
    const result = await adapter.generate({
      npcId: 3,
      systemPrompt: 'Tu es un mage.',
      playerMessage: 'Bonjour !',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('http://192.168.1.50:1234/v1/chat/completions');
    expect(result.text).toBe('Bienvenue dans la tour de magie.');
    expect(result.tokensGenerated).toBe(28);
  });
});
