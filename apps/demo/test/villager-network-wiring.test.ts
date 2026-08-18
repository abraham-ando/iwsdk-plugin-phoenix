import { describe, it, expect } from 'vitest';
import { World, type Object3D } from '@iwsdk/core';
import { CharacterGenome, installPhoenixNetworking, Networked } from '@iwsdk/plugin-phoenix';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import {
  createCharacterFromAsset,
  genomeToBytes,
  installCharacterThree,
} from '@iwsdk/cardinal-character-three';
import { VILLAGER_NETWORK_IDS } from '../src/simulation/villagerNetworkIds.js';
// Le rig de test vit dans le paquet des personnages — voir `villager-body.test.ts`
// pour l'explication de l'alias, déclaré dans `vitest.config.ts`.
import { humanoidPuppet } from '@character-three/fixtures/humanoidPuppet';

/**
 * Un monde câblé comme le vrai `buildRig` de `src/index.ts` : un adaptateur
 * réseau HORS-LIGNE (aucun serveur à joindre) pour que `installPhoenixNetworking`
 * enregistre `Networked` et `CharacterGenome` exactement comme il le fait en
 * production, plus un double de `world.assets.instantiate` pour que
 * `createCharacterFromAsset` n'ait besoin d'aucun vrai chargeur — le motif
 * prouvé par `packages/character-three/test/from-asset.test.ts` (le sketch du
 * brief de cette tâche, lui, appelait `createCharacterFromAsset` sans jamais
 * poser `world.assets`, ce qui échoue avant même d'atteindre l'entité).
 */
function worldWithAssetsAndNetwork(instantiate: (id: string) => Promise<Object3D>): World {
  const world = new World();
  installCharacterThree(world);
  installPhoenixNetworking(world, { isOffline: true });
  (world as unknown as { assets: { instantiate: typeof instantiate } }).assets = { instantiate };
  return world;
}

describe('le câblage réseau d un villageois', () => {
  it('porte Networked avec son id fixe, et CharacterGenome avec son génome, lisibles après coup', async () => {
    const { root } = humanoidPuppet('rpm');
    const world = worldWithAssetsAndNetwork(async () => root);
    const genome = defaultGenome(HUMANOID);

    const { entity } = await createCharacterFromAsset(world, {
      assetId: 'avatar-mira',
      familyId: HUMANOID.id,
      genome,
      age: 30,
    });

    // Les deux appels que `buildRig` fait réellement, dans le même ordre.
    entity.addComponent(Networked, {
      networkId: VILLAGER_NETWORK_IDS['mira'],
      isLocalOwner: false,
      ownerId: 0,
    });
    entity.addComponent(CharacterGenome, { genes: genomeToBytes(genome) });

    expect(entity.getValue(Networked, 'networkId')).toBe(VILLAGER_NETWORK_IDS['mira']);
    // `genes` porte le type synthétique 'Array13U8' (voir components.generated.ts) :
    // pas dans l'union `DataType` fermée d'elics, d'où `getVectorView`, jamais
    // `getValue`, et le même contournement de type que `cardinal-character-genome.test.ts`.
    expect(
      Array.from((entity as any).getVectorView(CharacterGenome, 'genes')),
    ).toEqual(genomeToBytes(genome));
  });
});
