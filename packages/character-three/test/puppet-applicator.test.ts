import { describe, it, expect, vi } from 'vitest';
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

  it('clone le matériau par individu : teinter l un ne repeint pas l autre', () => {
    // Le §7.4 de la conception : « muter le matériau partagé recolorerait tout
    // le village ». `Object3D.clone()` PARTAGE ses matériaux, et un asset
    // chargé une fois puis instancié quarante fois aussi — le premier
    // villageois repeindrait donc les trente-neuf autres, et le défaut se
    // lirait comme « tout le monde a la même peau », très loin de sa cause.
    const source = new MeshStandardMaterial({ color: 0xffffff });
    const commun = () => {
      const { root, nodes, peau } = marionnette();
      peau.material = source;
      return { root, nodes, peau };
    };
    const a = commun();
    const b = commun();
    const options = { surfaceTargets: { skinTone: ['Wolf3D_Body'] }, ramps: { skinTone: ['#000000', '#ff0000'] as const } };
    const appA = new PuppetApplicator({ rigRoot: a.root, nodes: a.nodes, ...options });
    new PuppetApplicator({ rigRoot: b.root, nodes: b.nodes, ...options });

    // Le clone est posé DÈS la construction, pas au premier teintage.
    expect(a.peau.material).not.toBe(source);
    expect(b.peau.material).not.toBe(source);

    appA.applySurface({ skinTone: 1 });

    expect((a.peau.material as MeshStandardMaterial).color.getHex()).not.toBe(0xffffff);
    expect((b.peau.material as MeshStandardMaterial).color.getHex()).toBe(0xffffff);
    expect(source.color.getHex()).toBe(0xffffff);
  });

  it('libère ses clones à dispose, sans toucher au matériau de l asset', () => {
    const source = new MeshStandardMaterial({ color: 0xffffff });
    const { root, nodes, peau } = marionnette();
    peau.material = source;
    const app = new PuppetApplicator({
      rigRoot: root, nodes,
      surfaceTargets: { skinTone: ['Wolf3D_Body'] },
      ramps: { skinTone: ['#000000', '#ff0000'] },
    });
    const clone = peau.material as MeshStandardMaterial;
    const cloneDispose = vi.spyOn(clone, 'dispose');
    const sourceDispose = vi.spyOn(source, 'dispose');

    app.dispose();

    // Le clone nous appartient ; la bibliothèque garde le sien.
    expect(cloneDispose).toHaveBeenCalledOnce();
    expect(sourceDispose).not.toHaveBeenCalled();
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
