import { describe, it, expect } from 'vitest';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { checkAffordance } from '../src/world/affordances';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

function fishAffordance(registry: SmartObjectRegistry) {
  return registry.get('river_bank').affordances.find((a) => a.verb === 'fish')!;
}

describe('la rivière a une population de poissons', () => {
  it("N'EST PLUS UN GARDE-MANGER INFINI", () => {
    // Sans stock ni condition, `fish` nourrissait onze agents indéfiniment à
    // 4 m du village : mesuré, la rivière fournissait 18 % des repas sans
    // jamais s'épuiser. Aucune rareté ailleurs ne pouvait alors faire voyager
    // qui que ce soit.
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const bank = registry.get('river_bank');
    expect(bank.state.fishLeft).toBeGreaterThan(0);

    const fish = fishAffordance(registry);
    expect(fish.preconditions?.objectState?.fishLeft).toBeDefined();
    expect(fish.effects.object?.fishLeft).toBeLessThan(0);
  });

  it('SE VIDE À MESURE QU’ON PÊCHE, et se refuse une fois vide', () => {
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const fish = fishAffordance(registry);
    const actor = { x: 0, z: 0, inventory: {}, needs: {} };

    const plein = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 3 } };
    expect(checkAffordance(fish, plein, actor).ok).toBe(true);

    const vide = { id: 'river_bank_2', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 0 } };
    const refus = checkAffordance(fish, vide, actor);
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.reason).toContain('fishLeft');
  });

  it('SE REPEUPLE CHAQUE JOUR, sans jamais dépasser sa capacité', () => {
    // Une rivière vidée qui ne se repeuple pas condamnerait le village ; une
    // qui se repeuple sans borne redeviendrait le garde-manger d'avant.
    const world = makeWorld();
    const bank = world.spawn('river_bank', 4, 0);
    const capacity = bank.state.fishLeft!;
    bank.state.fishLeft = 0;

    world.applyDayRegrowth();
    expect(bank.state.fishLeft).toBeGreaterThan(0);
    expect(bank.state.fishLeft).toBeLessThan(capacity);

    for (let jour = 0; jour < 20; jour++) world.applyDayRegrowth();
    expect(bank.state.fishLeft).toBe(capacity);
  });

  it('LAISSE BOIRE SANS COMPTER : une rivière ne manque pas d’eau', () => {
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const drink = registry.get('river_bank').affordances.find((a) => a.verb === 'drink')!;
    const vide = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 0 } };
    expect(checkAffordance(drink, vide, { x: 0, z: 0, inventory: {}, needs: {} }).ok).toBe(true);
  });

  it('reste en deçà de la demande mesurée du village', () => {
    // 4,6 poissons par jour consommés par onze agents, sur deux berges. Une
    // offre soutenable inférieure est ce qui rend la rareté effective — sans
    // elle, la mesure a montré que personne ne s'éloigne de plus de 20 m.
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const rule = registry.get('river_bank').regrowth?.find((r) => r.field === 'fishLeft');
    expect(rule).toBeDefined();
    expect(rule!.perDay * 2).toBeLessThan(4.6);
  });
});
