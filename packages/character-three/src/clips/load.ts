import { AssetManager, type AnimationClip } from '@iwsdk/core';

/**
 * Charge des clips depuis le manifeste et rend le PREMIER de chaque fichier.
 *
 * Les clips sont partagés par tout le village : ils n'ont rien à faire dans une
 * fabrique par personnage. L'assainissement, lui, reste par personnage — il
 * dépend du `roleOfNode` de ce rig-là — et le mémo de `sanitizeClip` le rend
 * gratuit à partir du deuxième villageois.
 *
 * Un identifiant qui ne charge pas fait échouer la promesse entière : un
 * village où la moitié des verbes n'ont pas de clip est plus difficile à
 * diagnostiquer qu'un échec net.
 */
export async function loadCharacterClips(
  ids: Readonly<Record<string, string>>,
): Promise<Record<string, AnimationClip>> {
  const clips: Record<string, AnimationClip> = {};
  for (const [verb, assetId] of Object.entries(ids)) {
    const gltf = await AssetManager.loadGLTFById(assetId);
    const clip = gltf.animations[0];
    if (clip === undefined) {
      throw new Error(
        `loadCharacterClips: l'asset "${assetId}" (verbe "${verb}") ne contient aucun clip`,
      );
    }
    clips[verb] = clip;
  }
  return clips;
}
