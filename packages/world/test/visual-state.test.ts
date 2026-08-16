import { describe, it, expect } from 'vitest';
import { visualStateFor, VISUAL_TYPES } from '../src/objects/visualState';

describe('visualStateFor', () => {
  it("rend un état neutre pour un type qu'il ne connaît pas", () => {
    // Un type inconnu ne doit rien casser : il s'affiche tel qu'il a été bâti.
    const v = visualStateFor('inconnu', {});
    expect(v.stage).toBe(0);
    expect(v.stageCount).toBe(1);
    expect(v.fill).toBe(1);
  });

  it("rend un remplissage borné à [0, 1] quel que soit l'état", () => {
    // Les états viennent du moteur ; une régénération pourrait les dépasser.
    for (const type of VISUAL_TYPES) {
      for (const value of [-5, 0, 3, 999]) {
        const v = visualStateFor(type, {
          berriesLeft: value,
          flintLeft: value,
          woodLeft: value,
          progress: value,
          fuel: value,
          berries: value,
          wood: value,
        });
        expect(v.fill, `${type} à ${value}`).toBeGreaterThanOrEqual(0);
        expect(v.fill, `${type} à ${value}`).toBeLessThanOrEqual(1);
      }
    }
  });

  describe('abri', () => {
    it('SUIT LA CONSTRUCTION, étape par étape', () => {
      // progress va de 0 à 5 dans le moteur ; la construction doit se voir
      // avancer, sans quoi bâtir ne produit aucun retour visible.
      const stages = [0, 1, 2, 3, 4, 5].map((p) => visualStateFor('shelter', { progress: p }).stage);
      expect(stages).toEqual([0, 1, 2, 3, 4, 5]);
      expect(visualStateFor('shelter', { progress: 0 }).stageCount).toBe(6);
    });

    it('ne dépasse pas la dernière étape même si le moteur va plus loin', () => {
      expect(visualStateFor('shelter', { progress: 9 }).stage).toBe(5);
    });
  });

  describe('foyer', () => {
    it("n'est allumé que lorsque le moteur le dit", () => {
      expect(visualStateFor('campfire', { lit: 0, fuel: 5 }).lit).toBe(false);
      expect(visualStateFor('campfire', { lit: 1, fuel: 5 }).lit).toBe(true);
    });

    it('porte une flamme dont la taille suit le combustible', () => {
      const low = visualStateFor('campfire', { lit: 1, fuel: 1 }).flame;
      const high = visualStateFor('campfire', { lit: 1, fuel: 10 }).flame;
      expect(high).toBeGreaterThan(low);
      expect(low).toBeGreaterThan(0);
    });

    it("n'a aucune flamme quand il est éteint", () => {
      expect(visualStateFor('campfire', { lit: 0, fuel: 10 }).flame).toBe(0);
    });
  });

  describe("ressources qui s'épuisent", () => {
    it('vide le buisson à mesure des cueillettes', () => {
      expect(visualStateFor('berry_bush', { berriesLeft: 12 }).fill).toBe(1);
      expect(visualStateFor('berry_bush', { berriesLeft: 6 }).fill).toBeCloseTo(0.5, 6);
      expect(visualStateFor('berry_bush', { berriesLeft: 0 }).fill).toBe(0);
    });

    it("entame l'affleurement de silex", () => {
      expect(visualStateFor('flint_deposit', { flintLeft: 6 }).fill).toBe(1);
      expect(visualStateFor('flint_deposit', { flintLeft: 3 }).fill).toBeCloseTo(0.5, 6);
    });

    it('dégarnit le chêne', () => {
      expect(visualStateFor('oak_tree', { woodLeft: 8 }).fill).toBe(1);
      expect(visualStateFor('oak_tree', { woodLeft: 2 }).fill).toBeCloseTo(0.25, 6);
    });
  });

  describe('provisions', () => {
    it('MONTE AVEC LA RÉSERVE, baies et bois confondus', () => {
      // Le tas de provisions doit refléter ce que le village a mis de côté :
      // c'est le seul retour visible sur une journée de cueillette.
      const empty = visualStateFor('camp_storage', { berries: 0, wood: 0 }).fill;
      const some = visualStateFor('camp_storage', { berries: 4, wood: 2 }).fill;
      const full = visualStateFor('camp_storage', { berries: 20, wood: 20 }).fill;
      expect(empty).toBe(0);
      expect(some).toBeGreaterThan(empty);
      expect(full).toBeGreaterThan(some);
    });
  });
});
