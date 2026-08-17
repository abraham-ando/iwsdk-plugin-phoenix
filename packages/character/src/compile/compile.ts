import { evalCurve } from '../family/proportions';
import type { FamilyDescriptor } from '../family/types';
import { clamp01, type Genome } from '../genome/types';
import type { BoneRest, CompiledBone, CompiledCharacter, RigBinding, Vec3 } from './types';

/** Plage d'action d'un gène de longueur : ±25 % autour du rig source. */
const LENGTH_SPAN = 0.5;

function lengthFactor(gene: number): number {
  return 1 - LENGTH_SPAN / 2 + gene * LENGTH_SPAN;
}

/** Remonte de `to` jusqu'à `from` exclu, et rend les rôles du plus proche au plus loin. */
function chainRoles(binding: RigBinding, from: string, to: string, label: string): string[] {
  const roles: string[] = [];
  let cursor: string | null = to;
  while (cursor !== null && cursor !== from) {
    // Annotation explicite : sans elle, `noImplicitAny` combiné à
    // `strictNullChecks` voit une dépendance circulaire entre le type de
    // `bone` et le rétrécissement de `cursor` d'une itération à l'autre.
    const bone: BoneRest | undefined = binding.bones[cursor];
    if (bone === undefined) {
      throw new Error(`compile: chaîne "${label}" — os "${cursor}" absent de la liaison`);
    }
    roles.push(cursor);
    cursor = bone.parentRole;
  }
  if (cursor === null) {
    throw new Error(`compile: chaîne "${label}" — "${to}" ne descend pas de "${from}"`);
  }
  // Le puits de la boucle : elle s'arrête DÈS QUE `cursor === from`, sans
  // jamais déréférencer `from` lui-même. Une ancre absente de la liaison
  // compilerait donc en silence sans ce garde-fou.
  if (binding.bones[from] === undefined) {
    throw new Error(`compile: chaîne "${label}" — os d'ancrage "${from}" absent de la liaison`);
  }
  return roles;
}

function scaled(position: Vec3, factor: number): Vec3 {
  return [position[0] * factor, position[1] * factor, position[2] * factor];
}

/**
 * Compile un génome et un âge en une pose de repos, des influences de morphs et
 * des tons de surface.
 *
 * Les longueurs passent par des TRANSLATIONS, les volumes par des morphs, et
 * l'échelle n'est employée qu'uniformément — sur la tête, dont aucun rig RPM ne
 * fournit la clé de forme. Multiplier la translation locale d'un os revient
 * exactement à allonger le segment qui le sépare de son parent, sans toucher à
 * son orientation. C'est ce qui rend le cisaillement impossible par
 * construction plutôt que par vigilance.
 */
export function compile(
  family: FamilyDescriptor,
  genome: Genome,
  age: number,
  binding: RigBinding,
): CompiledCharacter {
  if (binding.family !== family.id) {
    throw new Error(
      `compile: liaison de famille "${binding.family}" pour le descripteur "${family.id}"`,
    );
  }

  // Borné ici et pas seulement à la création : `compile` est publique et reçoit
  // un objet nu. Un gène hors plage donnerait un facteur négatif, donc une
  // réflexion — la même catastrophe que le cisaillement, par une autre porte.
  const gene = (key: string): number => clamp01(genome.genes[key] ?? 0.5);

  const adult = family.adultAge;
  const bodyScale = evalCurve(family.proportions.bodyScale, age);
  const limbRatio =
    evalCurve(family.proportions.limbToTorso, age) /
    evalCurve(family.proportions.limbToTorso, adult);
  const headRatio =
    evalCurve(family.proportions.headToBody, age) /
    evalCurve(family.proportions.headToBody, adult);

  // La stature module toutes les chaînes ensemble ; les gènes de chaîne
  // modulent ensuite chacune indépendamment.
  const stature = lengthFactor(gene('stature'));

  const factors = new Map<string, number>();
  for (const [label, chain] of Object.entries(family.chains)) {
    const own = lengthFactor(gene(chain.gene));
    // Un enfant a les membres courts par rapport au tronc : le rapport ne
    // s'applique qu'aux chaînes de membres, jamais au tronc lui-même.
    const ageFactor = chain.limb ? limbRatio : 1;
    const factor = stature * own * ageFactor;

    for (const role of chainRoles(binding, chain.from, chain.to, label)) {
      factors.set(role, factor);
    }
    if (chain.mirror !== undefined) {
      for (const role of chainRoles(binding, chain.mirror[0], chain.mirror[1], `${label} (miroir)`)) {
        factors.set(role, factor);
      }
    }
  }

  const restPose: CompiledBone[] = [];
  for (const bone of Object.values(binding.bones)) {
    const factor = factors.get(bone.role) ?? 1;
    restPose.push({
      role: bone.role,
      position: scaled(bone.position, factor),
      // La racine (family.rootRole) porte l'échelle globale du corps, la tête
      // (family.headRole) son rapport propre : ce sont les deux seuls rôles
      // nommés dans la donnée, jamais devinés par un nom d'os en dur.
      scale: bone.role === family.rootRole ? bodyScale : bone.role === family.headRole ? headRatio : 1,
    });
  }

  const morphs: Record<string, number> = {};
  for (const [key, def] of Object.entries(family.morphs)) {
    if (binding.morphIndex[key] === undefined) continue;
    const [lo, hi] = def.range;
    morphs[key] = lo + gene(key) * (hi - lo);
  }

  // Un ton par gène du groupe `surface` : le compilateur ne connaît aucun nom
  // de gène de surface, seulement le groupe auquel il appartient.
  const surface: Record<string, number> = {};
  for (const [key, def] of Object.entries(family.genes)) {
    if (def.group === 'surface') surface[key] = gene(key);
  }

  return {
    family: family.id,
    restPose,
    rebindSkeleton: true,
    morphs,
    surface,
    stats: { nominalHeightMeters: binding.restHeightMeters * bodyScale * stature },
  };
}
