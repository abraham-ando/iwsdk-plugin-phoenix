import type { IInferenceAdapter, InferenceRequest, InferenceResponse } from './types';
import type { WorkerMessage, NPCDecisionResultPayload, ModelProgressPayload, ErrorPayload } from '../types/messages';
import type { LLMModelConfig } from '../types/options';

export class WebGPUInferenceAdapter implements IInferenceAdapter {
  private worker: Worker | null = null;
  private _isReady = false;
  private pendingRequests = new Map<string, { resolve: (res: InferenceResponse) => void; reject: (err: Error) => void }>();
  private onProgress?: (progress: { stage: 'llm'; text: string; progress: number }) => void;

  constructor(
    private config: LLMModelConfig,
    onProgress?: (progress: { stage: 'llm'; text: string; progress: number }) => void,
    private workerFactory?: () => Worker
  ) {
    this.onProgress = onProgress;
  }

  public get isReady(): boolean {
    return this._isReady;
  }

  public async init(): Promise<void> {
    if (this._isReady) return;

    return new Promise<void>((resolve, reject) => {
      try {
        if (this.workerFactory) {
          this.worker = this.workerFactory();
        } else if (typeof Worker !== 'undefined') {
          this.worker = new Worker(new URL('./llm.worker.js', import.meta.url), {
            type: 'module',
          });
        } else {
          // In Node.js / headless test environments without Web Workers
          this._isReady = true;
          resolve();
          return;
        }

        this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
          const { type, payload } = event.data;

          switch (type) {
            case 'MODEL_PROGRESS': {
              const progress = payload as ModelProgressPayload;
              this.onProgress?.({ stage: 'llm', text: progress.text, progress: progress.progress });
              break;
            }
            case 'MODEL_READY': {
              this._isReady = true;
              resolve();
              break;
            }
            case 'NPC_DECISION_RESULT': {
              const result = payload as NPCDecisionResultPayload;
              const pending = this.pendingRequests.get(result.requestId);
              if (pending) {
                pending.resolve({
                  text: result.text,
                  tokensGenerated: result.tokensGenerated,
                  latencyMs: result.latencyMs,
                });
                this.pendingRequests.delete(result.requestId);
              }
              break;
            }
            case 'ERROR': {
              const errPayload = payload as ErrorPayload;
              if (errPayload.requestId) {
                const pending = this.pendingRequests.get(errPayload.requestId);
                if (pending) {
                  pending.reject(new Error(errPayload.message));
                  this.pendingRequests.delete(errPayload.requestId);
                  return;
                }
              }
              if (!this._isReady) {
                reject(new Error(errPayload.message));
              }
              break;
            }
          }
        };

        this.worker.onerror = (err) => {
          if (!this._isReady) {
            reject(new Error(err.message || 'Failed to initialize WebGPU LLM Worker'));
          }
        };

        this.worker.postMessage({
          type: 'LOAD_MODEL',
          payload: this.config,
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public async generate(request: InferenceRequest): Promise<InferenceResponse> {
    if (!this._isReady || !this.worker) {
      throw new Error('WebGPU Inference Engine is not initialized');
    }

    const requestId = `${request.npcId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    return new Promise<InferenceResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      this.worker!.postMessage({
        type: 'GENERATE_NPC_DECISION',
        payload: {
          requestId,
          npcId: request.npcId,
          systemPrompt: request.systemPrompt,
          worldContext: request.worldContext,
          playerMessage: request.playerMessage,
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          maxTokens: request.maxTokens ?? this.config.maxTokens ?? 128,
        },
      });
    });
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this._isReady = false;
    for (const [, req] of this.pendingRequests) {
      req.reject(new Error('Inference adapter disposed'));
    }
    this.pendingRequests.clear();
  }
}
