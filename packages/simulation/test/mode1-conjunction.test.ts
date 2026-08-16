import { describe, it, expect } from 'vitest';
import { createAgent } from '../src/agents/AgentState';
import { selectAction } from '../src/agents/Mode1';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { defaultIntrinsics } from '../src/agents/intrinsics';
import type { Belief } from '../src/agents/BeliefState';

function belief(id: string, type: string, x: number, z: number, state: Record<string, number>): Belief {
  return { objectId: id, type, x, z, state, lastSeenTick: 0 };
}

/**
 * Un villageois transi, à côté d'un foyer éteint. Le silex est à portée de
 * main, le bois un peu plus loin. `light_fire` exige les deux.
 */
function frozenVillager() {
  const agent = createAgent({ id: 'tao', name: 'Tao', tribe: 'Pic', role: 'Sentinelle', persona: 'stoïque' }, 0, 0);
  agent.needs.warmth = 20;
  agent.needs.hunger = 95;
  agent.needs.energy = 95;
  agent.needs.affection = 95;
  agent.beliefs.learn(belief('campfire_1', 'campfire', 0.5, 0, { lit: 0, fuel: 0 }));
  agent.beliefs.learn(belief('flint_deposit_1', 'flint_deposit', 1, 0, { flintLeft: 6 }));
  agent.beliefs.learn(belief('oak_tree_1', 'oak_tree', 9, 0, { woodLeft: 8 }));
  return agent;
}

describe('Mode-1 face à une conjonction', () => {
  it('ATTEINT LE SILEX ALORS QUE LE BOIS MANQUE AUSSI', () => {
    // `light_fire` exige bois ET silex. Tant que Mode-1 s'arrêtait au premier
    // manquant, il ne chaînait jamais que vers le bois — et `gather_flint`
    // n'était pas exécuté une seule fois en six jours simulés. Les foyers
    // s'éteignaient au tick 600 et ne se rallumaient plus jamais.
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const agent = frozenVillager();
    expect(agent.inventory.wood ?? 0).toBe(0);
    expect(agent.inventory.flint ?? 0).toBe(0);

    const action = selectAction(agent, registry, defaultIntrinsics());
    // Le silex est à 1 m, le bois à 9 m : à besoin égal, le trajet tranche.
    expect(action?.verb).toBe('gather_flint');
  });

  it('va chercher le bois une fois le silex en main', () => {
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const agent = frozenVillager();
    agent.inventory.flint = 1;
    expect(selectAction(agent, registry, defaultIntrinsics())?.verb).toBe('gather_wood');
  });

  it('allume enfin le foyer quand il tient les deux', () => {
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const agent = frozenVillager();
    agent.inventory.flint = 1;
    agent.inventory.wood = 1;
    expect(selectAction(agent, registry, defaultIntrinsics())?.verb).toBe('light_fire');
  });

  it("ne propose rien d'inatteignable quand aucun fournisseur n'est cru", () => {
    // Sans silex connu, la chaîne doit mourir proprement, pas produire une
    // action vers un objet dont l'agent ignore l'existence.
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const agent = frozenVillager();
    agent.beliefs.forget('flint_deposit_1');
    agent.beliefs.forget('oak_tree_1');
    const action = selectAction(agent, registry, defaultIntrinsics());
    expect(action?.verb).not.toBe('light_fire');
    expect(action?.verb).not.toBe('gather_flint');
  });
});
