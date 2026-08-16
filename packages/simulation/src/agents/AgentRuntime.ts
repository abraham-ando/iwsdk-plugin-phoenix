import { SimKernel, type TickContext } from '../kernel/SimKernel';
import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import type { SmartObjectRegistry } from '../world/SmartObject';
import { getTerrainHeight } from '../world/terrain';
import { createAgent, type AgentProfile, type AgentState } from './AgentState';
import { decayNeeds } from './needs';
import { perceive, type PerceivedAgent } from './Perception';
import { executeActionTick, type ActionEvent } from './actions';
import { selectAction } from './Mode1';
import { defaultIntrinsics, type IntrinsicActionDef } from './intrinsics';

export interface AgentView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  animation: 'idle' | 'walk' | 'gather' | 'craft' | 'rest' | 'sleep';
  verb: string | null;
  dialogue: string | null;
}

const PERCEPTION_PERIOD = 10; // ticks (1 s simulated, spec §6.1)
const FIRE_WARMTH_RADIUS = 3;

const GATHER_VERBS = /^(gather_|eat_|fish$)/;
const CRAFT_VERBS = /^(light_fire|add_wood|build|knap_flint|deposit_|take_)/;

/**
 * Orchestrates embodied agents on kernel ticks (spec §6, §7.1): decay ->
 * perceive -> execute -> select. Deterministic: agents iterate in sorted id
 * order; Mode-1 is pure; the only randomness is the kernel's seeded rng
 * (unused here, reserved for étape 3+).
 */
export class AgentRuntime {
  readonly agents = new Map<string, AgentState>();
  private events: ActionEvent[] = [];
  private intrinsics: IntrinsicActionDef[];

  constructor(
    private world: GroundTruthWorld,
    private registry: SmartObjectRegistry,
    intrinsics?: IntrinsicActionDef[]
  ) {
    this.intrinsics = intrinsics ?? defaultIntrinsics();
  }

  addAgent(profile: AgentProfile, x: number, z: number): AgentState {
    if (this.agents.has(profile.id)) {
      throw new Error(`AgentRuntime.addAgent: duplicate id ${profile.id}`);
    }
    const agent = createAgent(profile, x, z);
    this.agents.set(profile.id, agent);
    return agent;
  }

  attachTo(kernel: SimKernel): () => void {
    return kernel.onTick((ctx) => this.tickAll(ctx));
  }

  private sortedAgents(): AgentState[] {
    return [...this.agents.values()].sort((a, b) => a.profile.id.localeCompare(b.profile.id));
  }

  private tickAll(ctx: TickContext): void {
    const roster = this.sortedAgents();
    for (const agent of roster) {
      this.tickAgent(agent, ctx, roster);
    }
  }

  private tickAgent(agent: AgentState, ctx: TickContext, roster: AgentState[]): void {
    const nearLitFire = this.world
      .objectsNear(agent.x, agent.z, FIRE_WARMTH_RADIUS)
      .some((o) => o.type === 'campfire' && (o.state.lit ?? 0) === 1);
    decayNeeds(agent.needs, {
      hour: ctx.hour,
      isMoving: agent.currentAction?.kind === 'world' && agent.currentAction.phase === 'goto',
      nearLitFire,
      isSleeping: agent.sleeping,
    });

    if (ctx.tick % PERCEPTION_PERIOD === 0) {
      const others: PerceivedAgent[] = roster
        .filter((o) => o !== agent)
        .map((o) => ({
          id: o.profile.id,
          x: o.x,
          z: o.z,
          verb: o.currentAction === null ? null : verbOf(o),
          distance: 0,
        }));
      agent.beliefs.update(
        perceive(this.world, { id: agent.profile.id, x: agent.x, z: agent.z }, others, ctx.tick)
      );
    }

    const event = executeActionTick(agent, this.world, this.intrinsics, ctx.tick);
    if (event !== null) this.events.push(event);

    if (agent.currentAction === null) {
      const next = selectAction(agent, this.registry, this.intrinsics);
      if (next !== null) {
        agent.currentAction = next;
        this.events.push({
          tick: ctx.tick,
          agentId: agent.profile.id,
          type: 'started',
          verb: next.verb,
        });
      }
    }
  }

  view(id: string): AgentView | undefined {
    const agent = this.agents.get(id);
    if (agent === undefined) return undefined;
    return {
      id,
      name: agent.profile.name,
      x: agent.x,
      y: getTerrainHeight(agent.x, agent.z),
      z: agent.z,
      heading: agent.heading,
      animation: animationOf(agent),
      verb: agent.currentAction === null ? null : verbOf(agent),
      dialogue: agent.speech !== null ? agent.speech.text : null,
    };
  }

  views(): AgentView[] {
    return this.sortedAgents().map((a) => this.view(a.profile.id)!);
  }

  drainEvents(): ActionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}

function verbOf(agent: AgentState): string {
  return agent.currentAction === null ? '' : agent.currentAction.verb;
}

function animationOf(agent: AgentState): AgentView['animation'] {
  const action = agent.currentAction;
  if (action === null) return 'idle';
  if (action.kind === 'world' && action.phase === 'goto') return 'walk';
  const verb = action.verb;
  if (verb === 'rest_nearby') return 'rest';
  if (verb === 'sleep_inside' || verb === 'nap') return 'sleep';
  if (GATHER_VERBS.test(verb)) return 'gather';
  if (CRAFT_VERBS.test(verb)) return 'craft';
  return 'idle';
}
