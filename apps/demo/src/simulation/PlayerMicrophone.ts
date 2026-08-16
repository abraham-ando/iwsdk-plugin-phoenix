/**
 * Push-to-talk player microphone (spec §10.5): browser mic → Cardinal STT →
 * transcript → the same playerSpeak path as the text box (memories, LLM
 * reply, player_text dataset tagging). Degrades silently: without mic
 * permission or STT, the text box remains the safe route.
 */
import { type Entity, type World } from '@iwsdk/core';
import { VoiceInputSystem, VoiceReceiver } from '@iwsdk/plugin-cardinal-ai';

export class PlayerMicrophone {
  private readonly voiceSystem: VoiceInputSystem | undefined;
  private readonly entity: Entity | null = null;
  private listening = false;
  private warned = false;

  constructor(world: World, onTranscript: (text: string) => void) {
    this.voiceSystem = world.getSystem(VoiceInputSystem) ?? undefined;
    if (this.voiceSystem === undefined) return;
    const entity = world.createEntity();
    entity.addComponent(VoiceReceiver, {});
    this.entity = entity;
    this.voiceSystem.onTranscript((transcript) => {
      const text = transcript.trim();
      if (this.listening && text.length > 0) onTranscript(text);
    });
  }

  get available(): boolean {
    return this.voiceSystem !== undefined && this.entity !== null;
  }

  get active(): boolean {
    return this.listening;
  }

  async start(): Promise<boolean> {
    if (this.voiceSystem === undefined || this.entity === null) return false;
    try {
      await this.voiceSystem.startMicrophone(this.entity);
      this.listening = true;
      return true;
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn('[PlayerMicrophone] microphone unavailable — use the text box.', err);
      }
      return false;
    }
  }

  stop(): void {
    if (this.voiceSystem !== undefined && this.entity !== null && this.listening) {
      this.voiceSystem.stopMicrophone(this.entity);
    }
    this.listening = false;
  }
}
