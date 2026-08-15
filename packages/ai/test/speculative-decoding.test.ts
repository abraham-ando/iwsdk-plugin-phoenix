import { describe, it, expect } from 'vitest';
import { SpeculativeDecodingEngine } from '../src/speculative/SpeculativeDecodingEngine';

describe('SpeculativeDecodingEngine', () => {
  it('should accept draft tokens above threshold and reject below', () => {
    const engine = new SpeculativeDecodingEngine({
      targetModelId: 'llama-3.2-3b-it',
      draftModelId: 'smollm2-135m-it',
      draftSteps: 4,
      acceptanceThreshold: 0.75,
    });

    const draftTokens = ['Bonjour', 'noble', 'voyageur', 'bienvenue'];
    const probs = [0.95, 0.88, 0.50, 0.99]; // 3rd token below 0.75

    const evalResult = engine.evaluateDraftBatch(draftTokens, probs);

    expect(evalResult.accepted).toEqual(['Bonjour', 'noble']);
    expect(evalResult.rejectedIndex).toBe(2);
  });

  it('should calculate speedup and acceptance telemetry', () => {
    const engine = new SpeculativeDecodingEngine({
      targetModelId: 'llama-3.2-3b-it',
      draftModelId: 'smollm2-135m-it',
      draftSteps: 4,
      acceptanceThreshold: 0.75,
    });

    const telemetry = engine.calculateTelemetry(15, 20, 'Bonjour noble voyageur, que puis-je faire pour vous ?');

    expect(telemetry.acceptanceRate).toBe(0.75);
    expect(telemetry.estimatedSpeedup).toBeGreaterThan(1.5);
    expect(telemetry.tokensAccepted).toBe(15);
    expect(telemetry.tokensDrafted).toBe(20);
  });
});
