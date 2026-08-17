import { describe, it, expect } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from '@iwsdk/core';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import { PuppetApplicator } from '../src/apply/PuppetApplicator';

function marionnette() {
  const root = new Group(); root.name = 'root';
  const torse = new Group(); torse.name = 'torse'; torse.position.set(0, 0.5, 0);
  const peau = new Mesh(new SphereGeometry(0.1), new MeshStandardMaterial({ color: 0xffffff }));
  peau.name = 'Wolf3D_Body';
  root.add(torse); torse.add(peau);
  return { root, nodes: new Map<string, any>([['root', root], ['legL', torse]]), peau };
}

const pose = (y: number, scale = 1): CompiledCharacter => ({
  family: 'humanoid',
  restPose: [{ role: 'legL', position: [0, y, 0], scale }],
  morphs: { jawWidth: 0.8 },
  surface: { skinTone: 1 },
  stats: { nominalHeightMeters: 1.75, groundOffsetMeters: 0.3 },
});

describe('PuppetApplicator', () => {
  it('écrit la translation sur le nœud nommé', () => {
    const { root, nodes } = marionnette();
    new PuppetApplicator({ rigRoot: root, nodes, surfaceTargets: {}, ramps: {} })
      .applyRestPose(pose(0.9));
    expect(nodes.get('legL')!.position.y).toBeCloseTo(0.9, 6);
  });

  it('applique une échelle uniforme', () => {
    const { root, nodes } = marionnette();
    new PuppetApplicator({ rigRoot: root, nodes, surfaceTargets: {}, ramps: {} })
      .applyRestPose(pose(0.9, 1.4));
    const n = nodes.get('legL')!;
    expect([n.scale.x, n.scale.y, n.scale.z]).toEqual([1.4, 1.4, 1.4]);
  });

  it('ancre sur le conteneur', () => {
    const { root, nodes } = marionnette();
    new PuppetApplicator({ rigRoot: root, nodes, surfaceTargets: {}, ramps: {} })
      .applyRestPose(pose(0.9));
    expect(root.position.y).toBeCloseTo(0.3, 6);
  });

  it('ignore les morphs sans lever : une marionnette n en a pas', () => {
    const { root, nodes } = marionnette();
    const a = new PuppetApplicator({ rigRoot: root, nodes, surfaceTargets: {}, ramps: {} });
    expect(() => a.applyMorphs({ jawWidth: 0.8 })).not.toThrow();
  });

  it('teinte le maillage nommé par la cible de surface', () => {
    const { root, nodes, peau } = marionnette();
    new PuppetApplicator({
      rigRoot: root, nodes,
      surfaceTargets: { skinTone: ['Wolf3D_Body'] },
      ramps: { skinTone: ['#000000', '#ff0000'] },
    }).applySurface({ skinTone: 1 });
    const c = (peau.material as MeshStandardMaterial).color;
    expect(c.r).toBeCloseTo(1, 3);
    expect(c.g).toBeCloseTo(0, 3);
  });
});
