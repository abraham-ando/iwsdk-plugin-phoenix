/**
 * Vagues de Gerstner (spec §7).
 *
 * Ce module est pur et sans Three parce qu'il porte une propriété que l'on ne
 * peut pas vérifier autrement : la SOMME DES RAIDEURS doit rester sous 1. Au
 * delà, les crêtes se replient sur elles-mêmes et la surface se retourne —
 * défaut invisible sur une capture de face, criant dans un casque.
 *
 * Le nuanceur reprend exactement ces mêmes formules ; ce fichier en est la
 * référence testable.
 */

export interface GerstnerWave {
  /** Direction de propagation, unitaire. */
  readonly dirX: number;
  readonly dirZ: number;
  /** Raideur dans [0, 1[. Leur somme borne la cambrure de la crête. */
  readonly steepness: number;
  /** Longueur d'onde en mètres. */
  readonly wavelength: number;
  /** Vitesse de phase en mètres par seconde. */
  readonly speed: number;
}

/**
 * Trois vagues, comme le prescrit le niveau `low` de la table §7 pour Quest.
 * Longueurs distinctes et directions décorrélées : trois vagues identiques
 * n'en feraient qu'une, plus haute.
 */
function wave(
  dirX: number,
  dirZ: number,
  steepness: number,
  wavelength: number,
  speed: number,
): GerstnerWave {
  // La direction est normalisée ICI plutôt qu'écrite à la main : des décimales
  // arrondies donnent une direction à 10^-5 de l'unité, et l'amplitude réelle
  // dérive alors silencieusement de celle qu'on croit avoir réglée.
  const length = Math.hypot(dirX, dirZ) || 1;
  return { dirX: dirX / length, dirZ: dirZ / length, steepness, wavelength, speed };
}

export const RIVER_WAVES_LOW: readonly GerstnerWave[] = [
  wave(1, 0, 0.18, 3.1, 1.1),
  wave(1, 1, 0.12, 1.7, 0.8),
  wave(-1, 3, 0.08, 0.9, 0.55),
];

export function totalSteepness(waves: readonly GerstnerWave[]): number {
  let sum = 0;
  for (const w of waves) sum += w.steepness;
  return sum;
}

/**
 * Déplacement de Gerstner en un point. Les vagues déplacent aussi
 * HORIZONTALEMENT : c'est ce qui creuse les creux et affûte les crêtes, et ce
 * qui distingue Gerstner d'une simple somme de sinus.
 */
export function gerstnerDisplacement(
  waves: readonly GerstnerWave[],
  x: number,
  z: number,
  time: number,
): { x: number; y: number; z: number } {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (const w of waves) {
    const k = (2 * Math.PI) / w.wavelength;
    const amplitude = w.steepness / k;
    const phase = k * (w.dirX * x + w.dirZ * z) - w.speed * k * time;
    const cosine = Math.cos(phase);
    dx += w.dirX * amplitude * cosine;
    dz += w.dirZ * amplitude * cosine;
    dy += amplitude * Math.sin(phase);
  }
  return { x: dx, y: dy, z: dz };
}
