import { describe, it, expect } from 'vitest';
import { starPositions, starBrightness, skyDirection } from '../src/atmosphere/nightSkyGeometry';

describe('starPositions', () => {
  it('EST DÉTERMINISTE : deux sessions voient la même voûte', () => {
    // Un Math.random() par étoile donnerait un ciel différent à chaque
    // chargement, et personne ne s'en apercevrait avant longtemps.
    expect(Array.from(starPositions(50, 900))).toEqual(Array.from(starPositions(50, 900)));
  });

  it('POSE CHAQUE ÉTOILE SUR LA SPHÈRE, à son rayon', () => {
    const p = starPositions(200, 900);
    for (let i = 0; i < 200; i++) {
      const r = Math.hypot(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
      expect(r, `étoile ${i}`).toBeCloseTo(900, 3);
    }
  });

  it("NE GARDE QUE LE CIEL VISIBLE : aucune étoile sous l'horizon", () => {
    const p = starPositions(300, 900);
    for (let i = 0; i < 300; i++) expect(p[i * 3 + 1], `étoile ${i}`).toBeGreaterThanOrEqual(0);
  });

  it("NE S'AGGLUTINE PAS AU ZÉNITH, ce que l'œil repère aussitôt", () => {
    // Répartition par aire égale : la moitié des étoiles doit se trouver
    // sous 60° d'élévation, qui est la moitié de l'aire de l'hémisphère.
    const n = 2000;
    const p = starPositions(n, 1);
    let basses = 0;
    for (let i = 0; i < n; i++) if (p[i * 3 + 1]! < 0.5) basses++;
    expect(basses / n).toBeGreaterThan(0.4);
    expect(basses / n).toBeLessThan(0.6);
  });
});

describe('starBrightness', () => {
  it('varie sans jamais éteindre ni saturer', () => {
    const b = starBrightness(500);
    expect(Math.min(...b)).toBeGreaterThanOrEqual(0.35);
    expect(Math.max(...b)).toBeLessThanOrEqual(1);
    expect(new Set(b).size).toBeGreaterThan(100); // pas un ciel uniforme
  });
});

describe('skyDirection', () => {
  it('MET LE ZÉNITH EN HAUT', () => {
    const [x, y, z] = skyDirection(90, 0, 900);
    expect(y).toBeCloseTo(900, 3);
    expect(Math.hypot(x, z)).toBeCloseTo(0, 3);
  });

  it("PLACE LE NORD EN -Z ET L'EST EN +X, comme le repère du monde", () => {
    // solarPosition compte l'azimut depuis le nord vers l'est ; se tromper
    // ici ferait lever la lune à l'ouest, et rien ne le signalerait.
    const nord = skyDirection(0, 0, 100);
    expect(nord[2]).toBeCloseTo(-100, 3);
    const est = skyDirection(0, 90, 100);
    expect(est[0]).toBeCloseTo(100, 3);
  });

  it("descend sous l'horizon quand l'élévation est négative", () => {
    expect(skyDirection(-30, 180, 900)[1]).toBeLessThan(0);
  });
});
