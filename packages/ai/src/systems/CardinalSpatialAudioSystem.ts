import { Types, createSystem, type Entity } from '@iwsdk/core';
import { SpatialVoice } from '../components/SpatialVoice';
import { NPCEmotion, EmotionAudioProfiles, EmotionTypeValue } from '../components/NPCEmotion';
import type { ITTSAdapter } from '../adapters/types';

export class CardinalSpatialAudioSystem extends createSystem(
  {
    voices: { required: [SpatialVoice] },
  },
  {
    adapter: { type: Types.Object, default: null },
    masterVolume: { type: Types.Float32, default: 1.0 },
  },
) {
  private ttsAdapter: ITTSAdapter | null = null;
  private audioContext: AudioContext | null = null;
  private activeSources = new Map<number, AudioBufferSourceNode>();

  public override init(): void {
    if (this.config.adapter.value) {
      this.ttsAdapter = this.config.adapter.value as unknown as ITTSAdapter;
    }
  }

  public setTTSAdapter(adapter: ITTSAdapter): void {
    this.ttsAdapter = adapter;
  }

  private getOrCreateAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    }
    return this.audioContext;
  }

  /**
   * Synthesize text to 3D spatialized speech and play on the entity's position.
   */
  public async speak(
    entity: Entity,
    text: string,
    options: { voiceId?: string; speed?: number; pitch?: number } | string = {}
  ): Promise<void> {
    if (!this.ttsAdapter || !this.ttsAdapter.isReady || !text.trim()) {
      return;
    }

    if (!entity.hasComponent(SpatialVoice)) {
      return;
    }

    const opts = typeof options === 'string' ? { voiceId: options } : options;
    const voiceId = opts.voiceId || (entity.getValue(SpatialVoice, 'voiceId') as unknown as string) || 'fr_FR-siwis-medium';
    let basePitch = opts.pitch ?? (entity.getValue(SpatialVoice, 'pitch') ?? 1.0);
    let baseSpeed = opts.speed ?? 1.0;

    // Modulate pitch and speed if NPCEmotion is present
    if ((NPCEmotion as any).bit && entity.hasComponent(NPCEmotion)) {
      const emotionVal = (entity.getValue(NPCEmotion, 'currentEmotion') ?? 0) as EmotionTypeValue;
      const profile = EmotionAudioProfiles[emotionVal];
      if (profile) {
        basePitch *= profile.pitchMultiplier;
        baseSpeed *= profile.speedMultiplier;
      }
    }

    const entityId = entity.index ?? (entity as any).id ?? 0;
    entity.setValue(SpatialVoice, 'isPlaying', true);

    try {
      const audioResult = await this.ttsAdapter.synthesize({
        text,
        voiceId,
        pitch: basePitch,
        speed: baseSpeed,
      });

      const ctx = this.getOrCreateAudioContext();
      if (!ctx) {
        // Headless environment
        entity.setValue(SpatialVoice, 'isPlaying', false);
        return;
      }

      // Convert Float32Array PCM to AudioBuffer
      const pcm = audioResult.audioData || audioResult.pcmData!;
      const audioBuffer = ctx.createBuffer(1, pcm.length, audioResult.sampleRate);
      audioBuffer.copyToChannel(pcm as any, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = basePitch;

      // 3D Panner Node (Meta Quest HRTF + Directional Voice Cone)
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = entity.getValue(SpatialVoice, 'refDistance') ?? 2.0;
      panner.maxDistance = entity.getValue(SpatialVoice, 'maxDistance') ?? 25.0;
      panner.rolloffFactor = entity.getValue(SpatialVoice, 'rolloffFactor') ?? 1.5;
      panner.coneInnerAngle = 120;
      panner.coneOuterAngle = 240;
      panner.coneOuterGain = 0.35;

      // Gain Node
      const gainNode = ctx.createGain();
      gainNode.gain.value = this.config.masterVolume.value;

      source.connect(panner);
      panner.connect(gainNode);
      gainNode.connect(ctx.destination);

      this.stopSpeaking(entity);
      this.activeSources.set(entityId, source);

      source.onended = () => {
        entity.setValue(SpatialVoice, 'isPlaying', false);
        this.activeSources.delete(entityId);
      };

      source.start(0);
    } catch (err) {
      entity.setValue(SpatialVoice, 'isPlaying', false);
      throw err;
    }
  }

  /**
   * Stop any active audio playback on this entity.
   */
  public stopSpeaking(entity: Entity): void {
    const entityId = entity.index ?? (entity as any).id ?? 0;
    const existing = this.activeSources.get(entityId);
    if (existing) {
      try {
        existing.stop();
      } catch {
        // Source may have already stopped
      }
      this.activeSources.delete(entityId);
    }
    if (entity.hasComponent(SpatialVoice)) {
      entity.setValue(SpatialVoice, 'isPlaying', false);
    }
  }

  override update(_delta: number, _time: number): void {
    // 3D audio listener orientation updates
  }
}
