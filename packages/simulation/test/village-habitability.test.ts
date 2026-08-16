import { describe, it, expect } from 'vitest';
import { DEFAULT_VILLAGE } from '../src/content/scenario';
import {
  WORLD_SIZE,
  heightAt,
  slopeAt,
  isWaterAt,
  isRiverAt,
  landMaskAt,
  VILLAGE_ELEVATION,
} from '../src/world/terrain';
import { biomeAt } from '../src/world/biomes';
import { historicalRiverX } from '../src/world/flow';

/**
 * Garde-fou de migration (spec §6). Les 23 objets, 11 agents et 4 lieux de
 * DEFAULT_VILLAGE sont posés sur du plat par COÏNCIDENCE NUMÉRIQUE : leurs
 * coordonnées tombent dans le disque de rayon 5 du plateau. Rien ne le
 * garantissait. Ce fichier en fait un contrat, pour que le prochain
 * changement de relief échoue ici plutôt que dans le casque.
 */

/** Pente maximale qu'un villageois franchit sans escalader : ~23°. */
const WALKABLE_SLOPE = 0.4;

const sites = [
  ...DEFAULT_VILLAGE.objects.map((o) => ({ label: `object ${o.type}`, x: o.x, z: o.z })),
  ...DEFAULT_VILLAGE.agents.map((a) => ({ label: `agent ${a.id}`, x: a.x, z: a.z })),
  ...DEFAULT_VILLAGE.places.map((p) => ({ label: `place ${p.name}`, x: p.x, z: p.z })),
];

describe('habitabilité du village sur le nouveau relief', () => {
  it('a bien des sites à vérifier', () => {
    expect(sites.length).toBe(23 + 11 + 4);
  });

  it("pose chaque site à l'intérieur de la zone simulée", () => {
    for (const s of sites) {
      expect(Math.abs(s.x), s.label).toBeLessThanOrEqual(WORLD_SIZE / 2);
      expect(Math.abs(s.z), s.label).toBeLessThanOrEqual(WORLD_SIZE / 2);
    }
  });

  it('pose chaque site sur la terre ferme', () => {
    for (const s of sites) {
      expect(landMaskAt(s.x, s.z), s.label).toBeGreaterThan(0.9);
    }
  });

  it("ne noie aucun site, sauf les points d'eau qui doivent l'être", () => {
    for (const s of sites) {
      if (s.label === 'object river_bank') continue;
      expect(isWaterAt(s.x, s.z), s.label).toBe(false);
    }
  });

  it('garde chaque site sur une pente franchissable', () => {
    for (const s of sites) {
      expect(slopeAt(s.x, s.z), s.label).toBeLessThan(WALKABLE_SLOPE);
    }
  });

  it('garde chaque site à une altitude plausible', () => {
    for (const s of sites) {
      const y = heightAt(s.x, s.z);
      expect(y, s.label).toBeGreaterThan(VILLAGE_ELEVATION - 8);
      expect(y, s.label).toBeLessThan(VILLAGE_ELEVATION + 6);
    }
  });

  it("garde les deux points d'eau dans le lit de la rivière", () => {
    const banks = DEFAULT_VILLAGE.objects.filter((o) => o.type === 'river_bank');
    expect(banks.length).toBe(2);
    for (const bank of banks) {
      expect(isRiverAt(bank.x, bank.z), `river_bank(${bank.x}, ${bank.z})`).toBe(true);
    }
  });

  it('laisse un chemin franchissable de chaque campement à la rivière', () => {
    // Un site accessible mais coupé par une falaise vaut un site inaccessible.
    const camps = DEFAULT_VILLAGE.places.filter((p) => p.name.startsWith('camp_'));
    expect(camps.length).toBe(3);
    for (const camp of camps) {
      const targetX = historicalRiverX(camp.z);
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const x = camp.x + ((targetX - camp.x) * i) / steps;
        expect(slopeAt(x, camp.z), `${camp.name} -> rivière @x=${x.toFixed(1)}`).toBeLessThan(
          WALKABLE_SLOPE,
        );
      }
    }
  });

  it('ne classe aucun campement en biome hostile', () => {
    for (const camp of DEFAULT_VILLAGE.places.filter((p) => p.name.startsWith('camp_'))) {
      expect(['ocean', 'alpine', 'rock', 'beach'], camp.name).not.toContain(
        biomeAt(camp.x, camp.z).primary,
      );
    }
  });
});
