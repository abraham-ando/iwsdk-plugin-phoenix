import { describe, it, expect } from 'vitest';
import { World, Object3D } from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import { createCharacterFromAsset, installCharacterThree } from '../src/create';
import { humanoidPuppet } from './fixtures/humanoidPuppet';

/**
 * Monde dont le gestionnaire d'assets est remplacé par un double.
 *
 * `new World()` ne porte pas de `assets` par défaut : le champ n'est peuplé
 * (`new RenderableAssetRegistry(...)`) que par le flux complet de
 * `World.create()`, dans `world-initializer.js` — un constructeur nu le laisse
 * simplement absent. L'affectation ci-dessous tombe donc sur un champ non
 * initialisé, pas sur un accesseur : un simple objet littéral suffit comme
 * double, sans avoir à imiter `RenderableAssetRegistry` au complet.
 */
function worldWithAssets(instantiate: (id: string) => Promise<Object3D>): World {
  const world = new World();
  installCharacterThree(world);
  (world as unknown as { assets: { instantiate: typeof instantiate } }).assets = { instantiate };
  return world;
}

describe('createCharacterFromAsset', () => {
  it('passe au pont la RACINE rendue par le manifeste, pas un maillage', async () => {
    const { root } = humanoidPuppet();
    let asked: string | null = null;
    const world = worldWithAssets(async (id) => {
      asked = id;
      return root;
    });

    const { entity, report } = await createCharacterFromAsset(world, {
      assetId: 'avatar-mira',
      familyId: HUMANOID.id,
      genome: defaultGenome(HUMANOID),
      age: 34,
    });

    expect(asked).toBe('avatar-mira');
    expect(report.missingBones).toEqual([]);
    // Le nœud du manifeste doit se retrouver DANS la hiérarchie de l'entité —
    // c'est ce qui prouve qu'il a bien été passé comme `rigRoot` et non ignoré.
    let found = false;
    entity.object3D!.traverse((n) => { if (n === root) found = true; });
    expect(found).toBe(true);
  });

  it('laisse remonter l échec de CHARGEMENT tel quel', async () => {
    const world = worldWithAssets(async () => {
      throw new Error('Unknown renderable asset "avatar-absent"');
    });
    await expect(
      createCharacterFromAsset(world, {
        assetId: 'avatar-absent', familyId: HUMANOID.id,
        genome: defaultGenome(HUMANOID), age: 30,
      }),
    ).rejects.toThrow(/Unknown renderable asset/);
  });

  it('laisse remonter le REFUS DE RIG, distinct de l échec de chargement', async () => {
    // Un nœud nu : aucun os. `createCharacter` doit lever en nommant les os
    // manquants, et ce message doit rester lisible à travers la fabrique.
    const world = worldWithAssets(async () => new Object3D());
    await expect(
      createCharacterFromAsset(world, {
        assetId: 'avatar-vide', familyId: HUMANOID.id,
        genome: defaultGenome(HUMANOID), age: 30,
      }),
    ).rejects.toThrow(/os manquants/);
  });

  it('les deux échecs ne se confondent pas', async () => {
    // Un appelant doit pouvoir dire lequel s est produit sans instrumenter le
    // code : c est ce qui permet à la démo de journaliser une cause utile.
    //
    // MÊME assetId des deux côtés, à dessein : le brief original comparait
    // deux appels avec des identifiants différents ('x' puis 'y'), ce que
    // satisferait déjà une fabrique qui aplatit les deux échecs derrière un
    // message générique du type `échec pour l'asset "${assetId}"` — les deux
    // chaînes différeraient encore, rien qu'à cause de l'identifiant, sans
    // que le TYPE d'échec y soit pour quoi que ce soit. En gardant le même
    // assetId, seule la nature de l'échec peut faire diverger les deux
    // messages ; et on vérifie en plus que chacun porte la marque de SA cause
    // et seulement la sienne.
    const assetId = 'avatar-ambigu';
    const loadFail = await createCharacterFromAsset(
      worldWithAssets(async () => { throw new Error(`Unknown renderable asset "${assetId}"`); }),
      { assetId, familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30 },
    ).catch((e: Error) => e.message);
    const rigFail = await createCharacterFromAsset(
      worldWithAssets(async () => new Object3D()),
      { assetId, familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30 },
    ).catch((e: Error) => e.message);

    expect(loadFail).not.toBe(rigFail);
    expect(loadFail).toMatch(/Unknown renderable asset/);
    expect(loadFail).not.toMatch(/os manquants/);
    expect(rigFail).toMatch(/os manquants/);
    expect(rigFail).not.toMatch(/Unknown renderable asset/);
  });
});
