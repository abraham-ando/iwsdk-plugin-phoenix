import type { AgentState, CurrentAction } from './AgentState';
import type { Belief } from './BeliefState';
import { urgency, type AgentNeeds, type NeedId } from './needs';
import { checkIntrinsic, type IntrinsicActionDef } from './intrinsics';
import { compare } from '../world/affordances';
import type { AffordanceDef, SmartObjectRegistry } from '../world/SmartObject';
import { WALK_SPEED } from './navigation';

/**
 * Mode-1 reactive policy (spec §7.1): utility scoring over BELIEVED
 * affordances + intrinsic actions. A blocked candidate is replaced by its
 * provider (missing inventory item -> gathering affordance that yields it;
 * insufficient object state -> affordance on the same object raising it),
 * damped 0.7 per level, depth <= 3 — enough to chain
 * cold -> rest_nearby -> light_fire -> gather_wood without any LLM.
 */
const DAMPING = 0.7;
const MAX_DEPTH = 3;
const MIN_SCORE = 0.001;
const TICKS_PER_METER = 1 / (WALK_SPEED * 0.1);

interface Candidate {
  action: CurrentAction;
  score: number;
  key: string;
}

function needGain(effects: Record<string, number> | undefined, needs: AgentNeeds): number {
  if (effects === undefined) return 0;
  let gain = 0;
  for (const [need, delta] of Object.entries(effects)) {
    const id = need as NeedId;
    if (!(id in needs)) continue;
    const u = urgency(needs, id);
    if (id === 'stress') {
      if (delta < 0) gain += (-delta / 100) * u;
    } else if (delta > 0) {
      gain += (delta / 100) * u;
    }
  }
  return gain;
}

function timePenalty(travelTicks: number, durationTicks: number): number {
  return 1 + (travelTicks + durationTicks) / 100;
}

export function selectAction(
  agent: AgentState,
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[]
): CurrentAction | null {
  const beliefs = agent.beliefs.known();
  const candidates: Candidate[] = [];

  for (const def of intrinsics) {
    scoreIntrinsic(def, agent, beliefs, registry, intrinsics, 0, new Set(), candidates);
  }
  for (const belief of beliefs) {
    for (const def of affordancesFor(registry, belief.type)) {
      scoreWorld(def, belief, agent, beliefs, registry, intrinsics, 0, new Set(), candidates);
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const best = candidates[0];
  return best !== undefined && best.score > MIN_SCORE ? best.action : null;
}

function affordancesFor(registry: SmartObjectRegistry, type: string): AffordanceDef[] {
  return registry.has(type) ? registry.get(type).affordances : [];
}

function scoreIntrinsic(
  def: IntrinsicActionDef,
  agent: AgentState,
  beliefs: Belief[],
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[],
  depth: number,
  visited: Set<string>,
  out: Candidate[]
): void {
  const key = `intrinsic|${def.verb}`;
  if (visited.has(key) || depth > MAX_DEPTH) return;
  visited.add(key);

  const gain = needGain(def.effects.actorNeeds, agent.needs) * DAMPING ** depth;
  if (gain <= 0) return;
  const score = gain / timePenalty(0, def.durationTicks);

  const check = checkIntrinsic(def, agent.inventory);
  if (check.ok) {
    out.push({
      action: { kind: 'intrinsic', verb: def.verb, remainingTicks: def.durationTicks },
      score,
      key,
    });
    return;
  }
  // Blocked on inventory: chain to providers of the missing items.
  chainInventoryProviders(def.preconditions?.actorInventory, score, agent, beliefs, registry, intrinsics, depth, visited, out);
}

function scoreWorld(
  def: AffordanceDef,
  belief: Belief,
  agent: AgentState,
  beliefs: Belief[],
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[],
  depth: number,
  visited: Set<string>,
  out: Candidate[],
  inheritedGain = 0
): void {
  const key = `world|${def.verb}|${belief.objectId}`;
  if (visited.has(key) || depth > MAX_DEPTH) return;
  visited.add(key);

  const ownGain = needGain(def.effects.actorNeeds, agent.needs);
  const gain = (ownGain + inheritedGain) * DAMPING ** depth;
  if (gain <= 0) return;
  const travel = Math.hypot(belief.x - agent.x, belief.z - agent.z) * TICKS_PER_METER;
  const score = gain / timePenalty(travel, def.durationTicks);

  // Object-state preconditions checked against BELIEFS.
  for (const [field, expr] of Object.entries(def.preconditions?.objectState ?? {})) {
    if (!compare(belief.state[field] ?? 0, expr)) {
      // Blocked: chain to an affordance on the same object that raises the field.
      for (const other of affordancesFor(registry, belief.type)) {
        if (other.verb !== def.verb && (other.effects.object?.[field] ?? 0) > 0) {
          scoreWorld(other, belief, agent, beliefs, registry, intrinsics, depth + 1, visited, out, gain);
        }
      }
      return;
    }
  }

  // Inventory preconditions checked against the REAL inventory.
  for (const [item, expr] of Object.entries(def.preconditions?.actorInventory ?? {})) {
    if (!compare(agent.inventory[item] ?? 0, expr)) {
      chainInventoryProviders({ [item]: expr }, score, agent, beliefs, registry, intrinsics, depth, visited, out);
      return;
    }
  }

  out.push({
    action: {
      kind: 'world',
      objectId: belief.objectId,
      verb: def.verb,
      phase: 'goto',
      targetX: belief.x,
      targetZ: belief.z,
      remainingTicks: 0,
    },
    score,
    key,
  });
}

function chainInventoryProviders(
  missing: Record<string, string> | undefined,
  blockedScore: number,
  agent: AgentState,
  beliefs: Belief[],
  registry: SmartObjectRegistry,
  intrinsics: IntrinsicActionDef[],
  depth: number,
  visited: Set<string>,
  out: Candidate[]
): void {
  if (missing === undefined) return;
  for (const [item, expr] of Object.entries(missing)) {
    if (compare(agent.inventory[item] ?? 0, expr)) continue;
    for (const belief of beliefs) {
      for (const provider of affordancesFor(registry, belief.type)) {
        if ((provider.effects.actorInventory?.[item] ?? 0) > 0) {
          // The provider inherits the blocked candidate's motivation.
          const key = `world|${provider.verb}|${belief.objectId}`;
          if (visited.has(key) || depth + 1 > MAX_DEPTH) continue;
          visited.add(key);
          let ok = true;
          for (const [field, fieldExpr] of Object.entries(provider.preconditions?.objectState ?? {})) {
            if (!compare(belief.state[field] ?? 0, fieldExpr)) ok = false;
          }
          for (const [invItem, invExpr] of Object.entries(provider.preconditions?.actorInventory ?? {})) {
            if (!compare(agent.inventory[invItem] ?? 0, invExpr)) ok = false;
          }
          if (!ok) continue;
          const travel = Math.hypot(belief.x - agent.x, belief.z - agent.z) * TICKS_PER_METER;
          out.push({
            action: {
              kind: 'world',
              objectId: belief.objectId,
              verb: provider.verb,
              phase: 'goto',
              targetX: belief.x,
              targetZ: belief.z,
              remainingTicks: 0,
            },
            score: (blockedScore * DAMPING) / timePenalty(travel, provider.durationTicks),
            key,
          });
        }
      }
    }
  }
}
