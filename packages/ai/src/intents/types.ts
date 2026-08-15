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
  | 'CUSTOM';

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
