import { Types, createComponent } from '@iwsdk/core';

export interface DialogueTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * Global map storing conversation histories keyed by entity network/internal ID.
 * Keeps individual typed array storage clean while providing sliding ring buffer memory.
 */
const entityMemoryStore = new Map<number, DialogueTurn[]>();

/**
 * ECS component giving an NPC a sliding conversational memory buffer.
 */
export const NPCMemory = createComponent(
  'NPCMemory',
  {
    /** Maximum number of previous dialogue turns kept in memory */
    maxHistoryTurns: { type: Types.Int32, default: 4 },
    /** Monotonically increasing interaction counter */
    totalInteractions: { type: Types.Int32, default: 0 },
    /** `performance.now()` timestamp of the last remembered interaction */
    lastInteractionTime: { type: Types.Float64, default: 0 },
  },
  'Sliding episodic conversational memory for NPCs',
);

/** Append a dialogue turn to an entity's conversation memory */
export function addDialogueTurn(entityId: number, turn: DialogueTurn, maxTurns = 4): void {
  const history = entityMemoryStore.get(entityId) ?? [];
  history.push(turn);
  if (history.length > maxTurns * 2) {
    history.splice(0, history.length - maxTurns * 2);
  }
  entityMemoryStore.set(entityId, history);
}

/** Get the conversation history for an entity */
export function getDialogueHistory(entityId: number): DialogueTurn[] {
  return entityMemoryStore.get(entityId) ?? [];
}

/** Clear the conversation history for an entity */
export function clearDialogueHistory(entityId: number): void {
  entityMemoryStore.delete(entityId);
}
