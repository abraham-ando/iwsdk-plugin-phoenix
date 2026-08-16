import { describe, it, expect } from 'vitest';
import { StructuredOutputParser } from '../src/structured/StructuredOutputParser';
import { FunctionCallingSchema } from '../src/structured/FunctionCallingSchema';

describe('StructuredOutputParser & FunctionCallingSchema', () => {
  it('should parse JSON tool calls and clean spoken text', () => {
    const raw = 'Prenez cette fiole de santé avec vous. {"tool": "give_item", "args": {"itemId": "potion_01", "quantity": 1}} Que la lumière vous guide.';
    const result = StructuredOutputParser.parse(raw);

    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.tool).toBe('give_item');
    expect(result.toolCalls[0]?.args).toEqual({ itemId: 'potion_01', quantity: 1 });
    expect(result.cleanText.replace(/\s+/g, ' ')).toBe('Prenez cette fiole de santé avec vous. Que la lumière vous guide.');
  });

  it('should parse legacy tag-based actions and unify format', () => {
    const raw = 'Halte là ! [ACTION: ATTACK target=player weapon=sword] Défendez-vous !';
    const result = StructuredOutputParser.parse(raw);

    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.tool).toBe('attack');
    expect(result.toolCalls[0]?.args).toEqual({ target: 'player', weapon: 'sword' });
    expect(result.cleanText.replace(/\s+/g, ' ')).toBe('Halte là ! Défendez-vous !');
  });

  it('should format tool definitions into system prompt instructions', () => {
    const prompt = FunctionCallingSchema.formatToolsForSystemPrompt([
      FunctionCallingSchema.STANDARD_TOOLS.GIVE_ITEM,
      FunctionCallingSchema.STANDARD_TOOLS.PLAY_EMOTE,
    ]);

    expect(prompt).toContain('[OUTILS DISPONIBLES]');
    expect(prompt).toContain('give_item');
    expect(prompt).toContain('play_emote');
  });
});
