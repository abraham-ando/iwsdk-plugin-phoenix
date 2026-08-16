/**
 * Dataset export (spec §9.1): turns recorded trajectories into SFT chat
 * datasets. Two products, two purposes:
 *
 * - "plans": the ACTION POLICY — the assistant target is exactly the strict
 *   JSON /agents/plan parses, so a fine-tuned model drops straight into the
 *   running simulation.
 * - "world-model": the LeCun PREDICTOR — state + action -> the REAL outcome,
 *   failures included (a surprise is the most informative sample there is).
 *
 * Pure functions only: no I/O, no clock, no randomness (the train/valid split
 * is a stride). The CLI in ../dataset-cli.ts owns the disk.
 */
export interface SftMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SftRecord {
  messages: SftMessage[];
}

export interface ExportOptions {
  /** Include records derived from the player's own words (spec §9.4). */
  includePlayerText?: boolean;
}

export const WORLD_MODEL_SYSTEM_PROMPT =
  "Tu es le modèle du monde d'un agent incarné. À partir de l'action entreprise " +
  "et du résultat qu'il anticipait, prédis le résultat RÉEL. Réponds " +
  'UNIQUEMENT en JSON: {"outcome":"completed|failed","needsDelta":{},"inventoryDelta":{}}';

/** Routing envelope written by the recorder — never part of the LLM target. */
const ROUTING_FIELDS = new Set(['requestId', 'reason', 'agentId', 'participantIds']);

function isPlayerDerived(record: Record<string, unknown>): boolean {
  const meta = record.meta as Record<string, unknown> | undefined;
  return meta?.source === 'player_text';
}

function assistantTarget(message: Record<string, unknown>): string | null {
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls)) {
    const steps: Array<Record<string, unknown>> = [];
    for (const call of toolCalls) {
      const fn = (call as { function?: { name?: unknown; arguments?: unknown } }).function;
      if (typeof fn?.name !== 'string' || typeof fn.arguments !== 'string') continue;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(fn.arguments) as Record<string, unknown>;
      } catch {
        continue;
      }
      steps.push({
        goal: args.goal,
        verb: fn.name,
        ...(args.objectId !== undefined ? { objectId: args.objectId } : {}),
        predicted: args.predicted,
      });
    }
    return steps.length === 0 ? null : JSON.stringify({ steps });
  }

  if (typeof message.content !== 'string') return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(message.content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!ROUTING_FIELDS.has(key)) stripped[key] = value;
  }
  return Object.keys(stripped).length === 0 ? null : JSON.stringify(stripped);
}

export function toChatSft(
  decisions: Array<Record<string, unknown>>,
  options: ExportOptions = {}
): SftRecord[] {
  const out: SftRecord[] = [];
  for (const decision of decisions) {
    if (!options.includePlayerText && isPlayerDerived(decision)) continue;
    const messages = decision.messages;
    if (!Array.isArray(messages) || messages.length < 3) continue;
    const [system, user, assistant] = messages as Array<Record<string, unknown>>;
    if (typeof system?.content !== 'string' || typeof user?.content !== 'string') continue;
    if (assistant === undefined) continue;
    const target = assistantTarget(assistant);
    if (target === null) continue;
    out.push({
      messages: [
        { role: 'system', content: system.content },
        { role: 'user', content: user.content },
        { role: 'assistant', content: target },
      ],
    });
  }
  return out;
}

export function toWorldModelSft(predictions: Array<Record<string, unknown>>): SftRecord[] {
  const out: SftRecord[] = [];
  for (const prediction of predictions) {
    if (typeof prediction.verb !== 'string' || typeof prediction.outcome !== 'string') continue;
    const input: Record<string, unknown> = {
      verb: prediction.verb,
      ...(typeof prediction.objectId === 'string' ? { objectId: prediction.objectId } : {}),
      predicted: typeof prediction.predicted === 'string' ? prediction.predicted : '',
    };
    const target = {
      outcome: prediction.outcome,
      needsDelta: (prediction.needsDelta as Record<string, number>) ?? {},
      inventoryDelta: (prediction.inventoryDelta as Record<string, number>) ?? {},
    };
    out.push({
      messages: [
        { role: 'system', content: WORLD_MODEL_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(input) },
        { role: 'assistant', content: JSON.stringify(target) },
      ],
    });
  }
  return out;
}

export function splitTrainValid<T>(records: T[], validRatio = 0.1): { train: T[]; valid: T[] } {
  if (validRatio <= 0) return { train: [...records], valid: [] };
  const stride = Math.max(2, Math.round(1 / validRatio));
  const train: T[] = [];
  const valid: T[] = [];
  records.forEach((record, index) => {
    if ((index + 1) % stride === 0) valid.push(record);
    else train.push(record);
  });
  return { train, valid };
}

export interface DatasetSummary {
  decisions: number;
  decisionsByReason: Record<string, number>;
  playerTextExcluded: number;
  predictions: number;
  surprises: number;
  surpriseRate: number;
}

export function datasetSummary(
  decisions: Array<Record<string, unknown>>,
  predictions: Array<Record<string, unknown>>,
  options: ExportOptions = {}
): DatasetSummary {
  const byReason: Record<string, number> = {};
  let kept = 0;
  let excluded = 0;
  for (const decision of decisions) {
    if (!options.includePlayerText && isPlayerDerived(decision)) {
      excluded++;
      continue;
    }
    kept++;
    const meta = decision.meta as Record<string, unknown> | undefined;
    const reason = typeof meta?.reason === 'string' ? meta.reason : 'unknown';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  const surprises = predictions.filter((p) => p.surprise === true).length;
  return {
    decisions: kept,
    decisionsByReason: byReason,
    playerTextExcluded: excluded,
    predictions: predictions.length,
    surprises,
    surpriseRate: predictions.length === 0 ? 0 : surprises / predictions.length,
  };
}
