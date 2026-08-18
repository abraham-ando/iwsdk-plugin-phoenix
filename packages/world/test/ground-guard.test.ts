import { describe, it, expect } from 'vitest';
import {
  groundGuardY,
  GROUND_GUARD_MARGIN,
  GROUND_GUARD_CLEARANCE,
} from '../src/terrain/groundGuard';
import { heightAt } from '@iwsdk/cardinal-simulation';

describe('groundGuardY', () => {
  it('RATTRAPE CE QUI EST PASSÉ SOUS LE SOL', () => {
    // Le joueur est tombé à −3 192 m, et tombait encore. Le terrain est streamé
    // par tuiles ; entre l'arrivée quelque part et l'existence de sa tuile, il
    // n'y a rien sous les pieds. L'altitude, elle, est connue partout.
    const [x, z] = [0, 0];
    expect(groundGuardY(x, -3192, z)).toBeCloseTo(heightAt(x, z) + GROUND_GUARD_CLEARANCE, 6);
  });

  it('NE TOUCHE À RIEN quand on est au-dessus du sol', () => {
    // Une écriture par image, même identique, se paierait en invalidations de
    // transformation : `null` dit à l'appelant de ne rien faire.
    const [x, z] = [12, -8];
    expect(groundGuardY(x, heightAt(x, z) + 10, z)).toBeNull();
    expect(groundGuardY(x, heightAt(x, z), z)).toBeNull();
  });

  it("LAISSE LA MARGE, pour ne pas contrarier un saut ni une dépression", () => {
    const [x, z] = [4, 4];
    const sol = heightAt(x, z);
    expect(groundGuardY(x, sol - GROUND_GUARD_MARGIN + 0.1, z)).toBeNull();
    expect(groundGuardY(x, sol - GROUND_GUARD_MARGIN - 0.1, z)).toBeCloseTo(sol + GROUND_GUARD_CLEARANCE, 6);
  });

  it('vaut PARTOUT dans la zone navigable, tuiles ou pas', () => {
    // ±200 m depuis l'écologie E1, quand l'anneau de tuiles n'en couvre qu'une
    // partie autour du joueur.
    for (const [x, z] of [[199, 199], [-199, -199], [0, 180], [-150, 60]] as const) {
      expect(groundGuardY(x, -500, z), `${x},${z}`).toBeCloseTo(heightAt(x, z) + GROUND_GUARD_CLEARANCE, 6);
    }
  });

  it('rattrape au sol, jamais en dessous ni au-dessus', () => {
    const [x, z] = [-30, 22];
    const rattrape = groundGuardY(x, -1000, z);
    expect(rattrape).not.toBeNull();
    // AU-DESSUS du sol, jamais dessus : reposer pile à la surface relance la
    // chute, et le garde-fou boucle au lieu de sauver.
    expect(rattrape).toBe(heightAt(x, z) + GROUND_GUARD_CLEARANCE);
    expect(rattrape!).toBeGreaterThan(heightAt(x, z));
  });
});
