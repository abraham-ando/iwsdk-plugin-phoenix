/**
 * Plugin entrypoint for Cardinal AI.
 * Registers ECS components and systems on an IWSDK World with Tri-Modal LLM Providers and Group Conversations.
 */
import type { World } from '@iwsdk/core';
import { SmartNPC } from './components/SmartNPC';
import { SpatialVoice } from './components/SpatialVoice';
import { NPCMemory } from './components/NPCMemory';
import { NPCEmotion } from './components/NPCEmotion';
import { FacialLipSync } from './components/FacialLipSync';
import { VoiceReceiver } from './components/VoiceReceiver';
import { NPCGazeTracker } from './components/NPCGazeTracker';
import { NPCBanter } from './components/NPCBanter';
import { SpatialDialogueUI } from './components/SpatialDialogueUI';
import { AILOD } from './components/AILOD';
import { NPCPerception } from './components/NPCPerception';

import { CardinalIntelligenceSystem } from './systems/CardinalIntelligenceSystem';
import { CardinalSpatialAudioSystem } from './systems/CardinalSpatialAudioSystem';
import { LipSyncSystem } from './systems/LipSyncSystem';
import { VoiceInputSystem } from './systems/VoiceInputSystem';
import { GazeIKSystem } from './gaze/GazeIKSystem';
import { NPCBanterSystem } from './social/NPCBanterSystem';
import { GroupConversationSystem } from './social/GroupConversationSystem';
import { SpatialRAGSystem } from './rag/SpatialRAGSystem';
import { AcousticOcclusionSystem } from './acoustics/AcousticOcclusionSystem';
import { DialogueBubbleSystem } from './ui/DialogueBubbleSystem';
import { AILODSystem } from './lod/AILODSystem';
import { GrabbableReactionSystem } from './perception/GrabbableReactionSystem';

import { WebGPUInferenceAdapter } from './adapters/WebGPUInferenceAdapter';
import { CloudInferenceAdapter } from './adapters/CloudInferenceAdapter';
import { SelfHostedInferenceAdapter } from './adapters/SelfHostedInferenceAdapter';
import { RemoteInferenceAdapter } from './adapters/RemoteInferenceAdapter';
import { PiperTTSAdapter } from './adapters/PiperTTSAdapter';
import type { IInferenceAdapter, ITTSAdapter } from './adapters/types';
import type { CardinalAIOptions } from './types/options';

/**
 * System priorities for Cardinal AI.
 * Ordered after simulation and rendering updates.
 */
export const AISystemPriority = {
  AI_LOD: 115,
  GRABBABLE_REACTION: 118,
  GAZE_IK: 120,
  VOICE_INPUT: 125,
  SPATIAL_RAG: 128,
  INTELLIGENCE: 130,
  BANTER: 132,
  GROUP_CONVERSATION: 133,
  ACOUSTIC_OCCLUSION: 138,
  SPATIAL_AUDIO: 140,
  LIP_SYNC: 145,
  DIALOGUE_BUBBLE: 148,
} as const;

export interface CardinalAIHandle {
  /** The active LLM inference adapter */
  inferenceAdapter: IInferenceAdapter;
  /** The active TTS audio adapter */
  ttsAdapter: ITTSAdapter;
  /** Resolves when all workers and model weights are ready */
  ready: Promise<void>;
  /** Unregister systems and release memory / workers */
  dispose(): void;
}

/**
 * Install Edge AI intelligence and 3D spatialized voice on an IWSDK World.
 */
