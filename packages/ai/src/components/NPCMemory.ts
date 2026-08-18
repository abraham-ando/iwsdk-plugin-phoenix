import { Types, createComponent } from '@iwsdk/core';

export interface DialogueTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** Build the composite storage key for an entity + optional player session. */
function memoryKey(entityId: number, playerId?: string): string {
  return playerId ? `${entityId}:${playerId}` : `${entityId}`;
}

/**
 * Owns the conversational memory for every NPC of one plugin installation
 * (one `installCardinalAI()` call / one `World`). Conversation histories are
 * keyed by a composite `entityId` + `playerId` session key, giving each
 * player's turns with an NPC their own isolated bucket.
 *
 * `playerId` is optional and defaults to a shared per-entity bucket for
 * backward compatibility (e.g. NPC-to-NPC banter, which has no player on
 * either side). Whenever a `playerId` is supplied — the normal case for a
 * player talking to an NPC — its turns are isolated in their own bucket so
 * one player's conversation is never replayed into another player's session
 * with the same NPC.
 *
 * This class replaces what used to be a `Map` global to the module: that
 * design let two `installCardinalAI()` installations in two different
 * `World`s (e.g. two game sessions in the same JS bundle/process) silently
 * share and leak each other's dialogue history. A store is now instantiated
 * once per installation and owns its own private `Map` — nothing is shared
 * across instances, and the whole store can be released in one call
 * (`dispose()`) or purged for a single entity (`clearEntity()`) when that
 * entity is destroyed.
 */
export class NPCMemoryStore {
  private readonly entityMemoryStore = new Map<string, DialogueTurn[]>();

  /** Append a dialogue turn to an entity's conversation memory. */
  addDialogueTurn(entityId: number, turn: DialogueTurn, maxTurns = 4, playerId?: string): void {
    const key = memoryKey(entityId, playerId);
    const history = this.entityMemoryStore.get(key) ?? [];
    history.push(turn);
    if (history.length > maxTurns * 2) {
      history.splice(0, history.length - maxTurns * 2);
    }
    this.entityMemoryStore.set(key, history);
  }

  /** Get the conversation history for an entity, optionally scoped to a player session. */
  getDialogueHistory(entityId: number, playerId?: string): DialogueTurn[] {
    return this.entityMemoryStore.get(memoryKey(entityId, playerId)) ?? [];
  }

  /** Clear the conversation history for an entity, optionally scoped to a player session. */
  clearDialogueHistory(entityId: number, playerId?: string): void {
    this.entityMemoryStore.delete(memoryKey(entityId, playerId));
  }

  /**
   * Purge every session bucket belonging to one entity — the legacy shared
   * bucket and every per-player bucket — in a single call, regardless of
   * which `playerId`s were ever used with it. Used when the entity itself is
   * destroyed, at which point no single `playerId` is known.
   */
  clearEntity(entityId: number): void {
    const exactKey = `${entityId}`;
    const prefixedKey = `${entityId}:`;
    for (const key of this.entityMemoryStore.keys()) {
      if (key === exactKey || key.startsWith(prefixedKey)) {
        this.entityMemoryStore.delete(key);
      }
    }
  }

  /** Release every stored history. Used when the owning plugin installation is disposed. */
  dispose(): void {
    this.entityMemoryStore.clear();
  }
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
