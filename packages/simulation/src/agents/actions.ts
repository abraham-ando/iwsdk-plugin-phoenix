import type { AgentState } from './AgentState';
import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import { checkAffordance, applyAffordance } from '../world/affordances';
import { checkIntrinsic, applyIntrinsic, type IntrinsicActionDef } from './intrinsics';
import { stepToward } from './navigation';

export interface ActionEvent {
  tick: number;
  agentId: string;
  type: 'started' | 'completed' | 'failed';
  verb: string;
  reason?: string;
}

const RESTFUL_VERBS = new Set(['rest_nearby', 'sleep_inside', 'nap']);

/**
 * Advances the agent's current action by one tick (spec §6.4). Plans are made
 * on beliefs; execution confronts ground truth — a mismatch is a surprise:
 * the action fails and the stale belief is dropped.
 */
export function executeActionTick(
  agent: AgentState,
  world: GroundTruthWorld,
  intrinsics: IntrinsicActionDef[],
  tick: number
): ActionEvent | null {
  const action = agent.currentAction;
  agent.sleeping = false;
  if (action === null) return null;
  const agentId = agent.profile.id;

  if (action.kind === 'intrinsic') {
    agent.sleeping = RESTFUL_VERBS.has(action.verb);
    action.remainingTicks--;
    if (action.remainingTicks > 0) return null;
    agent.currentAction = null;
    const def = intrinsics.find((i) => i.verb === action.verb);
    if (def === undefined) {
      return { tick, agentId, type: 'failed', verb: action.verb, reason: 'unknown intrinsic' };
    }
    const check = checkIntrinsic(def, agent.inventory);
    if (!check.ok) {
      return { tick, agentId, type: 'failed', verb: action.verb, reason: check.reason };
    }
    applyIntrinsic(def, agent.inventory, agent.needs as unknown as Record<string, number>);
    agent.sleeping = false;
    return { tick, agentId, type: 'completed', verb: action.verb };
  }

  if (action.phase === 'goto') {
    const before = { x: agent.x, z: agent.z };
    const arrived = stepToward(agent, { x: action.targetX, z: action.targetZ });
    if (agent.x !== before.x || agent.z !== before.z) {
      agent.heading = Math.atan2(agent.x - before.x, agent.z - before.z);
    }
    if (!arrived) return null;
    const real = world.get(action.objectId);
    if (real === undefined) {
      agent.beliefs.forget(action.objectId);
      agent.currentAction = null;
      return { tick, agentId, type: 'failed', verb: action.verb, reason: 'object gone' };
    }
    const def = world.affordancesOf(real.type).find((a) => a.verb === action.verb);
    if (def === undefined) {
      agent.currentAction = null;
      return { tick, agentId, type: 'failed', verb: action.verb, reason: 'unknown affordance' };
    }
    action.phase = 'perform';
    action.remainingTicks = def.durationTicks;
    agent.sleeping = RESTFUL_VERBS.has(action.verb);
    return null;
  }

  // phase === 'perform'
  agent.sleeping = RESTFUL_VERBS.has(action.verb);
  action.remainingTicks--;
  if (action.remainingTicks > 0) return null;
  agent.currentAction = null;
  agent.sleeping = false;
  const real = world.get(action.objectId);
  if (real === undefined) {
    agent.beliefs.forget(action.objectId);
    return { tick, agentId, type: 'failed', verb: action.verb, reason: 'object gone' };
  }
  const def = world.affordancesOf(real.type).find((a) => a.verb === action.verb);
  if (def === undefined) {
    return { tick, agentId, type: 'failed', verb: action.verb, reason: 'unknown affordance' };
  }
  const actor = {
    x: agent.x,
    z: agent.z,
    inventory: agent.inventory,
    needs: agent.needs as unknown as Record<string, number>,
  };
  const check = checkAffordance(def, real, actor);
  if (!check.ok) {
    // Reality disagreed with the plan: drop the stale belief (surprise).
    agent.beliefs.forget(action.objectId);
    return { tick, agentId, type: 'failed', verb: action.verb, reason: check.reason };
  }
  applyAffordance(def, real, actor);
  return { tick, agentId, type: 'completed', verb: action.verb };
}
