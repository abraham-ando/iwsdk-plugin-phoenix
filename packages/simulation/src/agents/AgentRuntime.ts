import { SimKernel, TICKS_PER_DAY, type TickContext } from '../kernel/SimKernel';
import type { ExternalEvent } from '../kernel/EventLog';
import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import type { SmartObjectRegistry } from '../world/SmartObject';
import { getTerrainHeight } from '../world/terrain';
import { createAgent, type AgentProfile, type AgentState } from './AgentState';
import { decayNeeds, maxUrgency } from './needs';
import { perceive, type PerceivedAgent } from './Perception';
import { executeActionTick, type ActionEvent } from './actions';
import { selectAction } from './Mode1';
import { buildPlanRequest, parsePlanSteps, type PlanRequest, type PlanRequestReason } from './Mode2';
import { defaultIntrinsics, type IntrinsicActionDef } from './intrinsics';
import type { WolfSystem } from '../world/WolfSystem';
import { clampNeed } from './needs';

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

export const MODE2_DAILY_BUDGET = 12;
export const URGENCY_OVERRIDE = 0.55;
export const DAWN_HOUR = 6;
export const REFLECTION_HOUR = 21;
export const DIALOGUE_RADIUS = 3;
export const DIALOGUE_COOLDOWN_TICKS = 1200;
export const SPEECH_DISPLAY_TICKS = 50;
export const PLAYER_ID = 'player';
export const PLAYER_SIGHTING_COOLDOWN = 600;
export const PLAYER_SPEAK_RADIUS = 6;
export const WOLF_ID = 'wolf';
export const WOLF_FEAR_RADIUS = 8;
export const WOLF_PANIC_RADIUS = 5;
export const WOLF_FEAR_COOLDOWN = 300;
export const SAFE_FIRE_RADIUS = 4;

interface PlayerPresence {
  x: number;
  z: number;
  lastSightingByAgent: Map<string, number>;
}

const GATHER_VERBS = /^(gather_|eat_|fish$)/;
const CRAFT_VERBS = /^(light_fire|add_wood|build|knap_flint|deposit_|take_)/;

/**
 * Orchestrates embodied agents on kernel ticks (spec §6, §7): decay ->
 * perceive -> execute -> select, plus the Mode-2 lifecycle — trigger-driven
 * plan requests in an outbox, LLM responses consumed from the kernel's
 * external-event journal (replay-exact, spec §8.3), and LeCun arbitration:
 * an urgent need always preempts the deliberate plan.
 */
