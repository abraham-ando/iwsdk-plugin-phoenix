import { createDefaultNeeds, type AgentNeeds } from './needs';
import { BeliefState } from './BeliefState';
import { MemoryStream } from './MemoryStream';

export interface AgentProfile {
  id: string;
  name: string;
  tribe: string;
  role: string;
  persona?: string;
}

/** One step of a Mode-2 plan (spec §7.2) — `predicted` is the LLM's expected
 * outcome, confronted with reality by étape 5's telemetry. */
export interface PlannedStep {
  goal: string;
  verb: string;
  objectId?: string;
  predicted: string;
}

export interface Mode2State {
  budgetUsed: number;
  pendingRequestId: string | null;
  lastDawnDay: number;
  lastReflectionDay: number;
  dialogueCooldownUntilTick: number;
}

export type CurrentAction =
  | {
      kind: 'world';
      objectId: string;
      verb: string;
      phase: 'goto' | 'perform';
      targetX: number;
      targetZ: number;
      remainingTicks: number;
    }
  | { kind: 'intrinsic'; verb: string; remainingTicks: number };

export interface AgentState {
  profile: AgentProfile;
  x: number;
  z: number;
  heading: number;
  needs: AgentNeeds;
  inventory: Record<string, number>;
  beliefs: BeliefState;
  memories: MemoryStream;
  plan: PlannedStep[];
  mode2: Mode2State;
  speech: { text: string; untilTick: number } | null;
  currentAction: CurrentAction | null;
  sleeping: boolean;
}

export function createAgent(profile: AgentProfile, x: number, z: number): AgentState {
  return {
    profile,
    x,
    z,
    heading: 0,
    needs: createDefaultNeeds(),
    inventory: {},
    beliefs: new BeliefState(),
    memories: new MemoryStream(),
    plan: [],
    mode2: {
      budgetUsed: 0,
      pendingRequestId: null,
      lastDawnDay: -1,
      lastReflectionDay: -1,
      dialogueCooldownUntilTick: 0,
    },
    speech: null,
    currentAction: null,
    sleeping: false,
  };
}
