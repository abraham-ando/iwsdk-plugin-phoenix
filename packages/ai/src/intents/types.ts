/**
 * Types and schema for structured NPC action intents extracted from LLM generation.
 */

export type ActionIntentType =
  | 'GIVE_ITEM'
  | 'TAKE_ITEM'
  | 'ATTACK'
  | 'FLEE'
  | 'EMOTE'
  | 'SET_QUEST_STAGE'
  | 'CHANGE_EMOTION'
  | 'CUSTOM'
  // The parser emits whatever uppercase action name the model produced, and
  // IntentGuard role policies name game-specific actions (SELL_ITEM, OPEN_GATE…):
  // keep literal autocompletion but accept any action string.
  | (string & {});

export interface ActionIntent {
  type: ActionIntentType;
  params: Record<string, string | number | boolean>;
  rawTag: string;
}

export interface ParsedNPCDecision {
  /** Cleaned dialogue speech for the player */
  cleanDialogue: string;
  /** List of parsed structured game action intents */
  intents: ActionIntent[];
  /** Raw unprocessed model output */
  rawOutput: string;
}

export type IntentHandler = (intent: ActionIntent, entityId: number) => void | Promise<void>;
