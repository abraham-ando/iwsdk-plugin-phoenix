import type { SimKernel } from '../kernel/SimKernel';
import type { AgentRuntime } from '../agents/AgentRuntime';
import type { ActionEvent } from '../agents/actions';
import type { PlanRequest } from '../agents/Mode2';
import type { WeatherMachine } from '../world/WeatherMachine';

/**
 * The dataset factory (spec §9.1): three JSONL-ready streams recorded from a
 * live simulation — VR or headless, same code. Pure observation, in-memory
 * accumulation; writing to disk/network belongs to the caller (headless.ts,
 * BFF uploader).
 *
 * - decisions: one record per answered Mode-2 call, standard tool-calling
 *   messages format, directly consumable by fine-tuning pipelines.
 * - predictions: the LeCun quadruplet — perceived state, action, PREDICTED
 *   outcome, ACTUAL outcome + surprise — the training target of a predictive
 *   world model (spec §5).
 * - episodes: the narrative journal (periodic snapshots + events + dialogue).
 */
export const EPISODE_SNAPSHOT_PERIOD = 50;

export interface TrajectoryBatch {
  decisions: Array<Record<string, unknown>>;
  predictions: Array<Record<string, unknown>>;
  episodes: Array<Record<string, unknown>>;
}

interface OpenPrediction {
  startTick: number;
  verb: string;
  objectId?: string;
  predicted: string;
  needsBefore: Record<string, number>;
  inventoryBefore: Record<string, number>;
}

function delta(
  before: Record<string, number>,
  after: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const diff = Math.round(((after[key] ?? 0) - (before[key] ?? 0)) * 100) / 100;
    if (diff !== 0) out[key] = diff;
  }
  return out;
}

export class TrajectoryRecorder {
  private decisions: Array<Record<string, unknown>> = [];
  private predictions: Array<Record<string, unknown>> = [];
  private episodes: Array<Record<string, unknown>> = [];
  private pendingRequests = new Map<string, PlanRequest>();
  private openPredictions = new Map<string, OpenPrediction>();

  constructor(
    private runtime: AgentRuntime,
    private seed: number,
    private weather?: WeatherMachine
  ) {
    this.runtime.subscribePlanRequests((request) => {
      this.pendingRequests.set(request.requestId, request);
    });
    this.runtime.subscribeEvents((event) => this.onActionEvent(event));
  }

  attachTo(kernel: SimKernel): () => void {
    return kernel.onTick((ctx) => {
      for (const external of ctx.events) {
        if (
          external.type === 'llm_plan' ||
          external.type === 'llm_dialogue' ||
          external.type === 'llm_reflection'
        ) {
          this.onLlmResponse(external.type, external.payload, ctx.tick);
        }
      }
      if (ctx.tick % EPISODE_SNAPSHOT_PERIOD === 0) {
        this.episodes.push({
          tick: ctx.tick,
          hour: Math.round(ctx.hour * 10) / 10,
          ...(this.weather ? { weather: this.weather.current } : {}),
          kind: 'snapshot',
          agents: [...this.runtime.agents.values()]
            .sort((a, b) => a.profile.id.localeCompare(b.profile.id))
            .map((a) => ({
              id: a.profile.id,
              x: Math.round(a.x * 100) / 100,
              z: Math.round(a.z * 100) / 100,
              needs: Object.fromEntries(
                Object.entries(a.needs).map(([k, v]) => [k, Math.round(v)])
              ),
              verb: a.currentAction?.verb ?? null,
            })),
        });
      }
    });
  }

  private onActionEvent(event: ActionEvent): void {
    this.episodes.push({
      tick: event.tick,
      kind: 'event',
      agentId: event.agentId,
      type: event.type,
      verb: event.verb,
      ...(event.reason !== undefined ? { reason: event.reason } : {}),
    });

    const agent = this.runtime.agents.get(event.agentId);
    if (agent === undefined) return;

    if (event.type === 'started') {
      if (event.source === 'plan') {
        this.openPredictions.set(event.agentId, {
          startTick: event.tick,
          verb: event.verb,
          objectId: event.objectId,
          predicted: event.predicted ?? '',
          needsBefore: { ...agent.needs },
          inventoryBefore: { ...agent.inventory },
        });
      } else {
        this.openPredictions.delete(event.agentId);
      }
      return;
    }

    const open = this.openPredictions.get(event.agentId);
    if (open === undefined || open.verb !== event.verb) return;
    this.openPredictions.delete(event.agentId);
    this.predictions.push({
      meta: { seed: this.seed, agentId: event.agentId },
      verb: open.verb,
      ...(open.objectId !== undefined ? { objectId: open.objectId } : {}),
      predicted: open.predicted,
      startTick: open.startTick,
      endTick: event.tick,
      outcome: event.type,
      ...(event.reason !== undefined ? { reason: event.reason } : {}),
      needsDelta: delta(open.needsBefore, agent.needs as unknown as Record<string, number>),
      inventoryDelta: delta(open.inventoryBefore, agent.inventory),
      surprise: event.type === 'failed',
    });
  }

  private onLlmResponse(type: string, payload: unknown, tick: number): void {
    const body = payload as { requestId?: string; lines?: unknown; steps?: unknown } | null;
    if (body === null || typeof body !== 'object') return;
    const request =
      typeof body.requestId === 'string' ? this.pendingRequests.get(body.requestId) : undefined;

    if (type === 'llm_dialogue' && Array.isArray(body.lines)) {
      this.episodes.push({ tick, kind: 'dialogue', lines: body.lines });
    }
    if (request === undefined) return;
    this.pendingRequests.delete(request.requestId);

    const assistant =
      type === 'llm_plan' && Array.isArray(body.steps)
        ? {
            role: 'assistant',
            tool_calls: (body.steps as Array<Record<string, unknown>>).map((s) => ({
              type: 'function',
              function: {
                name: String(s.verb ?? ''),
                arguments: JSON.stringify({
                  objectId: s.objectId,
                  goal: s.goal,
                  predicted: s.predicted,
                }),
              },
            })),
          }
        : { role: 'assistant', content: JSON.stringify(payload) };

    this.decisions.push({
      meta: {
        seed: this.seed,
        tick,
        agentId: request.agentId,
        reason: request.reason,
        requestId: request.requestId,
      },
      tools: request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.verb,
          description: t.type ?? 'intrinsic',
          parameters: { type: 'object', properties: { objectId: { type: 'string' } } },
        },
      })),
      messages: [
        {
          role: 'system',
          content: `Tu es ${request.persona} (${request.role}, tribu ${request.tribe}).`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            needs: request.needs,
            hour: request.hour,
            place: request.place,
            beliefs: request.beliefs,
            memories: request.memories,
            currentPlan: request.currentPlan,
          }),
        },
        assistant,
      ],
    });
  }

  drain(): TrajectoryBatch {
    const batch: TrajectoryBatch = {
      decisions: this.decisions,
      predictions: this.predictions,
      episodes: this.episodes,
    };
    this.decisions = [];
    this.predictions = [];
    this.episodes = [];
    return batch;
  }

  static toJsonl(records: Array<Record<string, unknown>>): string {
    if (records.length === 0) return '';
    return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }
}
