import type { FamilyDescriptor } from '../family/types';

/** En deçà, une piste ne porte aucun mouvement : c'est un décalage figé. */
export const CONSTANT_TRACK_EPSILON = 1e-6;

export interface TranslationTrack {
  boneRole: string;
  /** Amplitude maximale sur les trois axes, en mètres. */
  amplitudeMeters: number;
}

/**
 * Décide du sort d'une piste de translation face à une morphologie compilée.
 *
 * Mesuré sur quatre clips réels de readyplayerme/animation-library : seule la
 * racine bouge vraiment. `F_Dances_001` porte dix-sept pistes de translation,
 * dont seize constantes à 10⁻⁶ m près — elles réencodent les décalages d'os du
 * rig source. Elles écraseraient les longueurs compilées, mais peuvent être
 * retirées sans rien perdre.
 *
 * Le troisième cas n'a été observé dans aucun clip, et c'est précisément
 * pourquoi il doit crier plutôt que passer : une piste qui déplace réellement
 * un os non-racine est incompatible avec une morphologie, et personne ne le
 * verrait autrement.
 */
export function classifyTranslationTrack(
  family: FamilyDescriptor,
  track: TranslationTrack,
): 'keep' | 'strip' | 'conflict' {
  const isRoot = track.boneRole === 'root' && family.bones['root'] !== undefined;
  if (isRoot) return 'keep';
  return track.amplitudeMeters <= CONSTANT_TRACK_EPSILON ? 'strip' : 'conflict';
}
