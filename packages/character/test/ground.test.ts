import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { defaultGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import { humanoidBinding } from './fixtures/humanoid-binding';
import type { FamilyDescriptor } from '../src/family/types';
import type { RigBinding } from '../src/compile/types';

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

  it('compose les ROTATIONS de la chaîne, pas seulement les translations', () => {
    // La racine tourne d'un quart de tour autour de X, donc le -Y local du pied
    // part sur -Z et ne descend pas : l'appui reste à y = 1, et l'offset vaut -1.
    // Une somme naïve de translations donnerait 1 + (-1) = 0.
    const c = compile(PLIE, { family: 'plie', genes: { stature: 0.5 } }, 18, plieBinding());
    expect(c.stats.groundOffsetMeters).toBeCloseTo(-1, 6);
  });
});

/**
 * Famille minimale à deux os, dont la racine porte un quart de tour autour de X.
 * Sans composition des rotations, une simple somme de translations donnerait 0 ;
 * avec, la hauteur de l'appui reste 1. C'est le seul test qui distingue les deux.
 */
const PLIE: FamilyDescriptor = {
  id: 'plie',
  adultAge: 18,
  rootRole: 'root',
  headRole: 'root',
  groundRole: 'pied',
  bones: { root: ['Root'], pied: ['Pied'] },
  chains: {},
  morphs: {},
  proportions: { headToBody: [[0, 1]], limbToTorso: [[0, 1]], bodyScale: [[0, 1]] },
  slots: {},
  genes: { stature: { group: 'structure', heritability: 1, dominance: 0.5, mutationRate: 0 } },
};

const RX90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

function plieBinding(): RigBinding {
  return {
    family: 'plie',
    restHeightMeters: 1,
    morphIndex: {},
    bones: {
      root: { role: 'root', parentRole: null, position: [0, 1, 0], rotation: [...RX90] },
      pied: { role: 'pied', parentRole: 'root', position: [0, -1, 0], rotation: [0, 0, 0, 1] },
    },
  };
}

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
