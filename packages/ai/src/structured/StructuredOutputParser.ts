/**
 * Robust JSON and Tag-based Structured Output Parser.
 * Extracts function calls from LLM generations while leaving clean natural speech for TTS.
 */

import { IntentParser } from '../intents/IntentParser';

export interface StructuredCall {
  tool: string;
  args: Record<string, any>;
  rawMatch: string;
}

export interface ParsedStructuredResponse {
  cleanText: string;
  toolCalls: StructuredCall[];
  hasToolCalls: boolean;
}

export class StructuredOutputParser {
  private static readonly JSON_TOOL_REGEX = /```(?:json)?\s*(\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\})\s*```|(\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\})/gi;

  /**
   * Parse structured output from text, extracting JSON tool calls and legacy [ACTION: ...] tags.
   */
  public static parse(rawText: string): ParsedStructuredResponse {
    if (!rawText) {
      return { cleanText: '', toolCalls: [], hasToolCalls: false };
    }

    const toolCalls: StructuredCall[] = [];
    let cleanText = rawText;

    // 1. Extract JSON Tool Calls: {"tool": "name", "args": {...}}
    cleanText = cleanText.replace(this.JSON_TOOL_REGEX, (match, p1, p2) => {
      const jsonStr = p1 || p2;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.tool && typeof parsed.tool === 'string') {
          toolCalls.push({
            tool: parsed.tool,
            args: parsed.args || {},
            rawMatch: match,
          });
          return ''; // Strip from spoken text
        }
      } catch {
        // Not valid JSON, keep in text
      }
      return match;
    });

    // 2. Extract legacy Tag-based Intents: [ACTION: NAME key=val]
    const legacyParsed = IntentParser.parse(cleanText);
    for (const intent of legacyParsed.intents) {
      toolCalls.push({
        tool: intent.type.toLowerCase(),
        args: intent.params,
        rawMatch: intent.rawTag,
      });
    }

    cleanText = legacyParsed.cleanDialogue.trim();

    return {
      cleanText,
      toolCalls,
      hasToolCalls: toolCalls.length > 0,
    };
  }
}