export function installCardinalAI(
  world: World,
  options: CardinalAIOptions = {},
): CardinalAIHandle {
  const {
    provider = 'local-webgpu',
    llm = { modelId: 'llama-3.2-1b-it-q4f16-MLC' },
    cloud,
    selfHosted,
    tts = { voiceId: 'fr_FR-siwis-medium' },
    remoteFallbackUrl,
    onProgress,
  } = options;

  // 1. Instantiate Inference Adapter based on selected provider mode
  let inferenceAdapter: IInferenceAdapter;

  if (remoteFallbackUrl) {
    inferenceAdapter = new RemoteInferenceAdapter(remoteFallbackUrl);
  } else if (provider === 'cloud' && cloud) {
    inferenceAdapter = new CloudInferenceAdapter(cloud);
  } else if (provider === 'self-hosted' && selfHosted) {
    inferenceAdapter = new SelfHostedInferenceAdapter(selfHosted);
  } else {
    // Default to Local WebGPU in-browser inference
    inferenceAdapter = new WebGPUInferenceAdapter(llm, onProgress);
  }

  const ttsAdapter: ITTSAdapter = new PiperTTSAdapter(tts, onProgress);

  // 2. Register ECS Components
  world
    .registerComponent(SmartNPC)
    .registerComponent(SpatialVoice)
    .registerComponent(NPCMemory)
    .registerComponent(NPCEmotion)
    .registerComponent(FacialLipSync)
    .registerComponent(VoiceReceiver)
    .registerComponent(NPCGazeTracker)
    .registerComponent(NPCBanter)
    .registerComponent(SpatialDialogueUI)
    .registerComponent(AILOD)
    .registerComponent(NPCPerception);

  // 3. Register ECS Systems
  world.registerSystem(AILODSystem, {
    priority: AISystemPriority.AI_LOD,
  });

  world.registerSystem(GrabbableReactionSystem, {
    priority: AISystemPriority.GRABBABLE_REACTION,
  });

  world.registerSystem(GazeIKSystem, {
    priority: AISystemPriority.GAZE_IK,
  });

  world.registerSystem(VoiceInputSystem, {
    priority: AISystemPriority.VOICE_INPUT,
  });

  world.registerSystem(SpatialRAGSystem, {
    priority: AISystemPriority.SPATIAL_RAG,
  });

  world.registerSystem(CardinalIntelligenceSystem, {
    priority: AISystemPriority.INTELLIGENCE,
    configData: {
      adapter: inferenceAdapter,
    },
  });

  world.registerSystem(NPCBanterSystem, {
    priority: AISystemPriority.BANTER,
  });

  world.registerSystem(GroupConversationSystem, {
    priority: AISystemPriority.GROUP_CONVERSATION,
  });

  world.registerSystem(AcousticOcclusionSystem, {
    priority: AISystemPriority.ACOUSTIC_OCCLUSION,
  });

  world.registerSystem(CardinalSpatialAudioSystem, {
    priority: AISystemPriority.SPATIAL_AUDIO,
    configData: {
      adapter: ttsAdapter,
    },
  });

  world.registerSystem(LipSyncSystem, {
    priority: AISystemPriority.LIP_SYNC,
  });

  world.registerSystem(DialogueBubbleSystem, {
    priority: AISystemPriority.DIALOGUE_BUBBLE,
  });

  // 4. Initialize Engines Asynchronously
  const ready = Promise.all([
    inferenceAdapter.init().catch((err) => {
      console.warn('[Cardinal AI] LLM initialization deferred or failed:', err);
    }),
    ttsAdapter.init().catch((err) => {
      console.warn('[Cardinal AI] TTS initialization deferred or failed:', err);
    }),
  ]).then(() => undefined);

  return {
    inferenceAdapter,
    ttsAdapter,
    ready,
    dispose() {
      inferenceAdapter.dispose();
      ttsAdapter.dispose();
      world.unregisterSystem(DialogueBubbleSystem);
      world.unregisterSystem(LipSyncSystem);
      world.unregisterSystem(CardinalSpatialAudioSystem);
      world.unregisterSystem(AcousticOcclusionSystem);
      world.unregisterSystem(GroupConversationSystem);
      world.unregisterSystem(NPCBanterSystem);
      world.unregisterSystem(CardinalIntelligenceSystem);
      world.unregisterSystem(SpatialRAGSystem);
      world.unregisterSystem(VoiceInputSystem);
      world.unregisterSystem(GazeIKSystem);
      world.unregisterSystem(GrabbableReactionSystem);
      world.unregisterSystem(AILODSystem);
    },
  };
}
