import { lerp, smoothstep } from './noise';
import { SEA_LEVEL, PLATEAU_RADIUS, dryReliefAt, distanceToVillage } from './relief';
import { riverProximityAt } from './flow';

/**
 * Vérité terrain (spec §6). Le rendu appelle EXACTEMENT ces fonctions : sans
 * cela, les agents marcheraient sur un relief que le joueur ne voit pas.
 *
 * Ce module ne fait plus que COMPOSER : `relief.ts` porte le terrain sec,
 * `flow.ts` le cours d'eau, et l'on creuse ici l'un jusqu'à l'autre.
 *
 * Le champ est défini sur le plan infini. `WORLD_SIZE` ne le borne pas — il
 * borne la zone SIMULÉE (clamp de navigation, dimension de SpatialGrid).
 */

export {
  WORLD_SIZE,
  SEA_LEVEL,
  PLATEAU_RADIUS,
  BASIN_RADIUS,
  VILLAGE_ELEVATION,
  landMaskAt,
  dryReliefAt,
} from './relief';

/**
 * Largeur de la vallée, en multiples de la largeur du lit.
 *
 * Une marge fixe était disproportionnée : 9 m de vallée autour d'un ruisseau
 * de 2,6 m engloutissaient le plateau du village entier. Une vallée
 * proportionnée au cours croît avec lui, comme dans la nature.
 */
export const VALLEY_RATIO = 2.2;

/**
 * Recul horizontal des berges par mètre de profondeur entaillée.
 *
 * Sans ce terme, la largeur de vallée ignorait la profondeur : une entaille de
 * 41 m dans un couloir de 9 m donnait des parois à 73°, et la rivière coulait
 * au fond d'un canyon sur la majorité de son cours. 2,14 correspond à des
 * berges d'au plus 25° — une pente que l'on descend, et non que l'on escalade.
 */
const BANK_RUN = 2.14;

/** Profondeur du lit sous la nappe. */
const BED_DEPTH = 1.1;

/** Largeur de la berge, au-delà du lit. */
const SHORE_WIDTH = 3.5;

/**
 * Le chenal se resserre là où le village est bâti.
 *
 * Une vallée large creusait le sol SOUS les abris et les foyers, que
 * DEFAULT_VILLAGE place à un ou deux mètres de l'axe : ils se retrouvaient
 * sous la nappe. Un village de bord de rivière a des berges franches, pas une
 * vallée évasée — resserrer le chenal les remet au sec sans déplacer un seul
 * objet ni toucher à ce que le moteur appelle « être dans la rivière ».
 */
const VILLAGE_CHANNEL_TIGHTEN = 0.3;
const VILLAGE_CHANNEL_RANGE = 25;

export function isRiverAt(x: number, z: number): boolean {
  const river = riverProximityAt(x, z);
  return river.distance < river.width;
}

export function isShoreAt(x: number, z: number): boolean {
  const river = riverProximityAt(x, z);
  return river.distance >= river.width && river.distance < river.width + SHORE_WIDTH;
}

/** Altitude de la nappe libre. C'est ce que la phase 4 maillera. */
export function riverSurfaceAt(x: number, z: number): number {
  return riverProximityAt(x, z).elevation;
}

export function heightAt(x: number, z: number): number {
  // Le sol, plateau du village compris, vient tel quel du relief sec.
  const ground = dryReliefAt(x, z);

  const river = riverProximityAt(x, z);
  // La vallée s'élargit AVEC sa profondeur : c'est ce qui borne la pente des
  // berges, quelle que soit l'épaisseur de relief que le cours doit traverser.
  const depth = Math.max(0, ground - river.elevation);
  const tighten =
    1 -
    (1 - VILLAGE_CHANNEL_TIGHTEN) *
      (1 - smoothstep(PLATEAU_RADIUS, PLATEAU_RADIUS + VILLAGE_CHANNEL_RANGE, distanceToVillage(x, z)));
  const reach = (river.width * VALLEY_RATIO + depth * BANK_RUN) * tighten;
  if (river.distance >= reach) return ground;

  // Profil de vallée : le fond du lit au centre, le sol intact au bord.
  const t = 1 - smoothstep(0, reach, river.distance);
  const valley = lerp(ground, river.elevation - BED_DEPTH, t);

  // L'entaille ne fait que CREUSER. Sans ce min, une vallée traversant un
  // creux du terrain y remonterait le sol, et la rivière se retrouverait
  // perchée sur un remblai de sa propre fabrication.
  return Math.min(ground, valley);
}

/** Alias historique : consommé par apps/demo, WolfSystem et AgentRuntime. */
export function getTerrainHeight(x: number, z: number): number {
  return heightAt(x, z);
}

const SLOPE_EPS = 0.5;

/** Pente du sol en radians. Différences centrées sur ±0,5 m. */
export function slopeAt(x: number, z: number): number {
  const dx = heightAt(x + SLOPE_EPS, z) - heightAt(x - SLOPE_EPS, z);
  const dz = heightAt(x, z + SLOPE_EPS) - heightAt(x, z - SLOPE_EPS);
  return Math.atan(Math.hypot(dx, dz) / (2 * SLOPE_EPS));
}

/**
 * Mer uniquement : le littoral est dessiné par le masque continental.
 * La rivière garde ses prédicats propres (`isRiverAt`) et sa nappe
 * (`riverSurfaceAt`), qui descend avec le cours.
 */
export function isWaterAt(x: number, z: number): boolean {
  return heightAt(x, z) < SEA_LEVEL;
}

export function depthAt(x: number, z: number): number {
  return Math.max(0, SEA_LEVEL - heightAt(x, z));
}
