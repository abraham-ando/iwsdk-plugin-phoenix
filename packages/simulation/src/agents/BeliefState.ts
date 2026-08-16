import type { Observation } from './Perception';
import type { GroundTruthWorld } from '../world/GroundTruthWorld';

/**
 * The agent's short-term world model in LeCun's sense (spec §5, §6.2):
 * dated, fallible beliefs built only from perception. Divergence from ground
 * truth is a measurable engine metric — impossible in the real world, free
 * in simulation.
 */
export interface Belief {
  objectId: string;
  type: string;
  x: number;
  z: number;
  state: Record<string, number>;
  lastSeenTick: number;
}

export class BeliefState {
  private beliefs = new Map<string, Belief>();

  update(obs: Observation): void {
    for (const o of obs.objects) {
      this.beliefs.set(o.id, {
        objectId: o.id,
        type: o.type,
        x: o.x,
        z: o.z,
        state: { ...o.state },
        lastSeenTick: obs.tick,
      });
    }
  }

  known(): Belief[] {
    return [...this.beliefs.values()].sort((a, b) => a.objectId.localeCompare(b.objectId));
  }

  byType(type: string): Belief[] {
    return this.known().filter((b) => b.type === type);
  }

  get(objectId: string): Belief | undefined {
    return this.beliefs.get(objectId);
  }

  forget(objectId: string): void {
    this.beliefs.delete(objectId);
  }

  /** Adopt a belief heard from someone else (rumor, spec §7.4). The rumor is
   * dated at the moment it is heard, not when the fact was observed. */
  learn(belief: Belief): void {
    this.beliefs.set(belief.objectId, { ...belief, state: { ...belief.state } });
  }

  /** Fraction of believed state fields that disagree with ground truth. */
  divergenceFrom(world: GroundTruthWorld): number {
    let fields = 0;
    let wrong = 0;
    for (const belief of this.beliefs.values()) {
      const real = world.get(belief.objectId);
      const entries = Object.entries(belief.state);
      if (real === undefined) {
        fields += Math.max(1, entries.length);
        wrong += Math.max(1, entries.length);
        continue;
      }
      for (const [field, value] of entries) {
        fields++;
        if ((real.state[field] ?? 0) !== value) wrong++;
      }
    }
    return fields === 0 ? 0 : wrong / fields;
  }

  toJSON(): Belief[] {
    return this.known().map((b) => ({ ...b, state: { ...b.state } }));
  }

  static fromJSON(beliefs: Belief[]): BeliefState {
    const bs = new BeliefState();
    for (const b of beliefs) bs.beliefs.set(b.objectId, { ...b, state: { ...b.state } });
    return bs;
  }
}
