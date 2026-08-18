import { describe, it, expect, vi } from 'vitest';
import { Group } from '@iwsdk/core';
import { PuppetBody, upgradeVillagers, type VillagerBody } from '../src/simulation/VillagerBody';

function puppetMap(ids: string[]): Map<string, VillagerBody> {
  return new Map(ids.map((id) => [id, new PuppetBody(new Group(), id)]));
}

describe('le basculement des villageois', () => {
  it('un échec de remplacement LAISSE la marionnette montée', async () => {
    const bodies = puppetMap(['mira', 'haran']);
    const before = bodies.get('mira')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }, { id: 'haran', gender: 'masculine' }],
      // La fabrique échoue pour tout le monde : c'est le cas hors ligne.
      buildRig: async () => { throw new Error('Unknown renderable asset "avatar-mira"'); },
    });

    expect(bodies.get('mira')).toBe(before);
    expect(bodies.size).toBe(2);
    warn.mockRestore();
  });

  it('journalise UNE fois par villageois, avec son identifiant et la cause', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await upgradeVillagers({
      bodies: puppetMap(['mira']),
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async () => { throw new Error('os manquants : spine, neck'); },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]!.join(' '));
    expect(message).toContain('mira');
    expect(message).toContain('os manquants');
    warn.mockRestore();
  });

  it('ne lève jamais, même si TOUT échoue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      upgradeVillagers({
        bodies: puppetMap(['a', 'b', 'c']),
        agents: [{ id: 'a', gender: 'masculine' }, { id: 'b', gender: 'feminine' }, { id: 'c', gender: 'masculine' }],
        buildRig: async () => { throw new Error('boum'); },
      }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('remplace ET libère la marionnette quand la fabrique réussit', async () => {
    const bodies = puppetMap(['mira']);
    const puppet = bodies.get('mira')!;
    const disposed = vi.spyOn(puppet, 'dispose');
    const rig: VillagerBody = { node: new Group(), setPose: () => {}, dispose: () => {} };

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async () => rig,
    });

    expect(bodies.get('mira')).toBe(rig);
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('la marionnette applique encore sa pose procédurale', () => {
    const node = new Group();
    const body = new PuppetBody(node, 'mira');
    body.setPose('rest', 0);
    // `applyAvatarPose` écrase l échelle Y à 0,7 pour le repos.
    expect(node.scale.y).toBeCloseTo(0.7, 5);
  });
});
