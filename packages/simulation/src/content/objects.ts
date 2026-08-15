import type { SmartObjectRegistry } from '../world/SmartObject';

/**
 * v1 content catalog (spec §4.1). Content declares the world's verbs; the
 * engine stays generic. Durations are in 100 ms ticks (30 ticks = 3 s).
 * Actor-need effects (warmth, energy) arrive with the AgentRuntime in étape 2;
 * v1 effects touch only object state and actor inventory.
 */
export function registerDefaultContent(registry: SmartObjectRegistry): void {
  registry.define('berry_bush', {
    affordances: [
      {
        verb: 'gather_berries',
        durationTicks: 30,
        preconditions: { objectState: { berriesLeft: '>0' }, actorDistance: '<1.5' },
        effects: { object: { berriesLeft: -2 }, actorInventory: { berries: 2 } },
      },
    ],
    state: { berriesLeft: 12 },
    regrowth: [{ field: 'berriesLeft', perDay: 4, max: 12 }],
  });

  registry.define('oak_tree', {
    affordances: [
      {
        verb: 'gather_wood',
        durationTicks: 40,
        preconditions: { objectState: { woodLeft: '>0' }, actorDistance: '<2' },
        effects: { object: { woodLeft: -1 }, actorInventory: { wood: 1 } },
      },
    ],
    state: { woodLeft: 8 },
    regrowth: [{ field: 'woodLeft', perDay: 2, max: 8 }],
  });

  registry.define('flint_deposit', {
    affordances: [
      {
        verb: 'gather_flint',
        durationTicks: 50,
        preconditions: { objectState: { flintLeft: '>0' }, actorDistance: '<1.5' },
        effects: { object: { flintLeft: -1 }, actorInventory: { flint: 1 } },
      },
    ],
    state: { flintLeft: 6 },
    regrowth: [{ field: 'flintLeft', perDay: 1, max: 6 }],
  });

  registry.define('campfire', {
    affordances: [
      {
        verb: 'light_fire',
        durationTicks: 50,
        preconditions: {
          objectState: { lit: '==0' },
          actorDistance: '<2',
          actorInventory: { wood: '>=1', flint: '>=1' },
        },
        effects: { object: { lit: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'add_wood',
        durationTicks: 20,
        preconditions: { objectState: { lit: '==1' }, actorDistance: '<2', actorInventory: { wood: '>=1' } },
        effects: { object: { fuel: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'rest_nearby',
        durationTicks: 100,
        preconditions: { objectState: { lit: '==1' }, actorDistance: '<3' },
        effects: {},
      },
    ],
    state: { lit: 0, fuel: 0 },
  });

  registry.define('river_bank', {
    affordances: [
      {
        verb: 'drink',
        durationTicks: 20,
        preconditions: { actorDistance: '<2' },
        effects: {},
      },
      {
        verb: 'fish',
        durationTicks: 80,
        preconditions: { actorDistance: '<2' },
        effects: { actorInventory: { fish: 1 } },
      },
      {
        verb: 'knap_flint',
        durationTicks: 60,
        preconditions: { actorDistance: '<2', actorInventory: { flint: '>=1' } },
        effects: { actorInventory: { flint_blade: 1, flint: -1 } },
      },
    ],
    state: {},
  });

  registry.define('shelter', {
    affordances: [
      {
        verb: 'build',
        durationTicks: 60,
        preconditions: {
          objectState: { progress: '<5' },
          actorDistance: '<2.5',
          actorInventory: { wood: '>=1' },
        },
        effects: { object: { progress: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'sleep_inside',
        durationTicks: 200,
        preconditions: { objectState: { progress: '>=5' }, actorDistance: '<2.5' },
        effects: {},
      },
    ],
    state: { progress: 0 },
  });

  registry.define('camp_storage', {
    affordances: [
      {
        verb: 'deposit_berries',
        durationTicks: 10,
        preconditions: { actorDistance: '<1.5', actorInventory: { berries: '>=1' } },
        effects: { object: { berries: 1 }, actorInventory: { berries: -1 } },
      },
      {
        verb: 'take_berries',
        durationTicks: 10,
        preconditions: { objectState: { berries: '>0' }, actorDistance: '<1.5' },
        effects: { object: { berries: -1 }, actorInventory: { berries: 1 } },
      },
      {
        verb: 'deposit_wood',
        durationTicks: 10,
        preconditions: { actorDistance: '<1.5', actorInventory: { wood: '>=1' } },
        effects: { object: { wood: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'take_wood',
        durationTicks: 10,
        preconditions: { objectState: { wood: '>0' }, actorDistance: '<1.5' },
        effects: { object: { wood: -1 }, actorInventory: { wood: 1 } },
      },
    ],
    state: { berries: 0, wood: 0 },
  });
}
