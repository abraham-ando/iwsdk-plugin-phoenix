import { describe, it, expect } from 'vitest';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { checkAffordance, applyAffordance } from '../src/world/affordances';

function registry(): SmartObjectRegistry {
  const r = new SmartObjectRegistry();
  registerDefaultContent(r);
  return r;
}

function affordance(type: string, verb: string) {
  const def = registry()
    .get(type)
    .affordances.find((a) => a.verb === verb);
  expect(def, `${type} n'a pas de verbe ${verb}`).toBeDefined();
  return def!;
}

const acteur = (inventory: Record<string, number> = {}) => ({
  x: 0,
  z: 0,
  inventory,
  needs: { hunger: 80, warmth: 80, energy: 80, affection: 80, stress: 0 },
});

describe('la lame de silex sert enfin à quelque chose', () => {
  it('ABATTRE REND TROIS FOIS PLUS QUE RAMASSER, et use la lame', () => {
    // `flint_blade` était produit par knap_flint et consommé par personne :
    // une chaîne d'artisanat qui s'arrêtait à son premier maillon.
    const chene = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 8 } };
    const acteurAvecLame = acteur({ flint_blade: 1 });

    const abattre = affordance('oak_tree', 'fell_tree');
    expect(checkAffordance(abattre, chene, acteurAvecLame).ok).toBe(true);
    applyAffordance(abattre, chene, acteurAvecLame);

    expect(acteurAvecLame.inventory.wood).toBe(3);
    expect(acteurAvecLame.inventory.flint_blade).toBe(0); // la lame s'est usée
    expect(chene.state.woodLeft).toBe(5);
  });

  it('LAISSE TOUJOURS RAMASSER À MAINS NUES', () => {
    // Le principe directeur : l'outil multiplie, il ne conditionne jamais.
    // Sans cette voie, la survie dépendrait d'une délibération — donc d'un
    // service externe qui peut être éteint.
    const chene = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 8 } };
    const nu = acteur();
    const ramasser = affordance('oak_tree', 'gather_wood');
    expect(checkAffordance(ramasser, chene, nu).ok).toBe(true);
    applyAffordance(ramasser, chene, nu);
    expect(nu.inventory.wood).toBe(1);
  });

  it("REFUSE D'ABATTRE SANS LAME, et le dit", () => {
    const chene = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 8 } };
    const refus = checkAffordance(affordance('oak_tree', 'fell_tree'), chene, acteur());
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.reason).toContain('flint_blade');
  });

  it('RIEN NE SE CRÉE : un chêne presque vide ne rend pas trois bois', () => {
    // applyAffordance borne les états à zéro, ce qui protège l'objet mais non
    // le bilan : sans précondition, deux bois restants en donneraient trois.
    const presqueVide = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 2 } };
    const refus = checkAffordance(
      affordance('oak_tree', 'fell_tree'),
      presqueVide,
      acteur({ flint_blade: 1 })
    );
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.reason).toContain('woodLeft');
  });

  it("UN ROGNON DONNE TROIS LAMES : c'est l'usure qui crée la demande", () => {
    // Sans plusieurs lames par rognon, chaque abattage renverrait tailler,
    // et le silex du village s'épuiserait en une journée.
    const berge = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 6 } };
    const tailleur = acteur({ flint: 1 });
    applyAffordance(affordance('river_bank', 'knap_flint'), berge, tailleur);
    expect(tailleur.inventory.flint_blade).toBe(3);
    expect(tailleur.inventory.flint).toBe(0);
  });

  it('la boucle se ferme : trois abattages épuisent un rognon', () => {
    const berge = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 6 } };
    const chene = { id: 'oak_tree_1', type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 40 } };
    const bucheron = acteur({ flint: 1 });
    applyAffordance(affordance('river_bank', 'knap_flint'), berge, bucheron);

    const abattre = affordance('oak_tree', 'fell_tree');
    for (let i = 0; i < 3; i++) {
      expect(checkAffordance(abattre, chene, bucheron).ok, `abattage ${i + 1}`).toBe(true);
      applyAffordance(abattre, chene, bucheron);
    }
    expect(bucheron.inventory.flint_blade).toBe(0);
    expect(bucheron.inventory.wood).toBe(9);
    expect(checkAffordance(abattre, chene, bucheron).ok).toBe(false);
  });
});

describe('le javelot, deuxième chaîne', () => {
  it("SE FABRIQUE D'UNE LAME ET D'UN BOIS, et les consomme", () => {
    const berge = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 6 } };
    const artisan = acteur({ flint_blade: 1, wood: 1 });
    const fabriquer = affordance('river_bank', 'craft_spear');

    expect(checkAffordance(fabriquer, berge, artisan).ok).toBe(true);
    applyAffordance(fabriquer, berge, artisan);

    expect(artisan.inventory.spear).toBe(1);
    expect(artisan.inventory.flint_blade).toBe(0);
    expect(artisan.inventory.wood).toBe(0);
  });

  it('ne se fabrique pas avec une lame seule', () => {
    const berge = { id: 'river_bank_1', type: 'river_bank', x: 0, z: 0, state: { fishLeft: 6 } };
    const refus = checkAffordance(
      affordance('river_bank', 'craft_spear'),
      berge,
      acteur({ flint_blade: 1 })
    );
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.reason).toContain('wood');
  });

  it('REND TROIS FOIS PLUS DE VIANDE POUR UNE MÊME BÊTE', () => {
    // Le javelot ne donne pas plus d'animaux : il en tire davantage. Le stock
    // du terrain baisse d'une unité dans les deux cas, ce qui interdit à
    // l'outil de multiplier la ressource elle-même.
    const terrain = { id: 'hunting_ground_1', type: 'hunting_ground', x: 0, z: 0, state: { gameLeft: 5 } };
    const chasseur = acteur({ spear: 1 });
    applyAffordance(affordance('hunting_ground', 'hunt_spear'), terrain, chasseur);

    expect(chasseur.inventory.meat).toBe(3);
    expect(chasseur.inventory.spear).toBe(0); // le javelot se brise
    expect(terrain.state.gameLeft).toBe(4);
  });

  it('LAISSE TOUJOURS CHASSER À MAINS NUES', () => {
    const terrain = { id: 'hunting_ground_1', type: 'hunting_ground', x: 0, z: 0, state: { gameLeft: 5 } };
    const nu = acteur();
    expect(checkAffordance(affordance('hunting_ground', 'hunt'), terrain, nu).ok).toBe(true);
    applyAffordance(affordance('hunting_ground', 'hunt'), terrain, nu);
    expect(nu.inventory.meat).toBe(1);
  });

  it('refuse le javelot sur un terrain vide, comme la chasse à mains nues', () => {
    const vide = { id: 'hunting_ground_1', type: 'hunting_ground', x: 0, z: 0, state: { gameLeft: 0 } };
    expect(
      checkAffordance(affordance('hunting_ground', 'hunt_spear'), vide, acteur({ spear: 1 })).ok
    ).toBe(false);
    expect(checkAffordance(affordance('hunting_ground', 'hunt'), vide, acteur()).ok).toBe(false);
  });
});
