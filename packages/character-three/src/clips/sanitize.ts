import { AnimationClip, type KeyframeTrack } from '@iwsdk/core';
import { classifyTranslationTrack, type FamilyDescriptor } from '@iwsdk/cardinal-character';

/** Mémoïsé par identité d'objet : quarante villageois partagent le même clip source. */
const cache = new WeakMap<AnimationClip, { clip: AnimationClip; stripped: string[] }>();

/** Amplitude maximale sur les trois axes, à travers toutes les clés. */
function amplitude(track: KeyframeTrack): number {
  const v = track.values;
  let span = 0;
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = axis; i < v.length; i += 3) {
      if (v[i]! < min) min = v[i]!;
      if (v[i]! > max) max = v[i]!;
    }
    if (max - min > span) span = max - min;
  }
  return span;
}

/**
 * Retire d'un clip les pistes de translation qui écraseraient la morphologie.
 *
 * Mesuré sur quatre clips réels de readyplayerme/animation-library : seule la
 * racine bouge vraiment. `F_Dances_001` porte dix-sept pistes de translation,
 * dont seize constantes à 10⁻⁶ m près, qui réencodent les décalages d'os du rig
 * source. Elles écraseraient les longueurs compilées mais ne portent aucun
 * mouvement, donc elles partent sans rien coûter.
 *
 * Rend un NOUVEAU clip : les clips arrivent d'un glTF et sont partagés entre
 * toutes les instances ; les amputer sur place assainirait le clip de tout le
 * village depuis le premier personnage.
 */
export function sanitizeClip(
  clip: AnimationClip,
  family: FamilyDescriptor,
  roleOfNode: (nodeName: string) => string | null,
): { clip: AnimationClip; stripped: string[] } {
  const seen = cache.get(clip);
  if (seen !== undefined) return seen;

  const kept: KeyframeTrack[] = [];
  const stripped: string[] = [];

  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) {
      kept.push(track);
      continue;
    }
    const nodeName = track.name.slice(0, -'.position'.length);
    const role = roleOfNode(nodeName);
    const verdict = classifyTranslationTrack(family, {
      boneRole: role ?? '',
      amplitudeMeters: amplitude(track),
    });

    if (verdict === 'keep') kept.push(track);
    else if (verdict === 'strip') stripped.push(track.name);
    else {
      throw new Error(
        `sanitizeClip: le clip "${clip.name}" déplace réellement "${nodeName}", ` +
          `qui n'est pas la racine — incompatible avec une morphologie compilée`,
      );
    }
  }

  const result = { clip: new AnimationClip(clip.name, clip.duration, kept), stripped };
  cache.set(clip, result);
  return result;
}
