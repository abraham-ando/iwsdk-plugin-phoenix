import type { AgentState, PlannedStep } from './AgentState';
import type { SmartObjectRegistry } from '../world/SmartObject';
import type { IntrinsicActionDef } from './intrinsics';
import { hourOfDay } from '../kernel/SimKernel';

export type { PlannedStep } from './AgentState';

/**
 * Mode-2 deliberation contract (spec §7.2): requests are built from the
 * agent's OWN state (beliefs, memories, needs — never ground truth) and are
 * plain JSON. Responses come back through the kernel's external-event journal,
 * validated here before touching the agent.
 */
export type PlanRequestReason = 'dawn' | 'surprise' | 'dialogue' | 'reflection' | 'player_dialogue';

export interface PlanToolCandidate {
  verb: string;
  objectId?: string;
  type?: string;
  distance?: number;
}

export interface PlanRequest {
  requestId: string;
  reason: PlanRequestReason;
  agentId: string;
  participantIds?: string[];
  tick: number;
  hour: number;
  persona: string;
  role: string;
  tribe: string;
  needs: Record<string, number>;
  place: string | null;
  beliefs: Array<{ objectId: string; type: string; distance: number; state: Record<string, number> }>;
  memories: string[];
  tools: PlanToolCandidate[];
  currentPlan: string[];
  /** The player's utterance, for reason 'player_dialogue' (spec §10.5). */
  playerText?: string;
}

const MAX_BELIEFS = 12;
const MAX_MEMORIES = 6;
const MAX_STEPS = 5;

export function buildPlanRequest(
  agent: AgentState,
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[],
  tick: number,
  reason: PlanRequestReason,
  place: string | null,
  participantIds?: string[],
  playerText?: string
): PlanRequest {
  const beliefs = agent.beliefs
    .known()
    .map((b) => ({
      objectId: b.objectId,
      type: b.type,
      distance: Math.round(Math.hypot(b.x - agent.x, b.z - agent.z) * 10) / 10,
      state: { ...b.state },
    }))
    .sort((a, b) => a.distance - b.distance || a.objectId.localeCompare(b.objectId))
    .slice(0, MAX_BELIEFS);

  const tools: PlanToolCandidate[] = [];
  for (const belief of beliefs) {
    if (!registry.has(belief.type)) continue;
    for (const aff of registry.get(belief.type).affordances) {
      tools.push({
        verb: aff.verb,
        objectId: belief.objectId,
        type: belief.type,
        distance: belief.distance,
      });
    }
  }
  for (const intrinsic of intrinsics) {
    tools.push({ verb: intrinsic.verb });
  }

  const memoryQuery = reason === 'dawn' ? '' : reason;
  return {
    requestId: `${agent.profile.id}:${tick}:${reason}`,
    reason,
    agentId: agent.profile.id,
    ...(participantIds !== undefined ? { participantIds } : {}),
    tick,
    hour: hourOfDay(tick),
    persona: agent.profile.persona ?? '',
    role: agent.profile.role,
    tribe: agent.profile.tribe,
    needs: { ...agent.needs },
    place,
    beliefs,
    memories: agent.memories.retrieve(memoryQuery, tick, MAX_MEMORIES).map((m) => m.text),
    tools,
    currentPlan: agent.plan.map((s) => `${s.verb}${s.objectId ? ` (${s.objectId})` : ''}`),
    ...(playerText !== undefined ? { playerText } : {}),
  };
}

export function parsePlanSteps(
  payload: unknown,
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[],
  agent: AgentState
): PlannedStep[] {
  if (payload === null || typeof payload !== 'object') return [];
  const steps = (payload as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];

  const intrinsicVerbs = new Set(intrinsics.map((i) => i.verb));
  const worldVerbs = new Set<string>();
  for (const type of registry.types()) {
    for (const aff of registry.get(type).affordances) worldVerbs.add(aff.verb);
  }

  const valid: PlannedStep[] = [];
  for (const raw of steps) {
    if (valid.length >= MAX_STEPS) break;
    if (raw === null || typeof raw !== 'object') continue;
    const step = raw as Partial<PlannedStep>;
    if (typeof step.verb !== 'string') continue;
    const goal = typeof step.goal === 'string' ? step.goal : step.verb;
    const predicted = typeof step.predicted === 'string' ? step.predicted : '';

    if (intrinsicVerbs.has(step.verb)) {
      valid.push({ goal, verb: step.verb, predicted });
      continue;
    }
    if (worldVerbs.has(step.verb)) {
      if (typeof step.objectId !== 'string') continue;
      if (agent.beliefs.get(step.objectId) === undefined) continue;
      valid.push({ goal, verb: step.verb, objectId: step.objectId, predicted });
    }
  }
  return valid;
}
