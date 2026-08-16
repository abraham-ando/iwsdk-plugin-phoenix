import { clamp01, smoothstep, valueNoise } from './noise';
import { SEA_LEVEL, heightAt, slopeAt, landMaskAt } from './terrain';
import { riverProximityAt } from './flow';

/** Le marais se juge par rapport au COURS, non plus à un axe sinusoïdal. */
const RIVER_GATE_INNER = 6;
const RIVER_GATE_OUTER = 14;

function distanceToRiver(x: number, z: number): number {
  return riverProximityAt(x, z).distance;
}

/**
 * Les biomes sont une donnée de simulation, pas une décoration (spec §6) :
 * les baies poussent où c'est humide, le silex affleure où la roche est nue.
 * Le rendu et le moteur lisent le même classement.
 */
export type BiomeId = 'ocean' | 'beach' | 'wetland' | 'grassland' | 'forest' | 'rock' | 'alpine';

export const BIOME_IDS: readonly BiomeId[] = [
  'ocean',
  'beach',
  'wetland',
  'grassland',
  'forest',
  'rock',
  'alpine',
];

export interface BiomeSample {
  readonly primary: BiomeId;
  readonly weights: Readonly<Record<BiomeId, number>>;
}

const HUMIDITY_SCALE = 1 / 900;
const HUMIDITY_SEED = 24601;

/** Le rock exige cette pente ; le test de biome s'appuie sur le même seuil. */
const ROCK_SLOPE = 0.5;
/** L'alpin exige cette altitude ; idem. */
const ALPINE_HEIGHT = 52;

export function humidityAt(x: number, z: number): number {
  return clamp01(valueNoise(x * HUMIDITY_SCALE, z * HUMIDITY_SCALE, HUMIDITY_SEED));
}

/**
 * Cœur pur de la classification : ne reçoit que des mesures déjà faites.
 *
 * `biomeAt` reste l'API commode pour une requête isolée. Mais échantillonner
 * une tuile entière par `biomeAt` recalculerait la hauteur puis la pente — qui
 * appelle `heightAt` quatre fois de plus — alors qu'une grille les possède
 * déjà. Mesuré sur une tuile 33×33 : 7,87 ms par requêtes ponctuelles contre
 * 0,61 ms en grille.
 */
export function classifyBiome(
  h: number,
  s: number,
  land: number,
  wet: number,
  distToRiver: number,
): BiomeSample {
  // GRILLE, pas intensité : « sommes-nous près de la côte ? ». Sans elle, le
  // cœur du village — plat et exactement à l'altitude zéro — deviendrait une
  // plage, puisqu'il en présente toutes les autres caractéristiques.
  const coastGate = smoothstep(0.15, 0.45, 1 - land);

  // « Sommes-nous au bord de la rivière ? » — un marais est un sol gorgé d'eau,
  // pas simplement un sol bas et humide.
  const riverGate = smoothstep(RIVER_GATE_OUTER, RIVER_GATE_INNER, distToRiver);

  // Le lit de la rivière n'est pas la mer. Sans cette réserve, `ocean` happait
  // toute altitude négative, y compris la vallée creusée en plein continent.
  const inRiverValley = distToRiver < RIVER_GATE_INNER;
  const ocean = h < SEA_LEVEL && !inRiverValley ? 1 + (SEA_LEVEL - h) : 0;

  // La végétation cède l'estran à la plage — MAIS SEULEMENT PRÈS DE LA CÔTE.
  // Conditionner sur la seule altitude éteignait la végétation de tout le
  // bassin du village, qui vit sous 3 m : être au niveau de la mer loin dans
  // les terres est banal, ce n'est pas un rivage.
  const aboveShore = 1 - coastGate * smoothstep(3.0, 0.5, h);

  // Poids : sans eux, `forest` gagne partout parce que ses trois facteurs
  // saturent à 1, alors que ceux d'une plage ou d'un marais ne le peuvent pas.
  const BEACH_WEIGHT = 2.2;
  // Relevé de 1,4 à 1,9 : sur un sol plat, bas, humide et riverain, le marais
  // atteignait 0,56 contre 0,66 à la forêt et ne l'emportait jamais. Un biome
  // déclaré mais jamais atteint est du code mort qui se donne des airs.
  const WETLAND_WEIGHT = 1.9;

  const scores: Record<BiomeId, number> = {
    ocean,
    // Plage : la terre à moins de 2,5 m au-dessus de l'eau, plate, sur le littoral.
    beach:
      ocean > 0
        ? 0
        : smoothstep(2.5, 0.1, h) * smoothstep(0.4, 0.08, s) * coastGate * BEACH_WEIGHT,
    // Marais : bas, plat, humide — et à l'intérieur des terres, pas sur l'estran.
    wetland:
      ocean > 0
        ? 0
        : smoothstep(18, 2, h) *
          smoothstep(0.25, 0.05, s) *
          smoothstep(0.5, 0.75, wet) *
          (1 - coastGate) *
          riverGate *
          WETLAND_WEIGHT,
    grassland:
      ocean > 0
        ? 0
        : smoothstep(0.55, 0.15, s) *
          smoothstep(0.75, 0.3, wet) *
          smoothstep(ALPINE_HEIGHT, 8, h) *
          aboveShore,
    forest:
      ocean > 0
        ? 0
        : smoothstep(0.6, 0.2, s) *
          smoothstep(0.35, 0.8, wet) *
          smoothstep(ALPINE_HEIGHT, 6, h) *
          aboveShore,
    rock: ocean > 0 ? 0 : smoothstep(ROCK_SLOPE, ROCK_SLOPE + 0.35, s),
    alpine: ocean > 0 ? 0 : smoothstep(ALPINE_HEIGHT, ALPINE_HEIGHT + 30, h),
  };

  let total = 0;
  for (const id of BIOME_IDS) total += scores[id];

  // Un point sans aucun score (plateau nu, humidité médiane) reste de la prairie
  // plutôt que de produire une division par zéro.
  if (total <= 0) {
    return {
      primary: 'grassland',
      weights: {
        ocean: 0,
        beach: 0,
        wetland: 0,
        grassland: 1,
        forest: 0,
        rock: 0,
        alpine: 0,
      },
    };
  }

  const weights: Record<BiomeId, number> = {
    ocean: 0,
    beach: 0,
    wetland: 0,
    grassland: 0,
    forest: 0,
    rock: 0,
    alpine: 0,
  };
  let primary: BiomeId = 'grassland';
  let best = -1;
  for (const id of BIOME_IDS) {
    const w = scores[id] / total;
    weights[id] = w;
    if (w > best) {
      best = w;
      primary = id;
    }
  }
  return { primary, weights };
}

export function biomeAt(x: number, z: number): BiomeSample {
  return classifyBiome(
    heightAt(x, z),
    slopeAt(x, z),
    landMaskAt(x, z),
    humidityAt(x, z),
    distanceToRiver(x, z),
  );
}
