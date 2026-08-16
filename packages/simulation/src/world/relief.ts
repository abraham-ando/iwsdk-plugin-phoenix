import { lerp, smoothstep, erodedFbm, ridgedFbm } from './noise';

/**
 * Le relief SEC : le terrain tel qu'il serait sans aucun cours d'eau.
 *
 * Ce module existe pour rompre un cycle. `flow.ts` a besoin du relief pour
 * tracer la descente de la rivière, et `terrain.ts` a besoin du cours pour
 * creuser sa vallée. Les mettre ensemble ferait s'importer mutuellement deux
 * modules ; en isolant le terrain sec, le graphe redevient un arbre :
 * noise -> relief -> flow -> terrain.
 */
export const WORLD_SIZE = 64;
export const SEA_LEVEL = 0;

/** Cœur du village : rigoureusement plat, pour poser abris et foyer. */
export const PLATEAU_RADIUS = 5;
/**
 * Largeur de la transition entre le plateau et le terrain environnant.
 *
 * Elle valait 4 m quand le plateau était au niveau du sol. En l'élevant à 6 m,
 * cette même transition devenait une falaise de 43° ceinturant le village —
 * le garde-fou d'habitabilité l'a relevée dès le premier lancement. Sur 26 m,
 * la pente maximale retombe à 1,5 x 6 / 26, soit 19°.
 */
export const PLATEAU_FALLOFF = 26;

/**
 * Altitude du plateau du village.
 *
 * Il valait 0, c'est-à-dire le niveau de la mer : une rivière qui en part n'a
 * aucune charge hydraulique et ne peut descendre nulle part (spec §6 bis).
 * Six mètres sur les 800 qui séparent le village de la mer donnent une pente
 * de 0,75 %, celle d'une rivière de plaine.
 */
export const VILLAGE_ELEVATION = 6;

/** Bassin habitable : le relief y reste doux, couvrant toute la zone simulée. */
export const BASIN_RADIUS = 38;
const BASIN_FALLOFF = 55;

/** Le village est décentré de 2,5 m en z, comme dans le terrain d'origine. */
const VILLAGE_Z = -2.5;

const CONTINENT_SCALE = 1 / 2600;
const MOUNTAIN_SCALE = 1 / 420;
/** Échelle des CHAÎNES : où les montagnes existent, par opposition à leur forme. */
const RANGE_SCALE = 1 / 1800;
const DETAIL_SCALE = 1 / 55;

const CONTINENT_SEED = 90210;
const MOUNTAIN_SEED = 31337;
const RANGE_SEED = 8675309;
const DETAIL_SEED = 5150;

const SEA_FLOOR = -22;
const INLAND_RISE = 7;
const MOUNTAIN_HEIGHT = 95;

/** Rayon sous lequel la terre ferme est garantie autour de l'origine. */
const HOMELAND_RADIUS = 700;
const HOMELAND_STRENGTH = 0.45;



export function distanceToVillage(x: number, z: number): number {
  const dz = z - VILLAGE_Z;
  return Math.sqrt(x * x + dz * dz);
}

/**
 * Masque continental : 0 en pleine mer, 1 à l'intérieur des terres.
 * Le biais « terre natale » garantit que l'origine n'est jamais engloutie —
 * sans lui, une graine malheureuse noierait le village.
 */
export function landMaskAt(x: number, z: number): number {
  const base = erodedFbm(x * CONTINENT_SCALE, z * CONTINENT_SCALE, CONTINENT_SEED, 4);
  const d = Math.hypot(x, z);
  const homeland = Math.exp(-((d / HOMELAND_RADIUS) ** 2)) * HOMELAND_STRENGTH;
  return smoothstep(0.48, 0.6, base + homeland);
}

/**
 * Variante prenant le masque continental déjà calculé.
 *
 * `heightAt` a besoin du masque ET du relief sec ET de la force de la rivière,
 * qui dépend elle-même du relief sec. En passant par les fonctions publiques,
 * il recalculait le relief DEUX FOIS et le masque TROIS FOIS par point : le
 * coût par sommet triplait, ce qui rend un terrain streamé irréalisable.
 */
function reliefFromLand(x: number, z: number, land: number): number {
  const d = distanceToVillage(x, z);

  // 0 dans le bassin, 1 en plein relief : le village n'hérite pas des montagnes.
  const relief = smoothstep(BASIN_RADIUS, BASIN_RADIUS + BASIN_FALLOFF, d);

  const base = lerp(SEA_FLOOR, INLAND_RISE, land) * relief;

  // Où les montagnes ont le DROIT d'être. Sans ce masque, `ridgedFbm` lève des
  // crêtes sur toute la surface : un monde intégralement montagneux, sans
  // plaine, donc sans rivière ni marais possibles au-delà du village.
  const range = smoothstep(0.42, 0.62, erodedFbm(x * RANGE_SCALE, z * RANGE_SCALE, RANGE_SEED, 3));

  // Les montagnes exigent aussi d'être loin de la côte : land³ les efface sur le littoral.
  const ridges = ridgedFbm(x * MOUNTAIN_SCALE, z * MOUNTAIN_SCALE, MOUNTAIN_SEED, 5);
  const mountain = ridges * MOUNTAIN_HEIGHT * land * land * land * relief * range;

  // Le détail survit dans le bassin, atténué : le village ondule, il n'est pas lisse.
  // Il reste POSITIF pour que la seule chose qui creuse sous zéro près du village
  // soit le lit de la rivière — un agent ne doit pas se retrouver sous l'eau
  // parce qu'une octave de bruit est passée du mauvais côté.
  const detailAmplitude = lerp(1.6, 4.5, relief) * land;
  const detail = erodedFbm(x * DETAIL_SCALE, z * DETAIL_SCALE, DETAIL_SEED, 4) * detailAmplitude;

  return base + mountain + detail;
}

/**
 * Le relief avant toute entaille.
 *
 * `flow.ts` doit lire le terrain SEC : lire le terrain creusé ferait dépendre
 * le tracé du cours de l'entaille que ce tracé produit.
 */
export function dryReliefAt(x: number, z: number): number {
  const raw = reliefFromLand(x, z, landMaskAt(x, z));
  // Le plateau du village fait partie du TERRAIN, pas de la rivière : il doit
  // donc être visible d'ici. Le laisser dans `heightAt` faisait voir au cours
  // d'eau un village à 1 m pendant que le sol l'élevait à 6 — les deux ne
  // parlaient pas du même terrain, et la vallée creusait le village.
  const d = distanceToVillage(x, z);
  const plateau = 1 - smoothstep(PLATEAU_RADIUS, PLATEAU_RADIUS + PLATEAU_FALLOFF, d);
  return lerp(raw, VILLAGE_ELEVATION, plateau);
}
