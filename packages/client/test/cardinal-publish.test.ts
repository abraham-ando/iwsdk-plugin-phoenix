/**
 * Outbound change detection for Cardinal components.
 *
 * The dirty check is the whole reason a quiet component costs no wire bytes;
 * without it every tick would republish everything an entity holds.
 */
import { describe, expect, it } from 'vitest';
import { World } from './mocks/iwsdk-core.js';
import { CardinalPublisher } from '../src/cardinal/publish.js';
import {
  Health,
  registerCardinalComponents,
} from '../src/cardinal/components.generated.js';

/**
 * A world with *every* Cardinal component registered, and one entity carrying
 * Health.
 *
 * All of them, not just Health: the publisher walks the whole registry, and
 * `installPhoenixNetworking` registers the whole registry. Registering a
 * subset here would test a world that cannot exist.
 */
function entityWith(current: number, max: number) {
  const world = new World({ entityCapacity: 64, checksOn: false });
  registerCardinalComponents(world as never);

  const entity = world.createEntity();
  entity.addComponent(Health);
  entity.setValue(Health, 'current', current);
  entity.setValue(Health, 'max', max);
  return entity;
}

describe('CardinalPublisher', () => {
  it('emits a record the first time it sees an entity', () => {
    const publisher = new CardinalPublisher();
    const records = publisher.collect(entityWith(50, 100), 7);

    expect(records).toHaveLength(1);
    expect(records[0]!.networkId).toBe(7);
    expect(records[0]!.componentId).toBe(1);
    expect(records[0]!.data).toEqual({ current: 50, max: 100 });
  });

  it('emits nothing when the bytes have not changed', () => {
    const publisher = new CardinalPublisher();
    const entity = entityWith(50, 100);

    expect(publisher.collect(entity, 7)).toHaveLength(1);
    expect(publisher.collect(entity, 7)).toHaveLength(0);
  });

  it('emits again once a value changes', () => {
    const publisher = new CardinalPublisher();
    const entity = entityWith(50, 100);
    publisher.collect(entity, 7);

    entity.setValue(Health, 'current', 25);
    const records = publisher.collect(entity, 7);

    expect(records).toHaveLength(1);
    expect(records[0]!.data).toEqual({ current: 25, max: 100 });
  });

  it('compares against what was published, not the previous tick', () => {
    // A value that changes and changes back within one tick is not a change.
    const publisher = new CardinalPublisher();
    const entity = entityWith(50, 100);
    publisher.collect(entity, 7);

    entity.setValue(Health, 'current', 25);
    entity.setValue(Health, 'current', 50);

    expect(publisher.collect(entity, 7)).toHaveLength(0);
  });

  it('ignores an entity that has no Cardinal components', () => {
    const world = new World({ entityCapacity: 64, checksOn: false });
    registerCardinalComponents(world as never);
    const bare = world.createEntity();
    expect(new CardinalPublisher().collect(bare, 7)).toHaveLength(0);
  });

  it('tracks entities independently', () => {
    const publisher = new CardinalPublisher();
    publisher.collect(entityWith(50, 100), 7);

    // Same values, different entity — must still be published once.
    expect(publisher.collect(entityWith(50, 100), 8)).toHaveLength(1);
  });

  it('forgets an entity so a reused id republishes', () => {
    const publisher = new CardinalPublisher();
    const entity = entityWith(50, 100);
    publisher.collect(entity, 7);
    publisher.forget(7);

    expect(publisher.collect(entity, 7)).toHaveLength(1);
  });
});
