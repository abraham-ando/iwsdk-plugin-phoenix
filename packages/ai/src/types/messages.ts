/**
 * Inter-worker message protocols for Cardinal Edge AI and TTS subsystems.
 */

export type WorkerMessageType =
  | 'LOAD_MODEL'
  | 'MODEL_PROGRESS'
  | 'MODEL_READY'
  | 'GENERATE_NPC_DECISION'
  | 'NPC_DECISION_RESULT'
  | 'CANCEL_INFERENCE'
  | 'INIT_TTS'
  | 'TTS_READY'
  | 'SYNTHESIZE_SPEECH'
  | 'SPEECH_SYNTHESIZED'
  | 'ERROR';

export interface ModelProgressPayload {
  text: string;
  progress: number;
}

export interface GenerateNPCDecisionPayload {
  requestId: string;
  npcId: number;
  systemPrompt: string;
  worldContext?: string;
  playerMessage: string;
  temperature?: number;
  maxTokens?: number;
}

export interface NPCDecisionResultPayload {
  requestId: string;
  npcId: number;
  text: string;
  tokensGenerated?: number;
  latencyMs?: number;
}

export interface SynthesizeSpeechPayload {
  requestId: string;
  npcId: number;
  text: string;
  voiceId?: string;
  speed?: number;
}

export interface SpeechSynthesizedPayload {
  requestId: string;
  npcId: number;
  audioData: Float32Array;
  sampleRate: number;
}

export interface ErrorPayload {
  message: string;
  code?: string;
  requestId?: string;
}

export interface WorkerMessage<T = unknown> {
  type: WorkerMessageType;
  payload?: T;
}
