import { describe, it, expect } from 'vitest';
import {
  toChatSft,
  toWorldModelSft,
  splitTrainValid,
  datasetSummary,
  WORLD_MODEL_SYSTEM_PROMPT,
} from '../src/telemetry/datasetExport';

function planDecision(): Record<string, unknown> {
  return {
    meta: { seed: 5, tick: 100, agentId: 'mira', reason: 'dawn', requestId: 'mira:100:dawn' },
    tools: [
      {
        type: 'function',
        function: { name: 'gather_berries', description: 'berry_bush', parameters: {} },
      },
    ],
    messages: [
      { role: 'system', content: 'Tu es Douce et prévoyante (Cueilleuse, tribu Aube).' },
      { role: 'user', content: '{"needs":{"hunger":20},"hour":6,"place":"camp_aube"}' },
      {
        role: 'assistant',
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'gather_berries',
              arguments: '{"objectId":"berry_bush_1","goal":"cueillir","predicted":"+2 baies"}',
            },
          },
        ],
      },
    ],
  };
}

function reflectionDecision(): Record<string, unknown> {
  return {
    meta: { seed: 5, tick: 2100, agentId: 'kan', reason: 'reflection', requestId: 'kan:2100:r' },
    tools: [],
    messages: [
      { role: 'system', content: 'Tu es Solitaire fier (Guerrier, tribu Rive).' },
      { role: 'user', content: '{"needs":{"hunger":60}}' },
      {
        role: 'assistant',
        // The recorder stores the whole payload, routing fields included.
        content:
          '{"requestId":"kan:2100:r","reason":"reflection","agentId":"kan","insights":["La rivière nord s\'épuise"]}',
      },
    ],
  };
}

function playerDecision(): Record<string, unknown> {
  return {
    meta: {
      seed: 5,
      tick: 300,
      agentId: 'mira',
      reason: 'player_dialogue',
      requestId: 'mira:300:p',
      source: 'player_text',
    },
    tools: [],
    messages: [
      { role: 'system', content: 'Tu es Douce et prévoyante (Cueilleuse, tribu Aube).' },
      { role: 'user', content: '{"playerText":"Bonjour !"}' },
      {
        role: 'assistant',
        content:
          '{"requestId":"mira:300:p","reason":"player_dialogue","agentId":"mira","reply":"Bienvenue, étranger."}',
      },
    ],
  };
}

function prediction(outcome: 'completed' | 'failed'): Record<string, unknown> {
  return {
    meta: { seed: 5, agentId: 'kan' },
    verb: 'gather_berries',
    objectId: 'berry_bush_8',
    predicted: 'réussite de gather_berries',
    startTick: 485,
    endTick: 603,
    outcome,
    needsDelta: { hunger: -3.24 },
    inventoryDelta: outcome === 'completed' ? { berries: 2 } : {},
    surprise: outcome === 'failed',
  };
}

describe('toChatSft', () => {
  it('turns tool_calls into the strict JSON the BFF parses', () => {
    const [record] = toChatSft([planDecision()]);
    expect(record?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(record?.messages[0]?.content).toContain('Douce et prévoyante');
    const target = JSON.parse(record!.messages[2]!.content) as {
      steps: Array<Record<string, unknown>>;
    };
    expect(target.steps).toEqual([
      {
        goal: 'cueillir',
        verb: 'gather_berries',
        objectId: 'berry_bush_1',
        predicted: '+2 baies',
      },
    ]);
  });

  it('strips routing fields from content-style answers', () => {
    const [record] = toChatSft([reflectionDecision()]);
    const target = JSON.parse(record!.messages[2]!.content) as Record<string, unknown>;
    expect(target).toEqual({ insights: ["La rivière nord s'épuise"] });
    expect(target).not.toHaveProperty('requestId');
  });

  it('excludes player-derived records by default and includes them on request', () => {
    const decisions = [planDecision(), playerDecision()];
    expect(toChatSft(decisions)).toHaveLength(1);
    expect(toChatSft(decisions, { includePlayerText: true })).toHaveLength(2);
  });

  it('drops malformed records instead of throwing', () => {
    expect(toChatSft([{}, { messages: 'nope' }, { messages: [] }])).toEqual([]);
  });
});

describe('toWorldModelSft', () => {
  it('maps state+action to the REAL outcome (LeCun target)', () => {
    const [record] = toWorldModelSft([prediction('completed')]);
    expect(record?.messages[0]?.content).toBe(WORLD_MODEL_SYSTEM_PROMPT);
    const input = JSON.parse(record!.messages[1]!.content) as Record<string, unknown>;
    expect(input).toEqual({
      verb: 'gather_berries',
      objectId: 'berry_bush_8',
      predicted: 'réussite de gather_berries',
    });
    const target = JSON.parse(record!.messages[2]!.content) as Record<string, unknown>;
    expect(target).toEqual({
      outcome: 'completed',
      needsDelta: { hunger: -3.24 },
      inventoryDelta: { berries: 2 },
    });
  });

  it('keeps failures — surprises are the most informative samples', () => {
    expect(toWorldModelSft([prediction('failed')])).toHaveLength(1);
  });

  it('drops malformed records instead of throwing', () => {
    expect(toWorldModelSft([{}, { verb: 42 }])).toEqual([]);
  });
});

describe('splitTrainValid', () => {
  it('is a deterministic stride split', () => {
    const records = Array.from({ length: 20 }, (_, i) => i);
    const { train, valid } = splitTrainValid(records, 0.1);
    expect(valid).toEqual([9, 19]);
    expect(train).toHaveLength(18);
    expect(splitTrainValid(records, 0.1)).toEqual({ train, valid });
  });

  it('puts everything in train when the ratio is zero', () => {
    expect(splitTrainValid([1, 2, 3], 0).valid).toEqual([]);
  });
});

describe('datasetSummary', () => {
  it('counts decisions by reason, exclusions and surprise rate', () => {
    const summary = datasetSummary(
      [planDecision(), reflectionDecision(), playerDecision()],
      [prediction('completed'), prediction('failed')]
    );
    expect(summary.decisions).toBe(2); // player_text excluded by default
    expect(summary.playerTextExcluded).toBe(1);
    expect(summary.decisionsByReason).toEqual({ dawn: 1, reflection: 1 });
    expect(summary.predictions).toBe(2);
    expect(summary.surprises).toBe(1);
    expect(summary.surpriseRate).toBeCloseTo(0.5);
  });
});
