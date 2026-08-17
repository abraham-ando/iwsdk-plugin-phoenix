import { AnimationClip, type KeyframeTrack } from '@iwsdk/core';
import { classifyTranslationTrack, type FamilyDescriptor } from '@iwsdk/cardinal-character';
import { applyRootMotionPolicy, type RootMotionPolicy } from './rootMotion';

interface Sanitized {
  clip: AnimationClip;
  stripped: string[];
}

/**
 * Mémoïsé par identité de clip — quarante villageois partagent le même clip
 * source — MAIS pas par elle SEULE.
 *
 * Le verdict ne dépend pas que du clip : il dépend aussi de `roleOfNode`, qui
 * est construit par LIAISON, donc par rig. Quarante villageois, un seul GLB de
 * danse, des noms de nœuds qui diffèrent d'un exportateur à l'autre : pour le
 * rig A la piste `Hips.position` remonte au rôle `root` et se garde ; pour le
 * rig B, dont la hanche s'appelle `mixamorig:Hips`, la même piste ne remonte à
 * aucun rôle et devrait lever. Une clé sur le seul clip rendait au second
 * appelant, en silence, le verdict rendu au premier.
 *
 * La clé est donc la famille ET la signature des rôles que `roleOfNode` donne
 * aux nœuds de translation de CE clip. Cette signature coûte un appel par
 * piste de position ; l'amplitude, elle, coûte une passe sur toutes les clés de
 * toutes les pistes, et c'est elle qu'on mémoïse.
 */
const cache = new WeakMap<AnimationClip, Map<string, Sanitized>>();

/** Famille + politique + rôle de chaque nœud de translation, dans l'ordre des pistes. */
function verdictKey(
  clip: AnimationClip,
  family: FamilyDescriptor,
  roleOfNode: (nodeName: string) => string | null,
  rootMotion: RootMotionPolicy,
): string {
  // La politique entre dans la clé. Sans elle, le cache rendrait un clip
  // aplati à un appelant qui demandait `keep` — le même défaut que la revue de
  // l'étape 2 a trouvé sur une clé par famille seule.
  let key = `${family.id}#${rootMotion}`;
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const nodeName = track.name.slice(0, -'.position'.length);
    key += `|${nodeName}=${roleOfNode(nodeName) ?? ''}`;
  }
  return key;
}

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
  options?: { rootMotion?: RootMotionPolicy },
): Sanitized {
  const rootMotion = options?.rootMotion ?? 'keep';

  let byVerdict = cache.get(clip);
  if (byVerdict === undefined) {
    byVerdict = new Map<string, Sanitized>();
    cache.set(clip, byVerdict);
  }
  const key = verdictKey(clip, family, roleOfNode, rootMotion);
  const seen = byVerdict.get(key);
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

    if (verdict === 'keep') {
      // Seule la racine reçoit `keep` : c'est donc la seule piste que la
      // politique concerne.
      const policed = applyRootMotionPolicy(track, rootMotion);
      if (policed === null) stripped.push(track.name);
      else kept.push(policed);
    } else if (verdict === 'strip') stripped.push(track.name);
    else {
      throw new Error(
        `sanitizeClip: le clip "${clip.name}" déplace réellement "${nodeName}", ` +
          `qui n'est pas la racine — incompatible avec une morphologie compilée`,
      );
    }
  }

  const result: Sanitized = { clip: new AnimationClip(clip.name, clip.duration, kept), stripped };
  byVerdict.set(key, result);
  return result;
}
