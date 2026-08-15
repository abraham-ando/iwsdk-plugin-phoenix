import { SimKernel } from './SimKernel';
import type { ExternalEvent } from './EventLog';
import type { RngState } from './Rng';
import { GroundTruthWorld, type WorldSnapshot } from '../world/GroundTruthWorld';
import type { SmartObjectRegistry } from '../world/SmartObject';
import { AgentRuntime } from '../agents/AgentRuntime';
import { BeliefState, type Belief } from '../agents/BeliefState';
import type { AgentProfile, CurrentAction } from '../agents/AgentState';
import type { AgentNeeds } from '../agents/needs';

/**
 * Full serializable simulation state (spec §8.4). v1 = kernel + world
 * (étape 1); v2 adds embodied agents. restoreSim accepts both.
 */
export interface SerializedAgent {
  profile: AgentProfile;
  x: number;
  z: number;
  heading: number;
  needs: AgentNeeds;
  inventory: Record<string, number>;
  beliefs: Belief[];
  currentAction: CurrentAction | null;
  sleeping: boolean;
}

export interface SimSnapshot {
  version: 2;
  tick: number;
  rngState: RngState;
  events: ExternalEvent[];
  world: WorldSnapshot;
  agents: SerializedAgent[];
}

export function snapshotSim(
  kernel: SimKernel,
  world: GroundTruthWorld,
  runtime?: AgentRuntime
): SimSnapshot {
  const agents: SerializedAgent[] = runtime
    ? [...runtime.agents.values()]
        .sort((a, b) => a.profile.id.localeCompare(b.profile.id))
        .map((a) => ({
          profile: { ...a.profile },
          x: a.x,
          z: a.z,
          heading: a.heading,
          needs: { ...a.needs },
          inventory: { ...a.inventory },
          beliefs: a.beliefs.toJSON(),
          currentAction: a.currentAction === null ? null : { ...a.currentAction },
          sleeping: a.sleeping,
        }))
    : [];
  return {
    version: 2,
    tick: kernel.tick,
    rngState: kernel.rng.getState(),
    events: kernel.log.toJSON(),
    world: world.toJSON(),
    agents,
  };
}

export function restoreSim(
  snapshot: SimSnapshot | (Omit<SimSnapshot, 'version' | 'agents'> & { version: 1 }),
  registry: SmartObjectRegistry
): { kernel: SimKernel; world: GroundTruthWorld; runtime: AgentRuntime } {
  const version: number = snapshot.version;
  if (version !== 1 && version !== 2) {
    throw new Error(`restoreSim: unsupported snapshot version ${String(version)}`);
  }
  const kernel = new SimKernel({ seed: 0 });
  kernel.tick = snapshot.tick;
  kernel.rng.setState(snapshot.rngState);
  for (const e of snapshot.events) kernel.log.record(e);
  const world = GroundTruthWorld.fromJSON(snapshot.world, registry);
  world.attachTo(kernel);
  const runtime = new AgentRuntime(world, registry);
  const agents = snapshot.version === 2 ? snapshot.agents : [];
  for (const s of agents) {
    const agent = runtime.addAgent({ ...s.profile }, s.x, s.z);
    agent.heading = s.heading;
    agent.needs = { ...s.needs };
    agent.inventory = { ...s.inventory };
    agent.beliefs = BeliefState.fromJSON(s.beliefs);
    agent.currentAction = s.currentAction === null ? null : { ...s.currentAction };
    agent.sleeping = s.sleeping;
  }
  runtime.attachTo(kernel);
  return { kernel, world, runtime };
}
