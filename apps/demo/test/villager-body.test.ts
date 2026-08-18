import { describe, it, expect, vi } from 'vitest';
import { Group, Mesh } from '@iwsdk/core';
import {
  PuppetBody,
  upgradeVillagers,
  assertSameWorldFrame,
  type VillagerBody,
} from '../src/simulation/VillagerBody';
import { createAgentAvatar } from '../src/simulation/AgentAvatarFactory';

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

  // I3 (revue) : un `dispose()` glissé dans la branche d'échec passerait les
  // cinq tests ci-dessus — la carte garde la même RÉFÉRENCE d'objet (dispose
  // ne remplace rien dans `bodies`), donc « LAISSE la marionnette montée » ne
  // le voit pas. Ce test regarde la SCÈNE, pas la carte.
  it("un échec de remplacement garde le nœud de la marionnette DANS la scène", async () => {
    const parent = new Group();
    const node = new Group();
    parent.add(node);
    expect(node.parent).toBe(parent); // sanity : montage réel avant l'appel

    const bodies = new Map<string, VillagerBody>([['mira', new PuppetBody(node, 'mira')]]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async () => { throw new Error('Unknown renderable asset "avatar-mira"'); },
    });

    // `PuppetBody.dispose()` appelle `removeFromParent()` : si `upgradeVillagers`
    // l'invoquait par erreur dans le `catch`, `node.parent` serait `null` ici.
    expect(node.parent).toBe(parent);
    warn.mockRestore();
  });
});

// I1 (revue) : `PuppetBody.dispose()` ne faisait que détacher le nœud —
// `createAgentAvatar` alloue trois géométries et trois matériaux NEUFS par
// villageois (jamais partagés), abandonnés au GPU à chaque remplacement.
describe('PuppetBody.dispose() et les ressources GPU', () => {
  it('dispose() appelle réellement .dispose() sur chaque géométrie et matériau du nœud', () => {
    const avatar = createAgentAvatar('Test', 0x3b82f6, 'feminine');
    const meshes: Mesh[] = [];
    avatar.traverse((child) => {
      if (child instanceof Mesh) meshes.push(child);
    });
    // Sanity : le montage réel produit bien des Mesh à surveiller, sinon le
    // reste de ce test ne prouverait rien.
    expect(meshes.length).toBeGreaterThan(0);

    const geometrySpies = meshes.map((m) => vi.spyOn(m.geometry, 'dispose'));
    const materialSpies = meshes.flatMap((m) =>
      (Array.isArray(m.material) ? m.material : [m.material]).map((mat) =>
        vi.spyOn(mat, 'dispose'),
      ),
    );

    new PuppetBody(avatar, 'test').dispose();

    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of materialSpies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dispose() détache aussi le nœud (comportement d'avant, conservé)", () => {
    const parent = new Group();
    const avatar = createAgentAvatar('Test', 0x3b82f6, 'masculine');
    parent.add(avatar);

    new PuppetBody(avatar, 'test').dispose();

    expect(avatar.parent).toBeNull();
  });
});

// I2 (revue) : le rig n'atterrit pas forcément sous le même parent que la
// marionnette qu'il remplace — les deux coïncident aujourd'hui uniquement
// parce que la racine de niveau et la racine de scène du village sont toutes
// deux à l'identité. `assertSameWorldFrame` transforme cette coïncidence
// tacite en échec bruyant si l'une des deux bouge.
describe('assertSameWorldFrame (repère du rig vs. repère de la marionnette)', () => {
  it("ne lève pas quand les deux parents remontent à l'identité jusqu'à la scène", () => {
    const scene = new Group();
    const levelRoot = new Group();
    const villageRoot = new Group();
    scene.add(levelRoot, villageRoot);

    expect(() => assertSameWorldFrame(villageRoot, levelRoot, scene)).not.toThrow();
  });

  it("lève quand une des deux racines a bougé", () => {
    const scene = new Group();
    const levelRoot = new Group();
    const villageRoot = new Group();
    // Quelqu'un a déplacé la racine du village hors de l'identité.
    villageRoot.position.set(2, 0, 0);
    scene.add(levelRoot, villageRoot);

    expect(() => assertSameWorldFrame(villageRoot, levelRoot, scene)).toThrow(/repère monde/);
  });

  it("lève quand une des deux racines a tourné (position à l'identité, orientation non)", () => {
    const scene = new Group();
    const levelRoot = new Group();
    const villageRoot = new Group();
    villageRoot.rotation.y = Math.PI / 4;
    scene.add(levelRoot, villageRoot);

    expect(() => assertSameWorldFrame(villageRoot, levelRoot, scene)).toThrow(/repère monde/);
  });
});
