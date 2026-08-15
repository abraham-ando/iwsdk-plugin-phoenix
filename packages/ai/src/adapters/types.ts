/**
 * Adapter interfaces for swappable inference and speech synthesis backends.
 */

export interface InferenceRequest {
  npcId: number;
  systemPrompt: string;
  playerMessage: string;
  worldContext?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface InferenceResponse {
  text: string;
  tokensGenerated?: number;
  latencyMs?: number;
}

export interface IInferenceAdapter {
  /** Initialize the engine, load weights, and prepare the runtime */
  init(): Promise<void>;
  /** Run inference for a given NPC query */
  generate(request: InferenceRequest): Promise<InferenceResponse>;
  /** Terminate workers and release GPU/memory buffers */
  dispose(): void;
  /** Whether the inference engine is loaded and ready */
  readonly isReady: boolean;
}

export interface SpeechRequest {
  npcId?: number;
  text: string;
  voiceId?: string;
  speed?: number;
  pitch?: number;
}

export interface SpeechResponse {
  audioData: Float32Array;
  pcmData?: Float32Array;
  sampleRate: number;
}

export interface ITTSAdapter {
  /** Initialize the TTS engine and load voice weights */
  init(): Promise<void>;
  /** Synthesize raw PCM audio from text */
  synthesize(request: SpeechRequest): Promise<SpeechResponse>;
  /** Terminate workers and release audio buffers */
  dispose(): void;
  /** Whether the TTS engine is ready */
  readonly isReady: boolean;
}
