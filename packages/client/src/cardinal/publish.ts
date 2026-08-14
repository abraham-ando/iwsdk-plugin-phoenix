/**
 * Outbound change detection for Cardinal components.
 *
 * Every component has a constant byte size, so "has this changed" is a byte
 * comparison against the last thing published — no per-field tracking, no
 * hooks into elics, and a component nobody touches costs nothing on the wire.
 *
 * The comparison is against what was *published*, not against the previous
 * tick's value: a component that changes and changes back within one tick
 * correctly produces no traffic.
 */
import type { Entity } from '@iwsdk/core';
import type { ComponentRecord } from '../protocol/BinaryProtocol.js';
import { CARDINAL_REGISTRY } from './components.generated.js';

export class CardinalPublisher {
  /** networkId -> componentId -> the bytes last published. */
  private readonly published = new Map<number, Map<number, Uint8Array>>();

  /** Records for everything on `entity` that changed since its last publish. */
  collect(entity: Entity, networkId: number): ComponentRecord[] {
    const records: ComponentRecord[] = [];

    for (const spec of CARDINAL_REGISTRY.values()) {
      if (!entity.hasComponent(spec.component)) continue;

      const data = spec.read(entity);
      const bytes = new Uint8Array(spec.bytes);
      spec.encode(new DataView(bytes.buffer), 0, data);

      let forEntity = this.published.get(networkId);
      if (!forEntity) {
        forEntity = new Map();
        this.published.set(networkId, forEntity);
      }

      const previous = forEntity.get(spec.id);
      if (previous && equalBytes(previous, bytes)) continue;

      forEntity.set(spec.id, bytes);
      records.push({ networkId, componentId: spec.id, data });
    }

    return records;
  }

  /** Drop an entity's history — call on despawn, so a reused id republishes. */
  forget(networkId: number): void {
    this.published.delete(networkId);
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
