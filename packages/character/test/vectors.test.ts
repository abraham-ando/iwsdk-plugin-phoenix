import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HUMANOID } from '../src/family/humanoid';
import { createGenome } from '../src/genome/create';
import { compile } from '../src/compile/compile';
import type { RigBinding } from '../src/compile/types';
import type { RngLike } from '../src/genome/types';

const BINDING: RigBinding = {
  family: 'humanoid',
  restHeightMeters: 1.75,
  morphIndex: { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 },
  bones: {
    root: { role: 'root', parentRole: null, position: [0, 0.95, 0], rotation: [0, 0, 0, 1] },
    spine: { role: 'spine', parentRole: 'root', position: [0, 0.12, 0], rotation: [0, 0, 0, 1] },
    chest: { role: 'chest', parentRole: 'spine', position: [0, 0.14, 0], rotation: [0, 0, 0, 1] },
    neck: { role: 'neck', parentRole: 'chest', position: [0, 0.16, 0], rotation: [0, 0, 0, 1] },
    head: { role: 'head', parentRole: 'neck', position: [0, 0.09, 0], rotation: [0, 0, 0, 1] },
    shoulderL: { role: 'shoulderL', parentRole: 'chest', position: [0.05, 0.05, 0], rotation: [0, 0, 0, 1] },
    upperArmL: { role: 'upperArmL', parentRole: 'shoulderL', position: [0.13, 0, 0], rotation: [0, 0, 0, 1] },
    foreArmL: { role: 'foreArmL', parentRole: 'upperArmL', position: [0.27, 0, 0], rotation: [0, 0, 0, 1] },
    handL: { role: 'handL', parentRole: 'foreArmL', position: [0.25, 0, 0], rotation: [0, 0, 0, 1] },
    shoulderR: { role: 'shoulderR', parentRole: 'chest', position: [-0.05, 0.05, 0], rotation: [0, 0, 0, 1] },
    upperArmR: { role: 'upperArmR', parentRole: 'shoulderR', position: [-0.13, 0, 0], rotation: [0, 0, 0, 1] },
    foreArmR: { role: 'foreArmR', parentRole: 'upperArmR', position: [-0.27, 0, 0], rotation: [0, 0, 0, 1] },
    handR: { role: 'handR', parentRole: 'foreArmR', position: [-0.25, 0, 0], rotation: [0, 0, 0, 1] },
    upLegL: { role: 'upLegL', parentRole: 'root', position: [0.09, -0.05, 0], rotation: [0, 0, 0, 1] },
    legL: { role: 'legL', parentRole: 'upLegL', position: [0, -0.44, 0], rotation: [0, 0, 0, 1] },
    footL: { role: 'footL', parentRole: 'legL', position: [0, -0.42, 0], rotation: [0, 0, 0, 1] },
    upLegR: { role: 'upLegR', parentRole: 'root', position: [-0.09, -0.05, 0], rotation: [0, 0, 0, 1] },
    legR: { role: 'legR', parentRole: 'upLegR', position: [0, -0.44, 0], rotation: [0, 0, 0, 1] },
    footR: { role: 'footR', parentRole: 'legR', position: [0, -0.42, 0], rotation: [0, 0, 0, 1] },
  },
};

function rngFrom(seed: number): RngLike {
  let h = seed >>> 0;
  return {
    next() {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return ((z ^ (z >>> 15)) >>> 0) / 0x1_0000_0000;
    },
  };
}

const f = (n: number) => n.toFixed(6);

const vectorsPath = fileURLToPath(
  new URL('../../../fixtures/character_vectors.tsv', import.meta.url),
);

describe('vecteurs dorés', () => {
  const rows = readFileSync(vectorsPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('seed'));

  it('en contient quarante', () => {
    expect(rows).toHaveLength(40);
  });

  it('sont reproduits exactement par le compilateur courant', () => {
    for (const row of rows) {
      const [seed, age, height, groundOffset, bones, morphs] = row.split('\t');
      const genome = createGenome(HUMANOID, rngFrom(Number(seed)));
      const c = compile(HUMANOID, genome, Number(age), BINDING);

      expect(f(c.stats.nominalHeightMeters)).toBe(height);
      expect(f(c.stats.groundOffsetMeters)).toBe(groundOffset);

      const actualBones = c.restPose
        .map(
          (b) =>
            `${b.role}=${f(b.position[0])},${f(b.position[1])},${f(b.position[2])},${f(b.scale)}`,
        )
        .join(' ');
      expect(actualBones).toBe(bones);

      const actualMorphs = Object.keys(c.morphs)
        .sort()
        .map((k) => `${k}=${f(c.morphs[k]!)}`)
        .join(' ');
      expect(actualMorphs).toBe(morphs);
    }
  });
});
