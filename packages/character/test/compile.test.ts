import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { defaultGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import { humanoidBinding as binding } from './fixtures/humanoid-binding';

const norme = (v: readonly [number, number, number]) => Math.hypot(v[0], v[1], v[2]);
const trouve = (c: ReturnType<typeof compile>, role: string) =>
  c.restPose.find((b) => b.role === role)!;

describe('compile — génome neutre', () => {
  it('laisse un adulte médian identique à son rig de repos', () => {
    const c = compile(HUMANOID, defaultGenome(HUMANOID), 18, binding());
    for (const bone of c.restPose) {
      const original = binding().bones[bone.role]!;
      expect(norme(bone.position)).toBeCloseTo(norme(original.position), 6);
      expect(bone.scale).toBeCloseTo(1, 6);
    }
  });

  it('rend la hauteur du rig de repos', () => {
    const c = compile(HUMANOID, defaultGenome(HUMANOID), 18, binding());
    expect(c.stats.nominalHeightMeters).toBeCloseTo(1.75, 3);
  });

  it('demande toujours un recalcul des matrices inverses', () => {
    expect(compile(HUMANOID, defaultGenome(HUMANOID), 18, binding()).rebindSkeleton).toBe(true);
  });
});

describe('compile — invariants géométriques', () => {
  it('n émet JAMAIS d échelle non uniforme : le scale est un scalaire', () => {
    const c = compile(HUMANOID, defaultGenome(HUMANOID), 6, binding());
    for (const bone of c.restPose) {
      expect(typeof bone.scale).toBe('number');
      expect(Number.isFinite(bone.scale)).toBe(true);
      expect(bone.scale).toBeGreaterThan(0);
    }
  });

  it('conserve la direction de chaque os et n en change que la longueur', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, armLength: 1 } };
    const c = compile(HUMANOID, g, 18, binding());
    const avant = binding().bones['foreArmL']!.position;
    const après = trouve(c, 'foreArmL').position;
    // Colinéaires et de même sens : produit vectoriel nul, produit scalaire positif.
    const croix = Math.hypot(
      avant[1] * après[2] - avant[2] * après[1],
      avant[2] * après[0] - avant[0] * après[2],
      avant[0] * après[1] - avant[1] * après[0],
    );
    expect(croix).toBeCloseTo(0, 9);
    expect(avant[0] * après[0] + avant[1] * après[1] + avant[2] * après[2]).toBeGreaterThan(0);
  });

  it('borne un gène hors plage au lieu de réfléchir l os', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, armLength: -2 } };
    const c = compile(HUMANOID, g, 18, binding());
    for (const bone of c.restPose) expect(bone.scale).toBeGreaterThan(0);
    // -2 est ramené à 0, donc le facteur le plus court possible, jamais négatif.
    const avant = binding().bones['foreArmL']!.position;
    const après = trouve(c, 'foreArmL').position;
    expect(après[0] / avant[0]).toBeGreaterThan(0);
  });
});

describe('compile — les gènes agissent', () => {
  it('un gène de bras à 1 allonge le bras, à 0 le raccourcit', () => {
    const base = defaultGenome(HUMANOID).genes;
    const court = compile(HUMANOID, { family: 'humanoid', genes: { ...base, armLength: 0 } }, 18, binding());
    const long = compile(HUMANOID, { family: 'humanoid', genes: { ...base, armLength: 1 } }, 18, binding());
    expect(norme(trouve(long, 'foreArmL').position))
      .toBeGreaterThan(norme(trouve(court, 'foreArmL').position));
  });

  it('applique la chaîne miroir à l identique', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, armLength: 0.9 } };
    const c = compile(HUMANOID, g, 18, binding());
    expect(norme(trouve(c, 'foreArmL').position))
      .toBeCloseTo(norme(trouve(c, 'foreArmR').position), 9);
  });

  it('ne touche pas à l os de départ d une chaîne', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, armLength: 1 } };
    const c = compile(HUMANOID, g, 18, binding());
    expect(norme(trouve(c, 'shoulderL').position))
      .toBeCloseTo(norme(binding().bones['shoulderL']!.position), 9);
  });
});

describe('compile — l âge', () => {
  it('un nourrisson est bien plus petit qu un adulte', () => {
    const g = defaultGenome(HUMANOID);
    const bébé = compile(HUMANOID, g, 0, binding());
    const adulte = compile(HUMANOID, g, 18, binding());
    expect(bébé.stats.nominalHeightMeters).toBeLessThan(adulte.stats.nominalHeightMeters * 0.35);
  });

  it('la tête d un nourrisson est proportionnellement bien plus grosse', () => {
    const g = defaultGenome(HUMANOID);
    const bébé = trouve(compile(HUMANOID, g, 0, binding()), 'head');
    const adulte = trouve(compile(HUMANOID, g, 18, binding()), 'head');
    // 0.25 / 0.133 ≈ 1.88
    expect(bébé.scale / adulte.scale).toBeGreaterThan(1.7);
    expect(bébé.scale / adulte.scale).toBeLessThan(2.1);
  });

  it('la taille croît de façon monotone jusqu à l âge adulte', () => {
    const g = defaultGenome(HUMANOID);
    let précédente = 0;
    for (let age = 0; age <= 18; age += 1) {
      const h = compile(HUMANOID, g, age, binding()).stats.nominalHeightMeters;
      expect(h).toBeGreaterThanOrEqual(précédente);
      précédente = h;
    }
  });
});

describe('compile — visage et surface', () => {
  it('ne rend que les morphs déclarés ET présents dans la liaison', () => {
    const b = binding();
    delete (b.morphIndex as Record<string, number>)['cheekbone'];
    const c = compile(HUMANOID, defaultGenome(HUMANOID), 18, b);
    expect(Object.keys(c.morphs)).not.toContain('cheekbone');
    expect(Object.keys(c.morphs)).toContain('jawWidth');
  });

  it('projette un gène [0,1] dans la plage déclarée du morph', () => {
    const base = defaultGenome(HUMANOID).genes;
    // jawWidth a pour plage [-1, 1] : un gène à 0 doit donner -1, à 1 donner 1.
    const bas = compile(HUMANOID, { family: 'humanoid', genes: { ...base, jawWidth: 0 } }, 18, binding());
    const haut = compile(HUMANOID, { family: 'humanoid', genes: { ...base, jawWidth: 1 } }, 18, binding());
    expect(bas.morphs['jawWidth']).toBeCloseTo(-1, 6);
    expect(haut.morphs['jawWidth']).toBeCloseTo(1, 6);
  });

  it('reporte les tons de surface tels quels, sans les convertir en couleur', () => {
    const g = { family: 'humanoid', genes: { ...defaultGenome(HUMANOID).genes, skinTone: 0.8 } };
    expect(compile(HUMANOID, g, 18, binding()).surface.skinTone).toBeCloseTo(0.8, 6);
  });
});

describe('compile — rejets', () => {
  it('refuse une liaison d une autre famille', () => {
    const b = { ...binding(), family: 'canid' };
    expect(() => compile(HUMANOID, defaultGenome(HUMANOID), 18, b)).toThrow('canid');
  });

  it('refuse une liaison à laquelle il manque un os de chaîne', () => {
    const b = binding();
    delete (b.bones as Record<string, unknown>)['foreArmL'];
    expect(() => compile(HUMANOID, defaultGenome(HUMANOID), 18, b)).toThrow('foreArmL');
  });
});
