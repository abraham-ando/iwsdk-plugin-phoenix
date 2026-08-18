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
  const t = copy.times;

  // On retire la DÉRIVE, pas l'horizontale.
  //
  // La première version épinglait chaque clé sur l'horizontale de la clé 0.
  // C'était trop : mesuré sur les GLB réels, l'amplitude X des hanches vaut
  // 5,459 cm (`walk-masculine`) et 8,256 cm (`walk-feminine`) — c'est le
  // balancement LATÉRAL du bassin, plus ample que le balancement vertical
  // (5,222 / 4,545 cm) que cette même politique se donne explicitement du mal
  // à conserver. L'épinglage l'écrasait avec le voyage.
  //
  // La bonne opération est le retrait de la composante linéaire : pour chaque
  // clé au temps `t_i`, on ôte de X et Z la fraction `(t_i − t_0) / (t_n − t_0)`
  // du déplacement net `(dernière clé − première clé)`. Conséquences, toutes
  // vérifiées par `root-motion.test.ts` :
  //
  // - la clé 0 est laissée telle quelle (fraction nulle) — les hanches sont à
  //   ~1 m au-dessus de l'origine de l'armature et rarement à x = z = 0, les y
  //   ramener téléporterait le bassin ;
  // - le déplacement net tombe à zéro — le voyage de 3,20979 m (masculin) et
  //   4,38555 m (féminin) disparaît ;
  // - l'oscillation autour de cette droite SURVIT — 5,456 cm en X et 4,513 cm
  //   en Z après coup (masculin), 8,267 / 14,650 cm (féminin).
  //
  // La normalisation part de `t[0]` et non de zéro : rien ne garantit qu'un
  // clip commence à l'instant 0, et une soustraction fausse ici décalerait la
  // pose de départ — exactement ce que ce rebasage existe pour éviter.
  const keys = Math.min(t.length, Math.floor(v.length / 3));
  const first = 0;
  const last = keys - 1;
  // Une seule clé (ou aucune) : le déplacement net est déjà nul, il n'y a rien
  // à retirer. Un `span` nul ferait une division par zéro.
  if (last <= first) return copy;
  const t0 = t[first]!;
  const span = t[last]! - t0;
  if (span <= 0) return copy;

  const driftX = (v[last * 3] ?? 0) - (v[first * 3] ?? 0);
  const driftZ = (v[last * 3 + 2] ?? 0) - (v[first * 3 + 2] ?? 0);

  for (let i = first; i <= last; i++) {
    const fraction = (t[i]! - t0) / span;
    v[i * 3] = (v[i * 3] ?? 0) - driftX * fraction;
    v[i * 3 + 2] = (v[i * 3 + 2] ?? 0) - driftZ * fraction;
    // v[i * 3 + 1], l'axe vertical, reste intact : c'est le balancement de la
    // marche et l'accroupissement du repos.
  }
  return copy;
}
