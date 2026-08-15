import type { ActionIntent, ActionIntentType, ParsedNPCDecision, IntentHandler } from './types';

/**
 * Regex matching [ACTION: TYPE key1=val1 key2=val2]
 */
const ACTION_TAG_REGEX = /\[ACTION:\s*([A-Z_]+)(?:\s+([^\]]+))?\]/gi;

/**
 * Parses raw LLM generation into clean spoken dialogue and structured action intents.
 */
export class IntentParser {
  /**
   * Parse a raw model text output.
   */
  public static parse(rawText: string): ParsedNPCDecision {
    const intents: ActionIntent[] = [];
    let cleanDialogue = rawText;

    let match: RegExpExecArray | null;
    while ((match = ACTION_TAG_REGEX.exec(rawText)) !== null) {
      const rawTag = match[0];
      const actionType = (match[1]?.toUpperCase() ?? 'CUSTOM') as ActionIntentType;
      const paramString = match[2] ?? '';

      const params: Record<string, string | number | boolean> = {};
      const paramRegex = /([a-zA-Z0-9_]+)=([^\s\]]+)/g;
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(paramString)) !== null) {
        const key = paramMatch[1]!;
        const rawVal = paramMatch[2]!;

        if (rawVal === 'true') {
          params[key] = true;
        } else if (rawVal === 'false') {
          params[key] = false;
        } else if (!isNaN(Number(rawVal))) {
          params[key] = Number(rawVal);
        } else {
          params[key] = rawVal.replace(/^['"]|['"]$/g, '');
        }
      }

      intents.push({
        type: actionType,
        params,
        rawTag,
      });

      cleanDialogue = cleanDialogue.replace(rawTag, '');
    }

    cleanDialogue = cleanDialogue.replace(/\s{2,}/g, ' ').trim();

    return {
      cleanDialogue,
      intents,
      rawOutput: rawText,
    };
  }
}

/**
 * Registry and dispatcher for executing gameplay callbacks based on extracted intents.
 */
export class IntentDispatcher {
  private handlers = new Map<ActionIntentType, Set<IntentHandler>>();
  private globalHandlers = new Set<IntentHandler>();

  /** Register an action intent handler */
  public on(type: ActionIntentType, handler: IntentHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  /** Register a global intent handler */
  public onAny(handler: IntentHandler): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  /** Dispatch intents to all matching registered handlers */
  public async dispatch(intents: ActionIntent[], entityId: number): Promise<void> {
    for (const intent of intents) {
      const typeHandlers = this.handlers.get(intent.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          await handler(intent, entityId);
        }
      }
      for (const globalHandler of this.globalHandlers) {
        await globalHandler(intent, entityId);
      }
    }
  }
}
