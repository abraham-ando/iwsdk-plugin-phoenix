import { Types, createSystem, type Entity } from '@iwsdk/core';
import { SpatialDialogueUI } from '../components/SpatialDialogueUI';
import { SmartNPC } from '../components/SmartNPC';

export interface ActiveBubbleState {
  text: string;
  words: string[];
  currentWord: number;
  isThinking: boolean;
  visible: boolean;
}

export class DialogueBubbleSystem extends createSystem(
  {
    bubbles: { required: [SpatialDialogueUI] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
    wordsPerSecond: { type: Types.Float32, default: 3.5 },
  },
) {
  private bubbleStates = new Map<number, ActiveBubbleState>();

  /**
   * Set subtitle text to display in the 3D bubble.
   */
  public showSpeech(entity: Entity, text: string): void {
    const id = entity.index ?? (entity as any).id ?? 0;
    const words = text.trim().split(/\s+/);
    this.bubbleStates.set(id, {
      text,
      words,
      currentWord: 0,
      isThinking: false,
      visible: true,
    });
    entity.setValue(SpatialDialogueUI, 'displayStartTime', performance.now());
    entity.setValue(SpatialDialogueUI, 'activeWordIndex', 0);
  }

  /**
   * Hide or dismiss the bubble.
   */
  public hideSpeech(entity: Entity): void {
    const id = entity.index ?? (entity as any).id ?? 0;
    const state = this.bubbleStates.get(id);
    if (state) {
      state.visible = false;
    }
  }

  /**
   * Get active text state for rendering in 3D UI / UIKitML.
   */
  public getBubbleState(entity: Entity): ActiveBubbleState | undefined {
    const id = entity.index ?? (entity as any).id ?? 0;
    return this.bubbleStates.get(id);
  }

  override update(_delta: number, time: number): void {
    if (!this.config.enabled.value) return;

    for (const entity of this.queries.bubbles.entities) {
      const id = entity.index ?? (entity as any).id ?? 0;
      let state = this.bubbleStates.get(id);

      // Check SmartNPC isThinking
      const isThinking = (SmartNPC as any).bit && entity.hasComponent(SmartNPC)
        ? Boolean(entity.getValue(SmartNPC, 'isThinking'))
        : false;

      if (isThinking) {
        if (!state) {
          state = { text: '...', words: ['...'], currentWord: 0, isThinking: true, visible: true };
          this.bubbleStates.set(id, state);
        } else {
          state.isThinking = true;
          state.visible = true;
        }
        continue;
      } else if (state?.isThinking) {
        state.isThinking = false;
      }

      if (!state || !state.visible) continue;

      const startTime = entity.getValue(SpatialDialogueUI, 'displayStartTime') ?? 0;
      const dismissTimeout = entity.getValue(SpatialDialogueUI, 'dismissTimeoutMs') ?? 5000;
      const elapsed = time - startTime;

      if (elapsed > dismissTimeout + (state.words.length / this.config.wordsPerSecond.value) * 1000) {
        state.visible = false;
        continue;
      }

      // Compute active karaoke word
      const wordIdx = Math.min(
        state.words.length - 1,
        Math.floor((elapsed / 1000) * this.config.wordsPerSecond.value)
      );
      state.currentWord = wordIdx;
      entity.setValue(SpatialDialogueUI, 'activeWordIndex', wordIdx);
    }
  }
}
