/**
 * Lookup from `networkId` to the entity that carries it.
 *
 * Network ids are assigned by the server *after* the entity exists locally, so
 * a map maintained purely from query `qualify` events would miss entities whose
 * id arrived later. This index therefore combines both strategies: it listens
 * for qualify/disqualify, and rebuilds itself on a miss — at most once per
 * frame, so a stream of frames referencing genuinely unknown ids (an entity the
 * client has not spawned yet) cannot turn into a rescan per frame.
 */
import type { Entity } from '@iwsdk/core';
import { Networked } from '../components/index.js';

export class EntityIndex {
  private readonly byNetworkId = new Map<number, Entity>();
  private lastRebuildFrame = -1;

  /** Track an entity whose network id is already assigned. */
  add(entity: Entity): void {
    const networkId = entity.getValue(Networked, 'networkId') ?? 0;
    if (networkId !== 0) this.byNetworkId.set(networkId, entity);
  }

  /** Stop tracking an entity. */
  remove(entity: Entity): void {
    const networkId = entity.getValue(Networked, 'networkId') ?? 0;
    if (networkId !== 0) this.byNetworkId.delete(networkId);
  }

  /**
   * Resolve a network id.
   *
   * @param candidates Live entity set to rescan if the id is unknown.
   * @param frame Monotonically increasing frame counter, used to rate-limit
   *   rebuilds to one per frame.
   */
  get(
    networkId: number,
    candidates: Iterable<Entity>,
    frame: number,
  ): Entity | undefined {
    const hit = this.byNetworkId.get(networkId);
    if (hit && hit.active) return hit;

    if (hit && !hit.active) this.byNetworkId.delete(networkId);

    if (this.lastRebuildFrame === frame) return undefined;
    this.lastRebuildFrame = frame;
    this.rebuild(candidates);

    return this.byNetworkId.get(networkId);
  }

  /** Discard and rebuild the whole map from the given entities. */
  rebuild(candidates: Iterable<Entity>): void {
    this.byNetworkId.clear();
    for (const entity of candidates) {
      if (!entity.active) continue;
      const networkId = entity.getValue(Networked, 'networkId') ?? 0;
      if (networkId !== 0) this.byNetworkId.set(networkId, entity);
    }
  }

  /** Number of tracked entities. */
  get size(): number {
    return this.byNetworkId.size;
  }

  clear(): void {
    this.byNetworkId.clear();
    this.lastRebuildFrame = -1;
  }
}
