import type { KeyframeTrack } from '@iwsdk/core';

/**
 * Que faire de la piste de translation de l'os racine.
 *
 * Ce n'est PAS une question d'espèce, donc ce n'est pas un champ de
 * `FamilyDescriptor` : c'est la question de savoir qui possède la position du
 * personnage dans le monde. Un villageois dont `AgentView.x/z` est recalculé
 * à chaque tick et un personnage joueur en locomotion libre appartiennent à la
 * même famille et veulent des réponses opposées. C'est donc l'appelant qui
 * tranche.
 *
 * Mesuré : `M_Walk_001` déplace les hanches de 3,21 m par boucle. Laissée
 * telle quelle sur un villageois, la marche l'emmène trois mètres devant
 * lui-même avant que la simulation ne le reteleporte.
 */
export type RootMotionPolicy = 'keep' | 'strip' | 'flatten';

/**
 * Applique la politique à la piste racine. Rend `null` quand la piste doit
 * disparaître, un NOUVEAU `KeyframeTrack` quand elle doit être transformée, et
 * la piste reçue quand elle est laissée intacte.
 *
 * Ne mute jamais la piste reçue : les clips viennent d'un glTF partagé par tout
 * le village, et les modifier sur place aplatirait la marche de tout le monde
 * depuis le premier personnage.
 */
export function applyRootMotionPolicy(
  track: KeyframeTrack,
  policy: RootMotionPolicy,
): KeyframeTrack | null {
  if (policy === 'keep') return track;
  if (policy === 'strip') return null;

  const copy = track.clone();
  const v = copy.values;
  // Rebasage sur la PREMIÈRE clé, pas sur zéro. Les hanches sont à ~1 m au-
  // dessus de l'origine de l'armature et rarement à x = z = 0 ; les y ramener
  // téléporterait le bassin. Chaque clé reçoit donc l'horizontale de DÉPART :
  // le voyage disparaît, la pose reste.
  const baseX = v[0] ?? 0;
  const baseZ = v[2] ?? 0;
  for (let i = 0; i < v.length; i += 3) {
    v[i] = baseX;
    v[i + 2] = baseZ;
    // v[i + 1], l'axe vertical, reste intact : c'est le balancement de la
    // marche et l'accroupissement du repos.
  }
  return copy;
}
