import { Types, createSystem, type Entity } from '@iwsdk/core';
import { VoiceReceiver } from '../components/VoiceReceiver';

export type TranscriptCallback = (transcript: string, entity: Entity) => void | Promise<void>;

export class VoiceInputSystem extends createSystem(
  {
    receivers: { required: [VoiceReceiver] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
    autoMuteDistance: { type: Types.Float32, default: 20.0 },
  },
) {
  private transcriptListeners = new Set<TranscriptCallback>();
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private worker: Worker | null = null;
  private isSTTReady = false;
  private silenceStartTimes = new Map<number, number>();

  public override init(): void {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./stt.worker.js', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (e) => {
          const { type, payload } = e.data;
          if (type === 'STT_READY') {
            this.isSTTReady = true;
          }
        };
        this.worker.postMessage({ type: 'INIT_STT' });
      } catch {
        this.isSTTReady = true;
      }
    } else {
      this.isSTTReady = true;
    }
  }

  /** Add a transcript listener callback */
  public onTranscript(cb: TranscriptCallback): () => void {
    this.transcriptListeners.add(cb);
    return () => this.transcriptListeners.delete(cb);
  }

  /**
   * Start listening on player microphone in browser environment.
   */
  public async startMicrophone(entity: Entity): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
        }
        entity.setValue(VoiceReceiver, 'isListening', true);
      } catch (err) {
        console.warn('[VoiceInputSystem] Could not access microphone:', err);
      }
    } else {
      // In headless test environments
      entity.setValue(VoiceReceiver, 'isListening', true);
    }
  }

  /** Stop microphone capture */
  public stopMicrophone(entity: Entity): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    entity.setValue(VoiceReceiver, 'isListening', false);
    entity.setValue(VoiceReceiver, 'isSpeechDetected', false);
  }

  /**
   * Process a simulated or recorded audio buffer / transcript and dispatch to listeners.
   */
  public async dispatchTranscript(transcript: string, entity: Entity): Promise<void> {
    for (const listener of this.transcriptListeners) {
      await listener(transcript, entity);
    }
  }

  /**
   * Feed raw audio RMS level for VAD processing.
   */
  public processVADLevel(entity: Entity, rmsLevel: number, timeMs = performance.now()): void {
    const entityId = (entity as any).id ?? 0;
    const threshold = entity.getValue(VoiceReceiver, 'vadThreshold') ?? 0.02;
    const silenceTimeout = entity.getValue(VoiceReceiver, 'silenceTimeoutMs') ?? 800;
    const wasSpeaking = entity.getValue(VoiceReceiver, 'isSpeechDetected') ?? false;

    entity.setValue(VoiceReceiver, 'currentVolume', rmsLevel);

    if (rmsLevel >= threshold) {
      entity.setValue(VoiceReceiver, 'isSpeechDetected', true);
      this.silenceStartTimes.delete(entityId);
    } else if (wasSpeaking) {
      // Audio dropped below threshold, track silence duration
      const silenceStart = this.silenceStartTimes.get(entityId) ?? timeMs;
      if (!this.silenceStartTimes.has(entityId)) {
        this.silenceStartTimes.set(entityId, silenceStart);
      }

      if (timeMs - silenceStart >= silenceTimeout) {
        // Speech ended!
        entity.setValue(VoiceReceiver, 'isSpeechDetected', false);
        this.silenceStartTimes.delete(entityId);
      }
    }
  }

  override update(_delta: number, _time: number): void {
    // VAD continuous stream analysis tick
  }
}
