import type { ITTSAdapter, SpeechRequest, SpeechResponse } from './types';
import type { WorkerMessage, SpeechSynthesizedPayload, ErrorPayload } from '../types/messages';
import type { TTSConfig } from '../types/options';

export class PiperTTSAdapter implements ITTSAdapter {
  private worker: Worker | null = null;
  private _isReady = false;
  private pendingRequests = new Map<string, { resolve: (res: SpeechResponse) => void; reject: (err: Error) => void }>();

  constructor(
    private config: TTSConfig,
    private onProgress?: (progress: { stage: 'tts'; text: string; progress: number }) => void,
    private workerFactory?: () => Worker
  ) {}

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
          this.worker = new Worker(new URL('../workers/tts.worker.js', import.meta.url), {
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
            case 'TTS_READY': {
              this._isReady = true;
              resolve();
              break;
            }
            case 'SPEECH_SYNTHESIZED': {
              const res = payload as SpeechSynthesizedPayload;
              const pending = this.pendingRequests.get(res.requestId);
              if (pending) {
                pending.resolve({
                  audioData: res.audioData,
                  sampleRate: res.sampleRate,
                });
                this.pendingRequests.delete(res.requestId);
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
            reject(new Error(err.message || 'Failed to initialize TTS Worker'));
          }
        };

        this.worker.postMessage({
          type: 'INIT_TTS',
          payload: this.config,
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public async synthesize(request: SpeechRequest): Promise<SpeechResponse> {
    if (!this._isReady || !this.worker) {
      throw new Error('TTS Engine is not initialized');
    }

    const requestId = `${request.npcId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    return new Promise<SpeechResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      this.worker!.postMessage({
        type: 'SYNTHESIZE_SPEECH',
        payload: {
          requestId,
          npcId: request.npcId,
          text: request.text,
          voiceId: request.voiceId ?? this.config.voiceId,
          speed: request.speed ?? this.config.speed ?? 1.0,
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
      req.reject(new Error('TTS adapter disposed'));
    }
    this.pendingRequests.clear();
  }
}
