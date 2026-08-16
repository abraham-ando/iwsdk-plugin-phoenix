import { describe, it, expect } from 'vitest';
import { buildVillageSim, type VillageSim } from '../src/content/scenario';
import { MAX_OBJECT_BELIEFS } from '../src/agents/BeliefState';
import { MAX_PLACE_BELIEFS } from '../src/agents/PlaceMemory';

/**
 * Une journée entière, 2 400 ticks, par tranches de 100 : le noyau plafonne
 * à 1 000 ticks par appel et remet son accumulateur à zéro au-delà, si bien
 * qu'un seul advance(240) n'en simulerait qu'un millier.
 */
function simulateOneDay(sim: VillageSim): void {
  for (let i = 0; i < 24; i++) sim.kernel.advance(10);
}

describe('tenue en charge du monde peuplé', () => {
  it("LA MÉMOIRE D'UN AGENT RESTE BORNÉE APRÈS UNE JOURNÉE ENTIÈRE", { timeout: 60000 }, () => {
    // Le défaut que ce banc retient : sans borne, Mode-1 note toutes les
    // croyances à chaque décision, et le coût passe de 4 à 88 ms par seconde
    // simulée — sur le fil principal d'une application VR.
    const sim = buildVillageSim(3);
    simulateOneDay(sim);
    for (const agent of sim.runtime.agents.values()) {
      expect(
        agent.beliefs.known().length,
        `${agent.profile.id} : ${agent.beliefs.known().length} croyances`
      ).toBeLessThanOrEqual(MAX_OBJECT_BELIEFS);
      expect(agent.places.all().length).toBeLessThanOrEqual(MAX_PLACE_BELIEFS);
    }
  });

  it('LES AGENTS APPRENNENT DES LIEUX EN VAQUANT À LEURS BESOINS', { timeout: 60000 }, () => {
    // Sans exploration délibérée : ils retiennent ce qu'ils traversent. Si
    // personne n'apprend rien, l'enregistrement par tick n'est pas branché.
    const sim = buildVillageSim(3);
    simulateOneDay(sim);
    const learned = [...sim.runtime.agents.values()].reduce((n, a) => n + a.places.all().length, 0);
    expect(learned).toBeGreaterThan(0);
  });

  it('AUCUN AGENT NE SORT DU MONDE', { timeout: 60000 }, () => {
    const sim = buildVillageSim(3);
    simulateOneDay(sim);
    for (const agent of sim.runtime.agents.values()) {
      expect(Math.abs(agent.x), `${agent.profile.id} en x`).toBeLessThanOrEqual(200.001);
      expect(Math.abs(agent.z), `${agent.profile.id} en z`).toBeLessThanOrEqual(200.001);
    }
  });

  it('UNE JOURNÉE SIMULÉE TIENT DANS SON BUDGET', { timeout: 60000 }, () => {
    // 2 400 ticks représentent une journée. Le moteur tourne sur le fil
    // principal d'une application dont le budget d'image est de 11 ms ; une
    // journée doit rester très en deçà des dizaines de secondes.
    const sim = buildVillageSim(5);
    const t0 = performance.now();
    simulateOneDay(sim);
    const elapsed = performance.now() - t0;
    // Généreux d'un facteur cinq : ce banc retient un effondrement, pas une
    // fluctuation de machine.
    expect(elapsed, `une journée a pris ${elapsed.toFixed(0)} ms`).toBeLessThan(20000);
  });

  it('LE LOUP TROUVE ENCORE SES PROIES DANS LE MONDE ÉLARGI', () => {
    const sim = buildVillageSim(3);
    expect(sim.world.objectsOfType('hunting_ground').length).toBeGreaterThan(0);
  });
});
