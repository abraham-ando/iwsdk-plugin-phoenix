import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component configuring voice capture and VAD parameters on an avatar or interaction zone.
 */
export const VoiceReceiver = createComponent(
  'VoiceReceiver',
  {
    /** True when microphone stream is active and recording */
    isListening: { type: Types.Boolean, default: false },
    /** True when player speech activity is actively detected above threshold */
    isSpeechDetected: { type: Types.Boolean, default: false },
    /** Audio RMS energy threshold to trigger speech start [0.005 - 0.1] */
    vadThreshold: { type: Types.Float32, default: 0.02 },
    /** Duration in ms of continuous silence required to trigger end-of-speech */
    silenceTimeoutMs: { type: Types.Float32, default: 800 },
    /** Current real-time audio input volume level [0.0 - 1.0] */
    currentVolume: { type: Types.Float32, default: 0.0 },
  },
  'Microphone voice capture and Voice Activity Detection (VAD) for player VR input',
);
