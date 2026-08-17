import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { defaultGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import { humanoidBinding } from './fixtures/humanoid-binding';

describe('groundOffsetMeters', () => {
  it('place l os d appui exactement à zéro, à tous les âges', () => {
    const g = defaultGenome(HUMANOID);
    const rig = humanoidBinding();
    for (const age of [0, 3, 7, 12, 18, 40, 70]) {
      const c = compile(HUMANOID, g, age, rig);
      // On recompose la chaîne racine → appui sur la pose COMPILÉE et on
      // vérifie qu'après décalage le pied touche le sol.
      const y = worldYOf(c, rig, HUMANOID.groundRole!);
      expect(y + c.stats.groundOffsetMeters).toBeCloseTo(0, 6);
    }
  });

  it('vaut zéro pour une famille sans os d appui', () => {
    const sansAppui = { ...HUMANOID, groundRole: undefined };
    const c = compile(sansAppui, defaultGenome(HUMANOID), 18, humanoidBinding());
    expect(c.stats.groundOffsetMeters).toBe(0);
  });

  it('descend le pied plus bas chez l adulte que chez le nourrisson', () => {
    const g = defaultGenome(HUMANOID);
    const rig = humanoidBinding();
    const bebe = compile(HUMANOID, g, 0, rig).stats.groundOffsetMeters;
    const adulte = compile(HUMANOID, g, 18, rig).stats.groundOffsetMeters;
    // L offset compense une descente : plus le corps est grand, plus il est grand.
    expect(adulte).toBeGreaterThan(bebe);
  });
});

/** Recompose la chaîne dans le test, indépendamment de l implémentation. */
function worldYOf(
  compiled: ReturnType<typeof compile>,
  binding: ReturnType<typeof humanoidBinding>,
  role: string,
): number {
  const byRole = new Map(compiled.restPose.map((b) => [b.role, b]));
  const chain: string[] = [];
  let cursor: string | null = role;
  while (cursor !== null) {
    chain.unshift(cursor);
    cursor = binding.bones[cursor]?.parentRole ?? null;
  }
  let y = 0;
  let scale = 1;
  for (const r of chain) {
    const bone = byRole.get(r)!;
    y += scale * bone.position[1];
    scale *= bone.scale;
  }
  return y;
}
