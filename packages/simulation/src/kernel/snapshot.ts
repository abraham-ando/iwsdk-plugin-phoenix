import { SimKernel } from './SimKernel';
import type { ExternalEvent } from './EventLog';
import type { RngState } from './Rng';
import { GroundTruthWorld, type WorldSnapshot } from '../world/GroundTruthWorld';
import type { SmartObjectRegistry } from '../world/SmartObject';

/**
 * Full serializable simulation state (spec §8.4): kernel clock, rng, journal
 * and world. Étape 2 will extend this with agent state. version guards
 * future format migrations.
 */
export interface SimSnapshot {
  version: 1;
  tick: number;
  rngState: RngState;
  events: ExternalEvent[];
  world: WorldSnapshot;
}

export function snapshotSim(kernel: SimKernel, world: GroundTruthWorld): SimSnapshot {
  return {
    version: 1,
    tick: kernel.tick,
    rngState: kernel.rng.getState(),
    events: kernel.log.toJSON(),
    world: world.toJSON(),
  };
}

export function restoreSim(
  snapshot: SimSnapshot,
  registry: SmartObjectRegistry
): { kernel: SimKernel; world: GroundTruthWorld } {
  if (snapshot.version !== 1) {
    throw new Error(`restoreSim: unsupported snapshot version ${String(snapshot.version)}`);
  }
  const kernel = new SimKernel({ seed: 0 });
  kernel.tick = snapshot.tick;
  kernel.rng.setState(snapshot.rngState);
  for (const e of snapshot.events) kernel.log.record(e);
  const world = GroundTruthWorld.fromJSON(snapshot.world, registry);
  world.attachTo(kernel);
  return { kernel, world };
}
