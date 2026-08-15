import type { IInferenceAdapter, InferenceRequest, InferenceResponse } from './types';

export class RemoteInferenceAdapter implements IInferenceAdapter {
  private _isReady = false;

  constructor(private endpointUrl: string) {}

  public get isReady(): boolean {
    return this._isReady;
  }

  public async init(): Promise<void> {
    this._isReady = true;
  }

  public async generate(request: InferenceRequest): Promise<InferenceResponse> {
    if (!this._isReady) {
      throw new Error('Remote inference adapter not initialized');
    }

    const startTime = performance.now();
    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `${request.systemPrompt}\n${request.worldContext ?? ''}`.trim() },
          { role: 'user', content: request.playerMessage },
        ],
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 128,
      }),
    });

    if (!response.ok) {
      throw new Error(`Remote inference failed with status ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    const latencyMs = performance.now() - startTime;

    return {
      text,
      latencyMs,
    };
  }

  public dispose(): void {
    this._isReady = false;
  }
}
