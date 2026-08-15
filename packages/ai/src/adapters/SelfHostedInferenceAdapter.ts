import type { IInferenceAdapter, InferenceRequest, InferenceResponse } from './types';
import type { SelfHostedProviderConfig } from '../types/options';

export class SelfHostedInferenceAdapter implements IInferenceAdapter {
  private _isReady = false;
  private endpoint: string;

  constructor(private config: SelfHostedProviderConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
  }

  public get isReady(): boolean {
    return this._isReady;
  }

  public async init(): Promise<void> {
    if (!this.endpoint) {
      throw new Error('[SelfHostedInferenceAdapter] Endpoint URL is required for self-hosted inference');
    }
    this._isReady = true;
  }

  public async generate(request: InferenceRequest): Promise<InferenceResponse> {
    if (!this._isReady) {
      throw new Error('[SelfHostedInferenceAdapter] Adapter is not initialized');
    }

    const startTime = performance.now();
    const serverType = this.config.serverType ?? (this.endpoint.includes(':11434') ? 'ollama' : 'openai-compatible');

    const messages = [
      {
        role: 'system',
        content: `${request.systemPrompt}${request.worldContext ? `\n[Contexte Monde]: ${request.worldContext}` : ''}`,
      },
      { role: 'user', content: request.playerMessage },
    ];

    let url: string;
    let body: string;

    if (serverType === 'ollama') {
      url = `${this.endpoint}/api/chat`;
      body = JSON.stringify({
        model: this.config.model,
        messages,
        stream: false,
        options: {
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          num_predict: request.maxTokens ?? this.config.maxTokens ?? 128,
        },
      });
    } else {
      url = `${this.endpoint}/v1/chat/completions`;
      body = JSON.stringify({
        model: this.config.model,
        messages,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? this.config.maxTokens ?? 128,
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[SelfHostedInferenceAdapter] Request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    let text = '';

    if (serverType === 'ollama') {
      text = data.message?.content ?? '';
    } else {
      text = data.choices?.[0]?.message?.content ?? '';
    }

    const latencyMs = performance.now() - startTime;
    const tokensGenerated = data.eval_count ?? data.usage?.total_tokens ?? Math.ceil(text.length / 4);

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
