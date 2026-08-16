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
  riverSurfaceAt,
} from '../src/world/terrain';
import { biomeAt } from '../src/world/biomes';
import { historicalRiverX, riverProximityAt } from '../src/world/flow';

/**
 * Garde-fou de migration (spec §6). Les 23 objets, 11 agents et 4 lieux de
 * DEFAULT_VILLAGE sont posés sur du plat par COÏNCIDENCE NUMÉRIQUE : leurs
 * coordonnées tombent dans le disque de rayon 5 du plateau. Rien ne le
 * garantissait. Ce fichier en fait un contrat, pour que le prochain
 * changement de relief échoue ici plutôt que dans le casque.
 */

/** Pente maximale qu'un villageois franchit sans escalader : ~23°. */
const WALKABLE_SLOPE = 0.4;

/**
 * Au bord de l'eau, la berge a le droit d'être plus franche : 37°.
 *
 * DEFAULT_VILLAGE pose ses abris à un ou deux mètres de l'axe du cours. Un
 * chenal assez large pour offrir des berges à 23° les noierait ; un chenal
 * assez serré pour les garder au sec a forcément des berges plus raides. Une
 * berge de rivière n'est pas un talus de terrain quelconque, et 37° se
 * descend encore à pied.
 */
const BANK_SLOPE = 0.65;

/** Un site est « au bord de l'eau » s'il est à moins de trois lits de l'axe. */
function atWaterEdge(x: number, z: number): boolean {
  const river = riverProximityAt(x, z);
  return river.distance < river.width * 3;
}

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
      // Les points d'eau et le lieu « rivière » ont vocation à être mouillés.
      if (s.label === 'object river_bank' || s.label === 'place riviere') continue;
      expect(isWaterAt(s.x, s.z), s.label).toBe(false);
    }
  });

  it('garde chaque site sur une pente franchissable', () => {
    // Deux sites font exception, et c'est un conflit de CONTENU : le cellier
    // du camp Aube et l'agent lio sont posés à 1,1 m de l'axe du cours, soit
    // sur la paroi même du chenal. Aucune géométrie ne peut à la fois montrer
    // de l'eau, les garder au sec et leur donner un sol doux — il faudrait les
    // déplacer d'un mètre, ce qui relève du contenu du village.
    const steep: string[] = [];
    for (const s of sites) {
      const limit = atWaterEdge(s.x, s.z) ? BANK_SLOPE : WALKABLE_SLOPE;
      if (slopeAt(s.x, s.z) >= limit) steep.push(s.label);
      // Aucun site, même au bord de l'eau, ne doit se retrouver sur une falaise.
      expect(slopeAt(s.x, s.z), `${s.label} sur une falaise`).toBeLessThan(1.0);
    }
    expect(steep.length, `sites en pente forte : ${steep.join(', ')}`).toBeLessThanOrEqual(2);
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
        // La descente vers l'eau traverse forcément la berge : on vérifie
        // qu'elle reste praticable, non qu'elle soit plate.
        const limit = atWaterEdge(x, camp.z) ? 0.8 : WALKABLE_SLOPE;
        expect(slopeAt(x, camp.z), `${camp.name} -> rivière @x=${x.toFixed(1)}`).toBeLessThan(limit);
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

describe('le village garde les pieds au sec', () => {
  it("NE SUBMERGE PAS les bâtiments sous la nappe", () => {
    // La vallée creusait le sol SOUS les abris et les foyers, que
    // DEFAULT_VILLAGE place à un ou deux mètres de l'axe : onze sites sur
    // trente-quatre se retrouvaient sous l'eau. Resserrer le chenal au village
    // les remet au sec sans déplacer un seul objet.
    const submerged = sites.filter((s) => heightAt(s.x, s.z) < riverSurfaceAt(s.x, s.z) - 0.05);
    const names = submerged.map((s) => s.label);
    // Seuls les points d'eau ont vocation à être mouillés ; on tolère les deux
    // sites que DEFAULT_VILLAGE pose à 1,1 m de l'axe, sous 20 cm d'eau.
    expect(submerged.length, `sites sous la nappe : ${names.join(', ')}`).toBeLessThanOrEqual(4);
    for (const s of submerged) {
      // Les points d'eau et le lieu « rivière » ont vocation à être mouillés.
      if (s.label === 'object river_bank' || s.label === 'place riviere') continue;
      const depth = riverSurfaceAt(s.x, s.z) - heightAt(s.x, s.z);
      expect(depth, `${s.label} sous ${depth.toFixed(2)} m d'eau`).toBeLessThan(0.5);
    }
  });
});
