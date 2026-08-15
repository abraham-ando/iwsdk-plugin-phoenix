/**
 * Configuration options for the Cardinal AI Plugin.
 */

export interface LLMModelConfig {
  /** Identifier of the quantized model (e.g. 'gemma-2b-it-q4f16_1-MLC' or 'smollm-1.3b-q4f16') */
  modelId: string;
  /** Max output tokens per inference cycle (default: 128 for VR budget) */
  maxTokens?: number;
  /** Temperature for sampling (default: 0.7) */
  temperature?: number;
  /** Custom URL for remote model weights if hosted locally / CDN */
  modelUrl?: string;
  /** Enable cooperative GPU time-slicing (default: true) */
  timeSlicing?: boolean;
}

export interface TTSConfig {
  /** Voice model identifier (e.g. 'fr_FR-siwis-medium' or 'en_US-lessac-medium') */
  voiceId: string;
  /** Custom URL to the Piper WASM / ONNX model files */
  modelUrl?: string;
  /** Playback speech speed multiplier (default: 1.0) */
  speed?: number;
}

export interface CardinalAIOptions {
  /** Configuration for the local LLM engine */
  llm?: LLMModelConfig;
  /** Configuration for the local TTS engine */
  tts?: TTSConfig;
  /** Optional fallback remote endpoint if WebGPU is unsupported */
  remoteFallbackUrl?: string;
  /** Callback for model downloading/compiling progress */
  onProgress?: (progress: { stage: 'llm' | 'tts'; text: string; progress: number }) => void;
}
