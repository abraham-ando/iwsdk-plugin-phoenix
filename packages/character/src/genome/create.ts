import type { FamilyDescriptor } from '../family/types';
import { clamp01, type Genome, type RngLike } from './types';

/**
 * Tirage centré (Bates n=2) : moyenne 0.5, extrêmes rares.
 *
 * Un tirage uniforme donnerait autant de géants que de gens ordinaires, ce qui
 * ne ressemble à aucune population réelle. Deux uniformes moyennés suffisent à
 * produire une cloche crédible sans coûter un calcul de gaussienne.
 */
export function centeredDraw(rng: RngLike): number {
  return (rng.next() + rng.next()) / 2;
}

/** Le centre de la famille : tous les gènes à 0.5. Sert de référence et de test. */
export function defaultGenome(family: FamilyDescriptor): Genome {
  const genes: Record<string, number> = {};
  for (const key of Object.keys(family.genes)) genes[key] = 0.5;
  return { family: family.id, genes };
}

export function createGenome(family: FamilyDescriptor, rng: RngLike): Genome {
  const genes: Record<string, number> = {};
  // Ordre trié : le tirage doit être reproductible quel que soit l'ordre
  // d'insertion des clés dans le descripteur.
  for (const key of Object.keys(family.genes).sort()) {
    genes[key] = clamp01(centeredDraw(rng));
  }
  return { family: family.id, genes };
}
