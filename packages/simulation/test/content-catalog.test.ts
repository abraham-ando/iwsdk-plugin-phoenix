import { describe, it, expect } from 'vitest';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { compare } from '../src/world/affordances';
import { registerDefaultContent } from '../src/content/objects';

function freshRegistry(): SmartObjectRegistry {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return reg;
}

describe('default content catalog', () => {
  it('registers the seven v1 smart object types', () => {
    expect(freshRegistry().types()).toEqual([
      'berry_bush',
      'camp_storage',
      'campfire',
      'flint_deposit',
      'oak_tree',
      'river_bank',
      'shelter',
    ]);
  });

  it('every affordance is well-formed', () => {
    const reg = freshRegistry();
    for (const type of reg.types()) {
      const def = reg.get(type);
      expect(def.affordances.length).toBeGreaterThan(0);
      for (const aff of def.affordances) {
        expect(aff.verb.length).toBeGreaterThan(0);
        expect(aff.durationTicks).toBeGreaterThan(0);
        // Every comparison expression must parse (compare throws otherwise).
        const pre = aff.preconditions;
        for (const expr of Object.values(pre?.objectState ?? {})) compare(0, expr);
        for (const expr of Object.values(pre?.actorInventory ?? {})) compare(0, expr);
        if (pre?.actorDistance !== undefined) compare(0, pre.actorDistance);
      }
      // Regrowth fields must exist in initial state.
      for (const rule of def.regrowth ?? []) {
        expect(def.state).toHaveProperty(rule.field);
        expect(rule.perDay).toBeGreaterThan(0);
        expect(rule.max).toBeGreaterThan(0);
      }
    }
  });

  it('campfire light_fire requires wood and flint and consumes wood', () => {
    const def = freshRegistry().get('campfire');
    const light = def.affordances.find((a) => a.verb === 'light_fire');
    expect(light).toBeDefined();
    expect(light?.preconditions?.actorInventory).toEqual({ wood: '>=1', flint: '>=1' });
    expect(light?.effects.object).toEqual({ lit: 1 });
    expect(light?.effects.actorInventory).toEqual({ wood: -1 });
  });

  it('berry_bush regrows toward its cap', () => {
    const def = freshRegistry().get('berry_bush');
    expect(def.state.berriesLeft).toBe(12);
    expect(def.regrowth).toEqual([{ field: 'berriesLeft', perDay: 4, max: 12 }]);
  });
});
