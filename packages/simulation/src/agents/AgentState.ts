import { createDefaultNeeds, type AgentNeeds } from './needs';
import { BeliefState } from './BeliefState';

export interface AgentProfile {
  id: string;
  name: string;
  tribe: string;
  role: string;
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
    currentAction: null,
    sleeping: false,
  };
}
