import { describe, it, expect } from 'vitest';
import {
  moonPhaseForDay,
  moonIllumination,
  moonPosition,
  moonlightIntensity,
  SYNODIC_MONTH_DAYS,
} from '../src/atmosphere/lunar';
import { solarPosition } from '../src/atmosphere/solar';

describe('moonPhaseForDay', () => {
  it('BOUCLE SUR UN MOIS SYNODIQUE, sans jamais sortir de [0, 1)', () => {
    for (const jour of [0, 1, 14.7, 29.52, 100, 365, 1000]) {
      const p = moonPhaseForDay(jour);
      expect(p, `jour ${jour}`).toBeGreaterThanOrEqual(0);
      expect(p, `jour ${jour}`).toBeLessThan(1);
    }
  });

  it('revient au même point un mois plus tard', () => {
    expect(moonPhaseForDay(10 + SYNODIC_MONTH_DAYS)).toBeCloseTo(moonPhaseForDay(10), 9);
  });
});

describe('moonIllumination', () => {
  it("EST NULLE À LA NOUVELLE LUNE ET PLEINE À LA PLEINE, comme on l'observe", () => {
    expect(moonIllumination(0)).toBeCloseTo(0, 9);
    expect(moonIllumination(0.5)).toBeCloseTo(1, 9);
    expect(moonIllumination(1)).toBeCloseTo(0, 9);
  });

  it('croît puis décroît, sans jamais sortir de [0, 1]', () => {
    let precedent = moonIllumination(0);
    for (let p = 0.05; p <= 0.5; p += 0.05) {
      const v = moonIllumination(p);
      expect(v).toBeGreaterThanOrEqual(precedent - 1e-9);
      expect(v).toBeLessThanOrEqual(1);
      precedent = v;
    }
    expect(moonIllumination(0.75)).toBeLessThan(moonIllumination(0.5));
  });
});

describe('moonPosition', () => {
  it("ACCOMPAGNE LE SOLEIL À LA NOUVELLE LUNE", () => {
    // C'est la définition même de la nouvelle lune : elle est dans la même
    // direction que le soleil, donc invisible.
    const soleil = solarPosition(14, 45);
    const lune = moonPosition(14, 45, 0);
    expect(lune.elevationDeg).toBeCloseTo(soleil.elevationDeg, 9);
    expect(lune.azimuthDeg).toBeCloseTo(soleil.azimuthDeg, 9);
  });

  it('SE LÈVE QUAND LE SOLEIL SE COUCHE À LA PLEINE LUNE', () => {
    // Douze heures de décalage : la lune de minuit occupe la place qu'avait
    // le soleil à midi.
    const soleilMidi = solarPosition(12, 45);
    const luneMinuit = moonPosition(24, 45, 0.5);
    expect(luneMinuit.elevationDeg).toBeCloseTo(soleilMidi.elevationDeg, 6);
  });

  it('EST HAUTE LA NUIT quand elle est pleine — sinon elle ne sert à rien', () => {
    // Le cas qui compte pour le joueur : une pleine lune doit éclairer la
    // nuit, pas se cacher sous l'horizon.
    const lune = moonPosition(0, 45, 0.5);
    const soleil = solarPosition(0, 45);
    expect(soleil.elevationDeg).toBeLessThan(0); // il fait bien nuit
    expect(lune.elevationDeg).toBeGreaterThan(0); // et la lune est levée
  });
});

describe('moonlightIntensity', () => {
  it("N'ÉCLAIRE JAMAIS DE JOUR : le soleil écrase tout", () => {
    expect(moonlightIntensity(30, 40, 0.5)).toBe(0);
  });

  it('est nulle quand la lune est sous l’horizon', () => {
    expect(moonlightIntensity(-20, -5, 0.5)).toBe(0);
  });

  it('DISTINGUE UNE NUIT DE PLEINE LUNE D’UNE NUIT NOIRE', () => {
    // C'est tout l'intérêt : sans cette différence, la phase ne serait qu'un
    // détail de dessin.
    const pleine = moonlightIntensity(-20, 45, 0.5);
    const nouvelle = moonlightIntensity(-20, 45, 0);
    expect(pleine).toBeGreaterThan(0.9);
    expect(nouvelle).toBeCloseTo(0, 6);
  });

  it('éclaire moins quand la lune est basse', () => {
    expect(moonlightIntensity(-20, 10, 0.5)).toBeLessThan(moonlightIntensity(-20, 45, 0.5));
  });

  it('reste dans [0, 1] quelle que soit la hauteur', () => {
    for (const h of [1, 20, 45, 80, 90]) {
      const v = moonlightIntensity(-20, h, 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
