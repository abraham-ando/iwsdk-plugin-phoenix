/**
 * Configuration options for the Cardinal AI Plugin.
 * Supports Tri-Modal inference (Local WebGPU, Cloud API, Self-Hosted Local Server) and Security Profiles.
 */

export type InferenceProviderType = 'local-webgpu' | 'cloud' | 'self-hosted';

export type CacheStorageType = 'opfs' | 'cache-storage' | 'indexeddb' | 'none';

export interface LLMModelConfig {
  /**
   * Identifiant MLC du modèle quantifié. Il doit figurer dans la liste
   * pré-établie de WebLLM : `llama-3.2-1b-it-q4f16-MLC`, longtemps inscrit
   * ici en exemple, n'existe pas — le chemin local ne tournait jamais, donc
   * personne ne l'a vu.
   *
   * Connus et légers : 'Qwen3-0.6B-q4f16_1-MLC' (1,4 Go de VRAM),
   * 'Llama-3.2-1B-Instruct-q4f16_1-MLC' (0,9 Go).
   */
  modelId: string;
  /** Max output tokens per inference cycle (default: 128 for VR budget) */
  maxTokens?: number;
  /** Temperature for sampling (default: 0.7) */
  temperature?: number;
  /** Custom URL for remote model weights if hosted on custom CDN */
  modelUrl?: string;
  /** Expected cryptographic SHA-256 checksum for model weights integrity */
  checksum?: string;
  /** Local cache storage mechanism for model weights (default: 'opfs') */
  cacheType?: CacheStorageType;
  /** Custom local directory path for desktop / native environments */
  cacheDirectory?: string;
  /** Enable cooperative GPU time-slicing (default: true) */
  timeSlicing?: boolean;
  /** Custom app configuration passed to WebLLM engine */
  appConfig?: Record<string, any>;
}

export interface CloudProviderConfig {
  /** Cloud provider flavor for URL routing */
  provider?: 'openai' | 'groq' | 'deepseek' | 'openrouter' | 'anthropic-proxy' | 'proxy' | 'custom';
  /** API key for the cloud service (optional if using proxyUrl or sessionToken) */
  apiKey?: string;
  /** Ephemeral session token / JWT issued by your application backend */
  sessionToken?: string;
  /** Backend-For-Frontend (BFF) proxy URL (e.g. '/api/v1/chat') where the server injects the secret key */
  proxyUrl?: string;
  /** Dynamic token provider function for automatic session token refreshing */
  tokenProvider?: () => Promise<{ token: string; expiresInSeconds?: number }>;
  /** Custom base URL (e.g. 'https://api.groq.com/openai/v1' or 'https://openrouter.ai/api/v1') */
  baseURL?: string;
  /** Model name in the cloud catalog (e.g. 'llama-3.1-8b-instant', 'gpt-4o-mini', 'deepseek-chat') */
  model: string;
  /** Custom HTTP headers to include with requests */
  headers?: Record<string, string>;
  /** Max output tokens */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
}

export interface SelfHostedProviderConfig {
  /** Server engine type */
  serverType?: 'ollama' | 'lmstudio' | 'vllm' | 'localai' | 'openai-compatible';
  /** Endpoint URL (e.g. 'http://192.168.1.100:11434' for Ollama on LAN, or 'http://localhost:1234' for LM Studio) */
  endpoint: string;
  /** Model name running on the local server (e.g. 'llama3.2:3b', 'mistral', 'qwen2.5:7b') */
  model: string;
  /** Optional pre-shared authentication token for secured LAN endpoints */
  authToken?: string;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Max output tokens */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
}

export interface TTSConfig {
  /** Voice model identifier (e.g. 'fr_FR-siwis-medium' or 'en_US-lessac-medium') */
  voiceId: string;
  /** Custom URL to the Piper WASM / ONNX model files */
  modelUrl?: string;
  /** Expected SHA-256 checksum of the voice model */
  checksum?: string;
  /** Playback speech speed multiplier (default: 1.0) */
  speed?: number;
  /** Speech pitch multiplier (default: 1.0) */
  pitch?: number;
}

export interface CardinalAIOptions {
  /** Active inference provider mode (default: 'local-webgpu') */
  provider?: InferenceProviderType;
  /** Configuration for the local WebGPU LLM engine */
  llm?: LLMModelConfig;
  /** Configuration for the Cloud LLM provider */
  cloud?: CloudProviderConfig;
  /** Configuration for the Self-Hosted local LAN server (Ollama, LM Studio) */
  selfHosted?: SelfHostedProviderConfig;
  /** Configuration for the local TTS engine */
  tts?: TTSConfig;
  /** Optional fallback remote endpoint if WebGPU fails */
  remoteFallbackUrl?: string;
  /** Callback for model downloading/compiling progress */
  onProgress?: (progress: { stage: 'llm' | 'tts'; text: string; progress: number }) => void;
}
