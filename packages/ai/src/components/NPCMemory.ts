import { Types, createComponent } from '@iwsdk/core';

export interface DialogueTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * Global map storing conversation histories keyed by a composite
 * `entityId` + `playerId` session key. Keeps individual typed array storage
 * clean while providing sliding ring buffer memory.
 *
 * `playerId` is optional and defaults to a shared per-entity bucket for
 * backward compatibility (e.g. NPC-to-NPC banter, which has no player on
 * either side). Whenever a `playerId` is supplied — the normal case for a
 * player talking to an NPC — its turns are isolated in their own bucket so
 * one player's conversation is never replayed into another player's session
 * with the same NPC.
 */
const entityMemoryStore = new Map<string, DialogueTurn[]>();

/** Build the composite storage key for an entity + optional player session. */
function memoryKey(entityId: number, playerId?: string): string {
  return playerId ? `${entityId}:${playerId}` : `${entityId}`;
}

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

/**
 * Append a dialogue turn to an entity's conversation memory.
 * Pass `playerId` to scope the turn to that player's session with the NPC;
 * omitted, it falls back to the legacy shared-per-entity bucket.
 */
export function addDialogueTurn(entityId: number, turn: DialogueTurn, maxTurns = 4, playerId?: string): void {
  const key = memoryKey(entityId, playerId);
  const history = entityMemoryStore.get(key) ?? [];
  history.push(turn);
  if (history.length > maxTurns * 2) {
    history.splice(0, history.length - maxTurns * 2);
  }
  entityMemoryStore.set(key, history);
}

/** Get the conversation history for an entity, optionally scoped to a player session */
export function getDialogueHistory(entityId: number, playerId?: string): DialogueTurn[] {
  return entityMemoryStore.get(memoryKey(entityId, playerId)) ?? [];
}

/** Clear the conversation history for an entity, optionally scoped to a player session */
export function clearDialogueHistory(entityId: number, playerId?: string): void {
  entityMemoryStore.delete(memoryKey(entityId, playerId));
}
