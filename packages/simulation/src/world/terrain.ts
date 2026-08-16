import { lerp, smoothstep, erodedFbm, ridgedFbm } from './noise';

/**
 * Vérité terrain (spec §6). Le rendu appelle EXACTEMENT ces fonctions : sans
 * cela, les agents marcheraient sur un relief que le joueur ne voit pas.
 *
 * Le champ est défini sur le plan infini. `WORLD_SIZE` ne le borne pas — il
 * borne la zone SIMULÉE (clamp de navigation, dimension de SpatialGrid), qui
 * reste volontairement de 64 m tant que l'écologie n'a pas étendu le domaine.
 */
export const WORLD_SIZE = 64;
export const SEA_LEVEL = 0;

/** Cœur du village : rigoureusement plat, pour poser abris et foyer. */
export const PLATEAU_RADIUS = 5;
const PLATEAU_FALLOFF = 4;

/** Bassin habitable : le relief y reste doux, couvrant toute la zone simulée. */
export const BASIN_RADIUS = 38;
const BASIN_FALLOFF = 55;

/** Le village est décentré de 2,5 m en z, comme dans le terrain d'origine. */
const VILLAGE_Z = -2.5;

const CONTINENT_SCALE = 1 / 2600;
const MOUNTAIN_SCALE = 1 / 420;
const DETAIL_SCALE = 1 / 55;

const CONTINENT_SEED = 90210;
const MOUNTAIN_SEED = 31337;
const DETAIL_SEED = 5150;

const SEA_FLOOR = -22;
const INLAND_RISE = 7;
const MOUNTAIN_HEIGHT = 95;

/** Rayon sous lequel la terre ferme est garantie autour de l'origine. */
const HOMELAND_RADIUS = 700;
const HOMELAND_STRENGTH = 0.45;

/** Le grand méandre ne démarre qu'au-delà de la zone simulée. */
const MEANDER_START = 60;
const MEANDER_FULL = 320;
const MEANDER_AMPLITUDE = 40;

function distanceToVillage(x: number, z: number): number {
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
 * Axe de la rivière : méandre serré près du village, ample au loin.
 *
 * La rampe n'est PAS cosmétique. `river_bank(2.9, -8)` de DEFAULT_VILLAGE a été
 * calé à la main sur l'ancienne formule et ne dispose que de 0,43 m de marge
 * avant de sortir du lit ; un méandre actif dès l'origine priverait les agents
 * de leur point d'eau sans qu'aucune erreur ne soit levée.
 */
export function riverCenterX(z: number): number {
  const meander = smoothstep(MEANDER_START, MEANDER_FULL, Math.abs(z));
  return 4.0 + Math.sin(z * 0.12) * 3.5 + Math.sin(z * 0.004) * MEANDER_AMPLITUDE * meander;
}

export function isRiverAt(x: number, z: number): boolean {
  return Math.abs(x - riverCenterX(z)) < 2.2;
}

export function isShoreAt(x: number, z: number): boolean {
  const d = Math.abs(x - riverCenterX(z));
  return d >= 2.2 && d < 4.5;
}

function riverCarveAt(x: number, z: number): number {
  const d = Math.abs(x - riverCenterX(z));
  if (d >= 4.0) return 0;
  return Math.cos((d / 4.0) * (Math.PI / 2)) * 1.2;
}

export function heightAt(x: number, z: number): number {
  const land = landMaskAt(x, z);
  const d = distanceToVillage(x, z);

  // 0 dans le bassin, 1 en plein relief : le village n'hérite pas des montagnes.
  const relief = smoothstep(BASIN_RADIUS, BASIN_RADIUS + BASIN_FALLOFF, d);

  const base = lerp(SEA_FLOOR, INLAND_RISE, land) * relief;

  // Les montagnes exigent d'être loin de la côte : land³ les efface sur le littoral.
  const ridges = ridgedFbm(x * MOUNTAIN_SCALE, z * MOUNTAIN_SCALE, MOUNTAIN_SEED, 5);
  const mountain = ridges * MOUNTAIN_HEIGHT * land * land * land * relief;

  // Le détail survit dans le bassin, atténué : le village ondule, il n'est pas lisse.
  // Il reste POSITIF pour que la seule chose qui creuse sous zéro près du village
  // soit le lit de la rivière — un agent ne doit pas se retrouver sous l'eau
  // parce qu'une octave de bruit est passée du mauvais côté.
  const detailAmplitude = lerp(1.6, 4.5, relief) * land;
  const detail = erodedFbm(x * DETAIL_SCALE, z * DETAIL_SCALE, DETAIL_SEED, 4) * detailAmplitude;

  const height = base + mountain + detail - riverCarveAt(x, z) * land;

  // Aplatissement exact du cœur : multiplier garantit 0, une interpolation non.
  const plateau = 1 - smoothstep(PLATEAU_RADIUS, PLATEAU_RADIUS + PLATEAU_FALLOFF, d);
  return height * (1 - plateau);
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
 * La rivière garde ses prédicats propres (`isRiverAt`) — sa surface libre et sa
 * profondeur relèvent de la phase 4, où la géométrie d'eau est construite.
 */
export function isWaterAt(x: number, z: number): boolean {
  return heightAt(x, z) < SEA_LEVEL;
}

export function depthAt(x: number, z: number): number {
  return Math.max(0, SEA_LEVEL - heightAt(x, z));
}
