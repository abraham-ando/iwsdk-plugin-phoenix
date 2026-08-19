import type { IInferenceAdapter, InferenceRequest, InferenceResponse } from './types';
import type { CloudProviderConfig } from '../types/options';
import { TokenManager } from '../security/TokenManager';

export class CloudInferenceAdapter implements IInferenceAdapter {
  private _isReady = false;
  private baseURL: string;
  private tokenManager: TokenManager;

  constructor(private config: CloudProviderConfig) {
    this.baseURL = this.resolveBaseURL(config);
    this.tokenManager = new TokenManager({
      token: config.sessionToken ?? config.apiKey,
      fetchToken: config.tokenProvider,
    });
  }

  public get isReady(): boolean {
    return this._isReady;
  }

  private resolveBaseURL(config: CloudProviderConfig): string {
    if (config.proxyUrl) {
      return config.proxyUrl.replace(/\/$/, '');
    }
    if (config.baseURL) {
      return config.baseURL.replace(/\/$/, '');
    }

    switch (config.provider) {
      case 'groq':
        return 'https://api.groq.com/openai/v1';
      case 'deepseek':
        return 'https://api.deepseek.com/v1';
      case 'openrouter':
        return 'https://openrouter.ai/api/v1';
      case 'openai':
      default:
        return 'https://api.openai.com/v1';
    }
  }

  public async init(): Promise<void> {
    if (!this.config.apiKey && !this.config.sessionToken && !this.config.proxyUrl && !this.config.tokenProvider) {
      throw new Error('[CloudInferenceAdapter] Authentication required (apiKey, sessionToken, tokenProvider, or proxyUrl)');
    }
    this._isReady = true;

    // Warm the BFF session token at startup rather than waiting for the
    // first `generate()` call — this is what makes "the village starts up"
    // observably emit the auth request, instead of leaving it to whenever
    // an NPC happens to speak first. A cold/unreachable BFF must not fail
    // init(): the adapter stays ready and `generate()` will surface (and
    // callers will handle) the auth failure per-request.
    if (this.config.tokenProvider) {
      try {
        await this.tokenManager.getValidToken();
      } catch (err) {
        console.warn('[CloudInferenceAdapter] Could not warm session token at init (BFF unreachable?):', err);
      }
    }
  }

  public async generate(request: InferenceRequest): Promise<InferenceResponse> {
    if (!this._isReady) {
      throw new Error('[CloudInferenceAdapter] Adapter is not initialized');
    }

    const startTime = performance.now();
    const endpoint = this.config.proxyUrl
      ? this.baseURL
      : `${this.baseURL}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    // If an auth token is available, inject Authorization header
    try {
      const token = await this.tokenManager.getValidToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // If using an unauthenticated proxy or custom backend, allow request
      if (!this.config.proxyUrl) {
        throw new Error('[CloudInferenceAdapter] Missing authorization token for request');
      }
    }

    const messages = [
      {
        role: 'system',
        content: `${request.systemPrompt}${request.worldContext ? `\n[Contexte Monde]: ${request.worldContext}` : ''}`,
      },
      { role: 'user', content: request.playerMessage },
    ];

    const body = JSON.stringify({
      model: this.config.model,
      messages,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 128,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[CloudInferenceAdapter] Request failed with status ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? '';
    const latencyMs = performance.now() - startTime;
    const tokensGenerated = data.usage?.total_tokens ?? Math.ceil(text.length / 4);

    return {
      text,
      latencyMs,
      tokensGenerated,
    };
  }

  public dispose(): void {
    this._isReady = false;
    this.tokenManager.clear();
  }
}