export class AgentRuntime {
  readonly agents = new Map<string, AgentState>();
  private events: ActionEvent[] = [];
  private planRequests: PlanRequest[] = [];
  private intrinsics: IntrinsicActionDef[];
  private currentTick = 0;
  private eventSubscribers: Array<(e: ActionEvent) => void> = [];
  private planRequestSubscribers: Array<(r: PlanRequest) => void> = [];
  private player: PlayerPresence | null = null;
  private wolf: WolfSystem | null = null;
  private wolfFearAt = new Map<string, number>();

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
    this.currentTick = ctx.tick;
    for (const event of ctx.events) {
      if (!this.handlePlayerEvent(event, ctx.tick)) {
        this.handleExternalEvent(event, ctx.tick);
      }
    }
    const roster = this.sortedAgents();
    for (const agent of roster) {
      this.tickAgent(agent, ctx, roster);
    }
  }

  // --- Mode-2: external LLM responses (journaled, replay-exact) ---

  private handleExternalEvent(event: ExternalEvent, tick: number): void {
    const payload = event.payload as
      | {
          requestId?: string;
          agentId?: string;
          steps?: unknown;
          insights?: unknown;
          participantIds?: unknown;
          lines?: unknown;
          sharedFacts?: unknown;
        }
      | null
      | undefined;
    if (payload === null || payload === undefined || typeof payload !== 'object') return;

    if (event.type === 'llm_plan') {
      const agent = this.agents.get(payload.agentId ?? '');
      if (agent === undefined) return;
      if (agent.mode2.pendingRequestId === payload.requestId) agent.mode2.pendingRequestId = null;
      const steps = parsePlanSteps(payload, this.registry, this.intrinsics, agent);
      agent.plan = steps;
      if (steps.length > 0) {
        agent.memories.add({
          tick,
          text: `J'ai un nouveau plan: ${steps.map((s) => s.goal).join(', ')}`,
          importance: 3,
          kind: 'event',
        });
      }
      return;
    }

    if (event.type === 'llm_dialogue') {
      const ids = Array.isArray(payload.participantIds) ? (payload.participantIds as string[]) : [];
      const participants = ids
        .map((id) => this.agents.get(id))
        .filter((a): a is AgentState => a !== undefined);
      if (participants.length === 0) return;
      const initiator = this.agents.get(payload.agentId ?? '');
      if (initiator !== undefined && initiator.mode2.pendingRequestId === payload.requestId) {
        initiator.mode2.pendingRequestId = null;
      }
      const lines = Array.isArray(payload.lines)
        ? (payload.lines as Array<{ speaker?: unknown; text?: unknown }>).filter(
            (l) => typeof l?.speaker === 'string' && typeof l?.text === 'string'
          )
        : [];
      for (const participant of participants) {
        for (const line of lines) {
          participant.memories.add({
            tick,
            text: `${String(line.speaker)}: ${String(line.text)}`,
            importance: 3,
            kind: 'dialogue',
          });
        }
        // Speech bubble: the participant's own last line, if any.
        const own = [...lines].reverse().find((l) => l.speaker === participant.profile.id);
        if (own !== undefined) {
          participant.speech = { text: String(own.text), untilTick: tick + SPEECH_DISPLAY_TICKS };
        }
        // Rumors become beliefs, dated today (spec §7.4).
        if (Array.isArray(payload.sharedFacts)) {
          for (const fact of payload.sharedFacts as Array<Record<string, unknown>>) {
            if (
              typeof fact?.objectId === 'string' &&
              typeof fact?.type === 'string' &&
              typeof fact?.x === 'number' &&
              typeof fact?.z === 'number' &&
              typeof fact?.state === 'object' &&
              fact.state !== null
            ) {
              participant.beliefs.learn({
                objectId: fact.objectId,
                type: fact.type,
                x: fact.x,
                z: fact.z,
                state: fact.state as Record<string, number>,
                lastSeenTick: tick,
              });
            }
          }
        }
      }
      return;
    }

    if (event.type === 'llm_player_reply') {
      const agent = this.agents.get(payload.agentId ?? '');
      if (agent === undefined) return;
      if (agent.mode2.pendingRequestId === payload.requestId) agent.mode2.pendingRequestId = null;
      const reply = (payload as { reply?: unknown }).reply;
      if (typeof reply === 'string' && reply.length > 0) {
        agent.speech = { text: reply, untilTick: tick + SPEECH_DISPLAY_TICKS };
        agent.memories.add({
          tick,
          text: `J'ai répondu à l'étranger: "${reply}"`,
          importance: 4,
          kind: 'dialogue',
        });
      }
      return;
    }

    if (event.type === 'llm_reflection') {
      const agent = this.agents.get(payload.agentId ?? '');
      if (agent === undefined) return;
      if (agent.mode2.pendingRequestId === payload.requestId) agent.mode2.pendingRequestId = null;
      if (Array.isArray(payload.insights)) {
        for (const insight of payload.insights) {
          if (typeof insight === 'string') {
            agent.memories.add({ tick, text: insight, importance: 8, kind: 'reflection' });
          }
        }
      }
      return;
    }
  }

  // --- Player presence (spec §10.5) ---

  /** Register the human player as a perceivable living being of the world. */
  registerPlayer(x: number, z: number): void {
    this.player = { x, z, lastSightingByAgent: new Map() };
  }

  playerPosition(): { x: number; z: number } | null {
    return this.player === null ? null : { x: this.player.x, z: this.player.z };
  }

  /** Register the wolf so agents can fear it (spec §10.4). */
  attachWolf(wolf: WolfSystem): void {
    this.wolf = wolf;
  }

  private handlePlayerEvent(event: ExternalEvent, tick: number): boolean {
    if (this.player === null) return event.type.startsWith('player_');
    const payload = event.payload as Record<string, unknown> | null;

    if (event.type === 'player_move') {
      if (typeof payload?.x === 'number' && typeof payload?.z === 'number') {
        this.player.x = payload.x;
        this.player.z = payload.z;
      }
      return true;
    }

    if (event.type === 'player_speak') {
      const text = typeof payload?.text === 'string' ? payload.text : null;
      if (text === null) return true;
      const explicit =
        typeof payload?.targetAgentId === 'string'
          ? this.agents.get(payload.targetAgentId)
          : undefined;
      const target = explicit ?? this.nearestAgentTo(this.player.x, this.player.z, PLAYER_SPEAK_RADIUS);
      if (target === undefined) return true;
      target.memories.add({
        tick,
        text: `L'étranger m'a dit: "${text}"`,
        importance: 6,
        kind: 'dialogue',
      });
      this.emitPlanRequest(target, 'player_dialogue', tick, [PLAYER_ID, target.profile.id], text);
      return true;
    }

    return false;
  }

  private nearestAgentTo(x: number, z: number, maxRadius: number): AgentState | undefined {
    let best: AgentState | undefined;
    let bestDistance = maxRadius;
    for (const agent of this.sortedAgents()) {
      const distance = Math.hypot(agent.x - x, agent.z - z);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = agent;
      }
    }
    return best;
  }

  /** Transport layer failed to deliver a request: let the agent ask again. */
  releasePendingRequest(agentId: string, requestId: string): void {
    const agent = this.agents.get(agentId);
    if (agent !== undefined && agent.mode2.pendingRequestId === requestId) {
      agent.mode2.pendingRequestId = null;
    }
  }

  private emitPlanRequest(
    agent: AgentState,
    reason: PlanRequestReason,
    tick: number,
    participantIds?: string[],
    playerText?: string
  ): void {
    if (agent.mode2.pendingRequestId !== null) return;
    const consumesBudget = reason !== 'reflection';
    if (consumesBudget && agent.mode2.budgetUsed >= MODE2_DAILY_BUDGET) return;
    const request = buildPlanRequest(
      agent,
      this.registry,
      this.intrinsics,
      tick,
      reason,
      this.world.placeAt(agent.x, agent.z),
      participantIds,
      playerText
    );
    this.pushPlanRequest(request);
    agent.mode2.pendingRequestId = request.requestId;
    if (consumesBudget) agent.mode2.budgetUsed++;
  }

  drainPlanRequests(): PlanRequest[] {
    const out = this.planRequests;
    this.planRequests = [];
    return out;
  }

  /** Observe every action event without consuming the drain queue (telemetry). */
  subscribeEvents(cb: (e: ActionEvent) => void): () => void {
    this.eventSubscribers.push(cb);
    return () => {
      this.eventSubscribers = this.eventSubscribers.filter((s) => s !== cb);
    };
  }

  /** Observe every plan request without consuming the outbox (telemetry). */
  subscribePlanRequests(cb: (r: PlanRequest) => void): () => void {
    this.planRequestSubscribers.push(cb);
    return () => {
      this.planRequestSubscribers = this.planRequestSubscribers.filter((s) => s !== cb);
    };
  }

  private pushEvent(event: ActionEvent): void {
    this.events.push(event);
    for (const subscriber of [...this.eventSubscribers]) subscriber(event);
  }

  private pushPlanRequest(request: PlanRequest): void {
    this.planRequests.push(request);
    for (const subscriber of [...this.planRequestSubscribers]) subscriber(request);
  }

  // --- Per-tick agent lifecycle ---

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

    if (agent.speech !== null && ctx.tick > agent.speech.untilTick) {
      agent.speech = null;
    }

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
      if (this.player !== null) {
        others.push({ id: PLAYER_ID, x: this.player.x, z: this.player.z, verb: null, distance: 0 });
      }
      if (this.wolf !== null) {
        const wolfState = this.wolf.state();
        others.push({ id: WOLF_ID, x: wolfState.x, z: wolfState.z, verb: wolfState.mode, distance: 0 });
      }
      const observation = perceive(
        this.world,
        { id: agent.profile.id, x: agent.x, z: agent.z },
        others,
        ctx.tick
      );
      agent.beliefs.update(observation);

      // Meeting the stranger is memorable (spec §10.5), with a cooldown so
      // standing nearby does not flood the memory stream.
      if (this.player !== null && observation.agents.some((a) => a.id === PLAYER_ID)) {
        const lastSeen = this.player.lastSightingByAgent.get(agent.profile.id) ?? -Infinity;
        if (ctx.tick - lastSeen >= PLAYER_SIGHTING_COOLDOWN) {
          this.player.lastSightingByAgent.set(agent.profile.id, ctx.tick);
          const place = this.world.placeAt(this.player.x, this.player.z);
          agent.memories.add({
            tick: ctx.tick,
            text: `J'ai croisé l'étranger${place !== null ? ` près de ${place}` : ''}`,
            importance: 3,
            kind: 'event',
          });
        }
      }
    }

    // Mode-2 clock triggers: dawn plan (budget reset), nightly reflection.
    const day = Math.floor(ctx.tick / TICKS_PER_DAY);
    if (ctx.hour >= DAWN_HOUR && agent.mode2.lastDawnDay < day) {
      agent.mode2.lastDawnDay = day;
      agent.mode2.budgetUsed = 0;
      this.emitPlanRequest(agent, 'dawn', ctx.tick);
    }
    if (ctx.hour >= REFLECTION_HOUR && agent.mode2.lastReflectionDay < day) {
      agent.mode2.lastReflectionDay = day;
      this.emitPlanRequest(agent, 'reflection', ctx.tick);
    }

    // Dialogue trigger (spec §7.4): idle neighbors strike a conversation.
    // The lexicographically smaller id initiates, so each pair fires once.
    if (
      agent.currentAction === null &&
      agent.mode2.pendingRequestId === null &&
      ctx.tick >= agent.mode2.dialogueCooldownUntilTick
    ) {
      for (const other of roster) {
        if (other === agent || other.profile.id <= agent.profile.id) continue;
        if (other.currentAction !== null) continue;
        if (ctx.tick < other.mode2.dialogueCooldownUntilTick) continue;
        if (Math.hypot(other.x - agent.x, other.z - agent.z) > DIALOGUE_RADIUS) continue;
        this.emitPlanRequest(agent, 'dialogue', ctx.tick, [agent.profile.id, other.profile.id]);
        if (agent.mode2.pendingRequestId !== null) {
          agent.mode2.dialogueCooldownUntilTick = ctx.tick + DIALOGUE_COOLDOWN_TICKS;
          other.mode2.dialogueCooldownUntilTick = ctx.tick + DIALOGUE_COOLDOWN_TICKS;
        }
        break;
      }
    }

    // Wolf fear (spec §10.4): stress + memory when close, panic retreat to a
    // lit fire when very close and unprotected.
    if (this.wolf !== null) {
      const wolfState = this.wolf.state();
      const wolfDistance = Math.hypot(wolfState.x - agent.x, wolfState.z - agent.z);
      if (wolfDistance <= WOLF_FEAR_RADIUS) {
        const lastFear = this.wolfFearAt.get(agent.profile.id) ?? -Infinity;
        if (ctx.tick - lastFear >= WOLF_FEAR_COOLDOWN) {
          this.wolfFearAt.set(agent.profile.id, ctx.tick);
          agent.needs.stress = clampNeed(agent.needs.stress + 25);
          agent.memories.add({
            tick: ctx.tick,
            text: 'Le loup rôde tout près, je dois rester prudent !',
            importance: 7,
            kind: 'event',
          });
        }
        const protectedByFire = this.world
          .objectsNear(agent.x, agent.z, SAFE_FIRE_RADIUS)
          .some((o) => o.type === 'campfire' && (o.state.lit ?? 0) === 1);
        if (wolfDistance <= WOLF_PANIC_RADIUS && !protectedByFire) {
          const refuge = agent.beliefs
            .byType('campfire')
            .sort(
              (a, b) =>
                Math.hypot(a.x - agent.x, a.z - agent.z) - Math.hypot(b.x - agent.x, b.z - agent.z)
            )[0];
          if (refuge !== undefined && agent.currentAction?.verb !== 'rest_nearby') {
            agent.currentAction = {
              kind: 'world',
              objectId: refuge.objectId,
              verb: 'rest_nearby',
              phase: 'goto',
              targetX: refuge.x,
              targetZ: refuge.z,
              remainingTicks: 0,
            };
            this.pushEvent({
              tick: ctx.tick,
              agentId: agent.profile.id,
              type: 'started',
              verb: 'rest_nearby',
              source: 'reflex',
            });
          }
        }
      }
    }

    const event = executeActionTick(agent, this.world, this.intrinsics, ctx.tick);
    if (event !== null) {
      this.pushEvent(event);
      if (event.type === 'completed') {
        agent.memories.add({
          tick: ctx.tick,
          text: `${event.verb} accompli`,
          importance: 1,
          kind: 'event',
        });
      } else if (event.type === 'failed') {
        agent.memories.add({
          tick: ctx.tick,
          text: `Échec: ${event.verb} — ${event.reason ?? 'raison inconnue'}`,
          importance: 4,
          kind: 'event',
        });
        this.emitPlanRequest(agent, 'surprise', ctx.tick);
      }
    }

    if (agent.currentAction === null) {
      // LeCun arbitration: the deliberate plan runs only while no drive is
      // urgent; a pressing need hands control back to Mode-1 reflexes.
      let planned = false;
      if (maxUrgency(agent.needs) <= URGENCY_OVERRIDE && agent.plan.length > 0) {
        planned = this.tryPlanStep(agent, ctx.tick);
      }
      if (!planned && agent.currentAction === null) {
        const next = selectAction(agent, this.registry, this.intrinsics);
        if (next !== null) {
          agent.currentAction = next;
          this.pushEvent({
            tick: ctx.tick,
            agentId: agent.profile.id,
            type: 'started',
            verb: next.verb,
            source: 'reflex',
          });
        }
      }
    }
  }

  /** Pop plan steps until one is executable; install it as the current action. */
  private tryPlanStep(agent: AgentState, tick: number): boolean {
    while (agent.plan.length > 0) {
      const step = agent.plan.shift()!;
      const intrinsic = this.intrinsics.find((i) => i.verb === step.verb);
      if (intrinsic !== undefined) {
        agent.currentAction = {
          kind: 'intrinsic',
          verb: step.verb,
          remainingTicks: intrinsic.durationTicks,
        };
        this.pushEvent({
          tick,
          agentId: agent.profile.id,
          type: 'started',
          verb: step.verb,
          source: 'plan',
          predicted: step.predicted,
        });
        return true;
      }
      const belief = step.objectId !== undefined ? agent.beliefs.get(step.objectId) : undefined;
      if (belief === undefined) {
        agent.memories.add({
          tick,
          text: `Pas de plan abandonné: ${step.verb}`,
          importance: 2,
          kind: 'event',
        });
        continue;
      }
      agent.currentAction = {
        kind: 'world',
        objectId: belief.objectId,
        verb: step.verb,
        phase: 'goto',
        targetX: belief.x,
        targetZ: belief.z,
        remainingTicks: 0,
      };
      this.pushEvent({
        tick,
        agentId: agent.profile.id,
        type: 'started',
        verb: step.verb,
        source: 'plan',
        predicted: step.predicted,
        objectId: belief.objectId,
      });
      return true;
    }
    return false;
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
      dialogue:
        agent.speech !== null && this.currentTick <= agent.speech.untilTick
          ? agent.speech.text
          : null,
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
