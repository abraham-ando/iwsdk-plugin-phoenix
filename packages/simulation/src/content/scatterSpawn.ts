import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import { scatterAt, SCATTER_TILE, type FloraSpecies } from '../world/scatter';

/**
 * Le second consommateur de `scatterAt` (spec E1 §3). Le rendu en tire ses
 * maillages depuis la phase 5 ; le moteur en tire désormais des objets
 * récoltables, lus sur la MÊME vérité terrain. Sans cela, la forêt se voit
 * mais ne se coupe pas.
 *
 * Aucun verbe nouveau n'est nécessaire : `gather_wood` et `gather_berries`
 * existent, et la régénération est déjà déclarée par le contenu.
 */
export const SPECIES_OBJECT: Record<FloraSpecies, string> = {
  oak: 'oak_tree',
  // Le tremble donne du bois comme le chêne ; le moteur n'a pas besoin d'en
  // distinguer l'essence, seul le rendu le fait.
  aspen: 'oak_tree',
  bush: 'berry_bush',
};

/**
 * Instancie le semis d'un carré de `side` mètres de côté, centré sur
 * l'origine. Tout est instancié d'emblée : une instanciation paresseuse
 * ferait dépendre l'identité d'un arbre de l'ordre dans lequel les agents
 * s'en approchent, et le déterminisme du moteur n'y survivrait pas.
 *
 * Rend le nombre d'objets semés.
 */
export function spawnScatter(world: GroundTruthWorld, side: number): number {
  const half = side / 2;
  const tiles = Math.ceil(half / SCATTER_TILE);
  let planted = 0;
  // Ordre de parcours fixe : les identifiants sont attribués séquentiellement
  // par `spawn`, donc l'ordre EST l'identité.
  for (let tileX = -tiles; tileX <= tiles; tileX++) {
    for (let tileZ = -tiles; tileZ <= tiles; tileZ++) {
      for (const item of scatterAt(tileX, tileZ)) {
        if (Math.abs(item.x) > half || Math.abs(item.z) > half) continue;
        world.spawn(SPECIES_OBJECT[item.species], item.x, item.z);
        planted++;
      }
    }
  }
  return planted;
}
