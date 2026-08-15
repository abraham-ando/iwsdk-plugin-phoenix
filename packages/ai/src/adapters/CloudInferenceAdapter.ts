import type { IInferenceAdapter, InferenceRequest, InferenceResponse } from './types';
import type { CloudProviderConfig } from '../types/options';

export class CloudInferenceAdapter implements IInferenceAdapter {
  private _isReady = false;
  private baseURL: string;

  constructor(private config: CloudProviderConfig) {
    this.baseURL = this.resolveBaseURL(config);
  }

  public get isReady(): boolean {
    return this._isReady;
  }

  private resolveBaseURL(config: CloudProviderConfig): string {
    if (config.baseURL) return config.baseURL.replace(/\/$/, '');

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
    if (!this.config.apiKey) {
      throw new Error('[CloudInferenceAdapter] API key is required for cloud inference');
    }
    this._isReady = true;
  }

  public async generate(request: InferenceRequest): Promise<InferenceResponse> {
    if (!this._isReady) {
      throw new Error('[CloudInferenceAdapter] Adapter is not initialized');
    }

    const startTime = performance.now();
    const endpoint = `${this.baseURL}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.headers,
    };

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
  }
}
