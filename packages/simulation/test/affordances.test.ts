import { describe, it, expect } from 'vitest';
import {
  compare,
  checkAffordance,
  applyAffordance,
  type ActorContext,
} from '../src/world/affordances';
import type { AffordanceDef, SmartObjectInstance } from '../src/world/SmartObject';

const gatherBerries: AffordanceDef = {
  verb: 'gather_berries',
  durationTicks: 30,
  preconditions: {
    objectState: { berriesLeft: '>0' },
    actorDistance: '<1.5',
  },
  effects: {
    object: { berriesLeft: -2 },
    actorInventory: { berries: +2 },
  },
};

function makeBush(): SmartObjectInstance {
  return { id: 'bush_1', type: 'berry_bush', x: 0, z: 0, state: { berriesLeft: 3 } };
}

function makeActor(x = 0.5, z = 0): ActorContext {
  return { x, z, inventory: {} };
}

describe('compare', () => {
  it('evaluates all five operators', () => {
    expect(compare(3, '>0')).toBe(true);
    expect(compare(0, '>0')).toBe(false);
    expect(compare(1.2, '<1.5')).toBe(true);
    expect(compare(2, '>=2')).toBe(true);
    expect(compare(2, '<=1')).toBe(false);
    expect(compare(1, '==1')).toBe(true);
  });

  it('throws on malformed expressions', () => {
    expect(() => compare(1, 'abc')).toThrow('Invalid comparison: abc');
  });
});

describe('checkAffordance', () => {
  it('passes when all preconditions hold', () => {
    expect(checkAffordance(gatherBerries, makeBush(), makeActor())).toEqual({ ok: true });
  });

  it('fails on empty object state with a reason', () => {
    const bush = makeBush();
    bush.state.berriesLeft = 0;
    const res = checkAffordance(gatherBerries, bush, makeActor());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('berriesLeft');
  });

  it('fails when the actor is too far', () => {
    const res = checkAffordance(gatherBerries, makeBush(), makeActor(10, 10));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('actorDistance');
  });

  it('checks actor inventory preconditions', () => {
    const lightFire: AffordanceDef = {
      verb: 'light_fire',
      durationTicks: 50,
      preconditions: { actorInventory: { wood: '>=1', flint: '>=1' } },
      effects: { object: { lit: +1 }, actorInventory: { wood: -1 } },
    };
    const fire: SmartObjectInstance = { id: 'f1', type: 'campfire', x: 0, z: 0, state: { lit: 0, fuel: 0 } };
    const poor = makeActor();
    expect(checkAffordance(lightFire, fire, poor).ok).toBe(false);
    const equipped: ActorContext = { x: 0, z: 0, inventory: { wood: 2, flint: 1 } };
    expect(checkAffordance(lightFire, fire, equipped).ok).toBe(true);
  });
});

describe('applyAffordance', () => {
  it('mutates object state and actor inventory', () => {
    const bush = makeBush();
    const actor = makeActor();
    applyAffordance(gatherBerries, bush, actor);
    expect(bush.state.berriesLeft).toBe(1);
    expect(actor.inventory.berries).toBe(2);
  });

  it('floors object state and inventory at zero', () => {
    const bush = makeBush();
    bush.state.berriesLeft = 1;
    const actor = makeActor();
    applyAffordance(gatherBerries, bush, actor); // -2 sur 1 -> plancher 0
    expect(bush.state.berriesLeft).toBe(0);
  });
});

describe('actorNeeds effects', () => {
  it('applies need deltas clamped to [0, 100]', () => {
    const rest: AffordanceDef = {
      verb: 'rest_nearby',
      durationTicks: 100,
      effects: { actorNeeds: { warmth: 20, energy: 10 } },
    };
    const fire: SmartObjectInstance = { id: 'f1', type: 'campfire', x: 0, z: 0, state: { lit: 1 } };
    const actor: ActorContext = { x: 0, z: 0, inventory: {}, needs: { warmth: 95, energy: 50 } };
    applyAffordance(rest, fire, actor);
    expect(actor.needs?.warmth).toBe(100); // clamped
    expect(actor.needs?.energy).toBe(60);
  });

  it('ignores actorNeeds when the actor has no needs (étape 1 callers)', () => {
    const rest: AffordanceDef = {
      verb: 'rest_nearby',
      durationTicks: 100,
      effects: { actorNeeds: { warmth: 20 } },
    };
    const fire: SmartObjectInstance = { id: 'f1', type: 'campfire', x: 0, z: 0, state: { lit: 1 } };
    const actor: ActorContext = { x: 0, z: 0, inventory: {} };
    expect(() => applyAffordance(rest, fire, actor)).not.toThrow();
  });
});
