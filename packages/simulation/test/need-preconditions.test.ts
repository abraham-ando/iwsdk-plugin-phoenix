import { describe, it, expect } from 'vitest';
import { checkAffordance } from '../src/world/affordances';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { createAgent } from '../src/agents/AgentState';
import { selectAction } from '../src/agents/Mode1';
import { defaultIntrinsics } from '../src/agents/intrinsics';
import type { Belief } from '../src/agents/BeliefState';

function belief(id: string, type: string, x: number, z: number, state: Record<string, number>): Belief {
  return { objectId: id, type, x, z, state, lastSeenTick: 0 };
}

describe('préconditions sur les besoins', () => {
  it('LAISSE PASSER quand le besoin satisfait la condition', () => {
    const object = { id: 'shelter_1', type: 'shelter', x: 0, z: 0, state: { progress: 5 } };
    const def = {
      verb: 'sleep_inside',
      durationTicks: 200,
      preconditions: { actorNeeds: { energy: '<60' } },
      effects: {},
    };
    const actor = { x: 0, z: 0, inventory: {}, needs: { hunger: 80, warmth: 80, energy: 30, affection: 80, stress: 0 } };
    expect(checkAffordance(def, object, actor).ok).toBe(true);
  });

  it('REFUSE, en le disant, quand le besoin ne la satisfait pas', () => {
    const object = { id: 'shelter_1', type: 'shelter', x: 0, z: 0, state: { progress: 5 } };
    const def = {
      verb: 'sleep_inside',
      durationTicks: 200,
      preconditions: { actorNeeds: { energy: '<60' } },
      effects: {},
    };
    const actor = { x: 0, z: 0, inventory: {}, needs: { hunger: 80, warmth: 80, energy: 95, affection: 80, stress: 0 } };
    const result = checkAffordance(def, object, actor);
    expect(result.ok).toBe(false);
    // Le refus doit se NOMMER : un diagnostic muet est ce qui a laissé les
    // foyers éteints six jours sans que rien ne le signale.
    if (!result.ok) expect(result.reason).toContain('actorNeeds');
  });

  it("n'entrave rien quand aucune condition de besoin n'est déclarée", () => {
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const object = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: {} };
    const drink = registry.get('river_bank').affordances.find((a) => a.verb === 'drink')!;
    const actor = { x: 0, z: 0, inventory: {}, needs: { hunger: 80, warmth: 80, energy: 95, affection: 80, stress: 0 } };
    expect(checkAffordance(drink, object, actor).ok).toBe(true);
  });
});

describe("le sommeil n'est plus une occupation à plein temps", () => {
  function villager(energy: number) {
    const agent = createAgent({ id: 'tao', name: 'Tao', tribe: 'Pic', role: 'Sentinelle', persona: 'stoïque' }, 0, 0);
    agent.needs = { hunger: 90, warmth: 30, energy, affection: 90, stress: 0 };
    agent.beliefs.learn(belief('shelter_1', 'shelter', 0.5, 0, { progress: 5 }));
    agent.beliefs.learn(belief('campfire_1', 'campfire', 1, 0, { lit: 0, fuel: 0 }));
    agent.beliefs.learn(belief('flint_deposit_1', 'flint_deposit', 1.5, 0, { flintLeft: 6 }));
    agent.beliefs.learn(belief('oak_tree_1', 'oak_tree', 4, 0, { woodLeft: 8 }));
    return agent;
  }

  it('DORT ENCORE QUAND IL EST ÉPUISÉ', () => {
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    expect(selectAction(villager(15), registry, defaultIntrinsics())?.verb).toBe('sleep_inside');
  });

  it("S'OCCUPE DU FEU QUAND IL A DORMI SON CONTENT", () => {
    // Le défaut mesuré : `sleep_inside` n'avait AUCUNE condition d'entrée et
    // l'emportait à toute heure, jusqu'à chaleur 1 avec tous les autres
    // besoins comblés. Le village dormait, les foyers restaient éteints depuis
    // le tick 600, et personne n'avait jamais de raison de s'éloigner.
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const action = selectAction(villager(95), registry, defaultIntrinsics());
    expect(action?.verb).not.toBe('sleep_inside');
  });
});
