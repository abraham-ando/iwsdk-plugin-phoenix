import { describe, it, expect } from 'vitest';
import { buildVillageSim, type VillageSim } from '../src/content/scenario';

/** Huit jours, par tranches de 100 ticks : le noyau plafonne à 1 000 par appel. */
function simulate(sim: VillageSim, jours: number): Record<string, number> {
  const faits: Record<string, number> = {};
  sim.runtime.subscribeEvents((e) => {
    if (e.type === 'completed') faits[e.verb] = (faits[e.verb] ?? 0) + 1;
  });
  for (let j = 0; j < jours; j++) for (let i = 0; i < 24; i++) sim.kernel.advance(10);
  return faits;
}

describe('en réflexe pur, le village ne fabrique aucun outil', () => {
  it('NE TAILLE NI NE MONTE RIEN, faute de pouvoir planifier si loin', { timeout: 180000 }, () => {
    // Prédiction centrale du sous-projet (spec §5). Ce n'est PAS un défaut :
    // c'est le prix assumé du principe « l'outil multiplie, il ne conditionne
    // jamais ». `knap_flint` et `craft_spear` n'ont aucun effet sur un besoin,
    // donc un gain propre nul dans Mode-1 ; ils n'existent qu'en maillons
    // d'une chaîne de cinq étages, quand Mode-1 s'arrête à trois.
    //
    // Le jour où Mode-1 chaînera plus profond, ou où une délibération tournera
    // dans ces tests, ce test devra être révisé — et son échec sera une bonne
    // nouvelle, non une régression.
    const faits = simulate(buildVillageSim(3), 8);
    expect(faits.knap_flint ?? 0, 'des lames taillées sans délibération').toBe(0);
    expect(faits.craft_spear ?? 0, 'un javelot monté sans délibération').toBe(0);
    expect(faits.fell_tree ?? 0, 'un chêne abattu sans lame').toBe(0);
    expect(faits.hunt_spear ?? 0, 'une chasse au javelot sans javelot').toBe(0);
  });

  it('CONTINUE DE VIVRE malgré tout : les voies à mains nues suffisent', { timeout: 180000 }, () => {
    // La contrepartie du même principe, et la plus importante : le village
    // survit sans outil. Si ce test tombait, la survie dépendrait d'un LLM.
    const faits = simulate(buildVillageSim(3), 8);
    expect(faits.gather_wood ?? 0, 'du bois ramassé').toBeGreaterThan(0);
    expect(faits.hunt ?? 0, 'de la chasse à mains nues').toBeGreaterThan(0);
    expect(faits.eat_berries ?? 0, 'des repas').toBeGreaterThan(0);
  });

  it('LE BUDGET PAR TICK TIENT malgré six affordances de plus', { timeout: 180000 }, () => {
    // Le coût de selectAction croît avec le nombre d'affordances par objet cru.
    // Généreux d'un facteur cinq : ce banc retient un effondrement, pas une
    // fluctuation de machine.
    const sim = buildVillageSim(5);
    const t0 = performance.now();
    for (let i = 0; i < 24; i++) sim.kernel.advance(10);
    const elapsed = performance.now() - t0;
    expect(elapsed, `une journée a pris ${elapsed.toFixed(0)} ms`).toBeLessThan(20000);
  });
});
