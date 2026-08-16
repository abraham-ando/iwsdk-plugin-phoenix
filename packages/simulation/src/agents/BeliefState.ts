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

/**
 * Nombre d'objets qu'un agent garde en tête. Ce n'est pas un réglage de
 * performance déguisé : une mémoire qui décline est une mémoire faillible,
 * et c'est ce que le modèle du monde demande. La valeur est mesurée —
 * `Mode1.selectAction` note toutes les croyances à chaque décision, et coûte
 * 0,13 ms au pire à 128 croyances contre 0,80 ms à 2 166.
 */
export const MAX_OBJECT_BELIEFS = 128;

export class BeliefState {
  private beliefs = new Map<string, Belief>();
  /** Résultat de `known()`, invalidé à la moindre écriture. */
  private sorted: Belief[] | null = null;

  update(obs: Observation): void {
    for (const o of obs.objects) {
      this.remember({
        objectId: o.id,
        type: o.type,
        x: o.x,
        z: o.z,
        state: { ...o.state },
        lastSeenTick: obs.tick,
      });
    }
  }

  /**
   * Retient une croyance et oublie la plus ancienne si la mémoire déborde.
   * Seul point d'écriture : le cache de `known()` s'invalide ici et nulle
   * part ailleurs.
   */
  private remember(belief: Belief): void {
    this.beliefs.set(belief.objectId, belief);
    this.sorted = null;
    if (this.beliefs.size <= MAX_OBJECT_BELIEFS) return;
    // À date égale, l'identifiant tranche : sans quoi l'éviction dépendrait
    // de l'ordre d'insertion et le déterminisme du moteur tomberait.
    const oldestFirst = [...this.beliefs.values()].sort(
      (a, b) => a.lastSeenTick - b.lastSeenTick || a.objectId.localeCompare(b.objectId)
    );
    const excess = this.beliefs.size - MAX_OBJECT_BELIEFS;
    for (let i = 0; i < excess; i++) this.beliefs.delete(oldestFirst[i]!.objectId);
  }

  /**
   * Croyances triées par identifiant. Le tableau rendu est PARTAGÉ : le muter
   * corromprait le cache. Les appelants le lisent, le copient s'ils trient.
   */
  known(): Belief[] {
    if (this.sorted === null) {
      this.sorted = [...this.beliefs.values()].sort((a, b) =>
        a.objectId.localeCompare(b.objectId)
      );
    }
    return this.sorted;
  }

  byType(type: string): Belief[] {
    return this.known().filter((b) => b.type === type);
  }

  get(objectId: string): Belief | undefined {
    return this.beliefs.get(objectId);
  }

  forget(objectId: string): void {
    this.beliefs.delete(objectId);
    this.sorted = null;
  }

  /** Adopt a belief heard from someone else (rumor, spec §7.4). The rumor is
   * dated at the moment it is heard, not when the fact was observed. */
  learn(belief: Belief): void {
    this.remember({ ...belief, state: { ...belief.state } });
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
