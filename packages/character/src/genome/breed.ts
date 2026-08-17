import type { FamilyDescriptor } from '../family/types';
import { centeredDraw } from './create';
import { clamp01, type Genome, type RngLike } from './types';

/**
 * Croise deux génomes. Fonction pure : mêmes parents, même graine, même enfant,
 * à jamais. C'est ce qui permet à une naissance d'entrer dans le journal
 * rejouable de SimKernel sans stocker le résultat.
 *
 * Quatre étapes par gène, dans cet ordre :
 *   1. mélange des allèles parentaux, biaisé par `dominance` ;
 *   2. part non héritée, tirée indépendamment selon `heritability` ;
 *   3. mutation bornée par `mutationRate` ;
 *   4. atténuation d'un gène lié au sexe chez l'autre sexe.
 */
export function breed(
  family: FamilyDescriptor,
  mother: Genome,
  father: Genome,
  rng: RngLike,
  sex: 'f' | 'm',
): Genome {
  if (mother.family !== father.family) {
    throw new Error(
      `breed: familles différentes — "${mother.family}" et "${father.family}"`,
    );
  }

  const genes: Record<string, number> = {};

  // Ordre trié : le résultat ne doit pas dépendre de l'ordre des clés.
  for (const key of Object.keys(family.genes).sort()) {
    const def = family.genes[key]!;
    const m = mother.genes[key] ?? 0.5;
    const f = father.genes[key] ?? 0.5;

    // 1. Mélange. `dominance` déplace l'espérance du tirage vers un parent
    //    sans jamais sortir de l'intervalle qu'ils délimitent.
    const t = clamp01(rng.next() + (def.dominance - 0.5));
    const blended = m + (f - m) * t;

    // 2. Part non héritée.
    const independent = centeredDraw(rng);
    let value = independent + (blended - independent) * def.heritability;

    // 3. Mutation symétrique et bornée.
    if (def.mutationRate > 0) {
      value += (rng.next() * 2 - 1) * def.mutationRate;
    }

    // 4. Gène lié au sexe : ramené à mi-chemin du centre chez l'autre sexe.
    if (def.sexLinked !== undefined && def.sexLinked !== sex) {
      value = 0.5 + (value - 0.5) * 0.5;
    }

    genes[key] = clamp01(value);
  }

  return { family: mother.family, genes };
}
