import { describe, it, expect } from 'vitest';
import { BIOME_IDS, biomeAt, humidityAt } from '../src/world/biomes';
import { heightAt, slopeAt, isWaterAt } from '../src/world/terrain';
import { getRiverCourse } from '../src/world/flow';


describe('humidityAt', () => {
  it('reste dans [0, 1] et est déterministe', () => {
    for (let i = 0; i < 200; i++) {
      const v = humidityAt(i * 13.7, i * -9.1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(humidityAt(12, 34)).toBe(humidityAt(12, 34));
  });
});

describe('biomeAt', () => {
  it('rend des poids normalisés à 1', () => {
    for (let x = -900; x <= 900; x += 137) {
      for (let z = -900; z <= 900; z += 137) {
        const sample = biomeAt(x, z);
        const total = BIOME_IDS.reduce((acc, id) => acc + sample.weights[id], 0);
        expect(total).toBeCloseTo(1, 9);
      }
    }
  });

  it('ne rend jamais un poids négatif', () => {
    for (let x = -500; x <= 500; x += 71) {
      const sample = biomeAt(x, 310);
      for (const id of BIOME_IDS) expect(sample.weights[id]).toBeGreaterThanOrEqual(0);
    }
  });

  it('désigne comme primaire le biome de poids maximal', () => {
    for (let x = -400; x <= 400; x += 53) {
      const sample = biomeAt(x, -260);
      const best = BIOME_IDS.reduce((a, b) => (sample.weights[a] >= sample.weights[b] ? a : b));
      expect(sample.primary).toBe(best);
    }
  });

  it('classe le village en terre ferme, jamais en océan', () => {
    expect(biomeAt(0, -2.5).primary).not.toBe('ocean');
    expect(biomeAt(10, 10).primary).not.toBe('ocean');
    expect(biomeAt(-15, 20).primary).not.toBe('ocean');
  });

  it('appelle océan tout point sous le niveau de la mer', () => {
    let checked = 0;
    for (let x = -3000; x <= 3000 && checked < 5; x += 53) {
      for (let z = -3000; z <= 3000 && checked < 5; z += 53) {
        if (isWaterAt(x, z)) {
          expect(biomeAt(x, z).primary).toBe('ocean');
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('réserve alpine aux hautes altitudes', () => {
    for (let x = -1500; x <= 1500; x += 47) {
      for (let z = -1500; z <= 1500; z += 47) {
        if (biomeAt(x, z).primary === 'alpine') expect(heightAt(x, z)).toBeGreaterThan(45);
      }
    }
  });

  it('réserve rock aux fortes pentes', () => {
    for (let x = -1200; x <= 1200; x += 43) {
      for (let z = -1200; z <= 1200; z += 43) {
        if (biomeAt(x, z).primary === 'rock') expect(slopeAt(x, z)).toBeGreaterThan(0.45);
      }
    }
  });

  it('est déterministe', () => {
    expect(biomeAt(321, -654).primary).toBe(biomeAt(321, -654).primary);
  });
});

describe('diversité du classement', () => {
  it('peuple le monde de plusieurs biomes distincts', () => {
    // Sans ce test, un classificateur qui renverrait « prairie » partout
    // passerait tous les autres : ils n'énoncent que des interdits.
    const seen = new Map<string, number>();
    for (let x = -2500; x <= 2500; x += 97) {
      for (let z = -2500; z <= 2500; z += 97) {
        const p = biomeAt(x, z).primary;
        seen.set(p, (seen.get(p) ?? 0) + 1);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(seen.has('beach'), 'la mer doit avoir un rivage').toBe(true);
    // Aucun biome ne doit avaler le monde entier.
    const total = [...seen.values()].reduce((a, b) => a + b, 0);
    for (const [id, count] of seen) {
      expect(count / total, `${id} occupe ${((count / total) * 100).toFixed(0)} %`).toBeLessThan(
        0.8,
      );
    }
  });
});

describe('littoral', () => {
  it('borde la mer de plages, et nulle part ailleurs', () => {
    // Sans ce test, le monde passait de l'ocean a la foret sans un grain de
    // sable : `forest` gagnait parce que ses facteurs saturent, pas parce
    // qu'il decrivait mieux le lieu.
    let beaches = 0;
    for (let x = -2500; x <= 2500; x += 2) {
      for (const z of [0, 300, -700, 1200, -1800]) {
        if (biomeAt(x, z).primary !== 'beach') continue;
        beaches++;
        const h = heightAt(x, z);
        expect(h, `plage a (${x}, ${z})`).toBeGreaterThanOrEqual(0);
        expect(h, `plage a (${x}, ${z})`).toBeLessThan(3.5);
      }
    }
    expect(beaches).toBeGreaterThan(10);
  });

  it('ne met pas de plage au village, qui est a l\'interieur des terres', () => {
    expect(biomeAt(0, -2.5).primary).not.toBe('beach');
    expect(biomeAt(5.5, -3).primary).not.toBe('beach');
    expect(biomeAt(-5.5, -3).primary).not.toBe('beach');
  });
});

describe('marais', () => {
  it('existe quelque part, au bord de l\'eau et en plaine', () => {
    // Un biome declare mais jamais atteint est du code mort qui se donne
    // l'apparence d'une fonctionnalite.
    let found = 0;
    for (const p of getRiverCourse().points) {
      for (let d = -12; d <= 12; d += 2) {
        if (biomeAt(p.x + d, p.z).primary !== 'wetland') continue;
        found++;
        expect(heightAt(p.x + d, p.z), `marais à (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`).toBeLessThan(18);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
