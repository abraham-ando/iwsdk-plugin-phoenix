/**
 * Les génomes des onze villageois, dérivés de leurs identifiants.
 *
 * Cinq avatars Ready Player Me pour onze habitants : ce qui les distingue est
 * la morphologie compilée, pas l'asset. C'est toute la démonstration.
 */
import {
  HUMANOID, breed, createGenome,
  type Genome, type RngLike,
} from '@iwsdk/cardinal-character';
import type { ScenarioAgent } from '@iwsdk/cardinal-simulation';

/** La famille de la tribu de l'Aube : deux parents, deux enfants engendrés. */
const MOTHER = 'mira';
const FATHER = 'haran';
const CHILDREN: Readonly<Record<string, 'f' | 'm'>> = { lio: 'm', aya: 'f' };

/**
 * FNV-1a 32 bits. Stable, sans dépendance, suffisant pour semer.
 *
 * N'est plus exportée : `VillagerBody.hashIndex`, son seul appelant hors de
 * ce fichier, a disparu avec la tâche 9 — le basculement choisit désormais
 * l'asset par genre, pas par hachage de l'identifiant.
 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Générateur congruentiel semé par l'identifiant de l'agent.
 *
 * Il ne PUISE JAMAIS dans `kernel.rng`. Prélever dans le flux du noyau
 * décalerait toutes ses valeurs suivantes et casserait les tests de
 * déterminisme de `cardinal-simulation` : la morphologie est une projection,
 * elle ne prend rien à la simulation.
 */
function rngFor(id: string): RngLike {
  let state = hash(id) || 1;
  return {
    next(): number {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    },
  };
}

export function buildVillagerGenomes(
  agents: readonly ScenarioAgent[],
): Record<string, Genome> {
  const genomes: Record<string, Genome> = {};

  // Les parents d'abord : les enfants en dépendent.
  for (const agent of agents) {
    if (CHILDREN[agent.id] !== undefined) continue;
    genomes[agent.id] = createGenome(HUMANOID, rngFor(agent.id));
  }

  const mother = genomes[MOTHER];
  const father = genomes[FATHER];
  for (const [childId, sex] of Object.entries(CHILDREN)) {
    if (mother === undefined || father === undefined) {
      // Le scénario a changé de casting : un enfant sans parents reçoit un
      // génome tiré, plutôt que de faire échouer le village entier.
      genomes[childId] = createGenome(HUMANOID, rngFor(childId));
      continue;
    }
    genomes[childId] = breed(HUMANOID, mother, father, rngFor(childId), sex);
  }

  return genomes;
}
