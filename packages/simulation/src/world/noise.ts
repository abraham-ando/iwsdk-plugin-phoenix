/**
 * Bruit déterministe sans état (spec §6). Aucune dépendance : le paquet n'en a
 * aucune et cette propriété est préservée.
 *
 * Pourquoi ne pas réutiliser `Rng` : c'est un générateur de FLUX, son état
 * avance à chaque appel. Un terrain exige l'inverse — le même point du monde
 * doit rendre la même hauteur, pour toujours et quel que soit l'ordre des
 * appels. Seule la fonction de mélange splitmix32 de `Rng` est reprise ici.
 */

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  // Bords confondus : la rampe est un échelon, pas une division par zéro.
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Hachage entier -> [0, 1). Mélange splitmix32, comme l'expansion de graine de Rng. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ (seed | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 0x1_0000_0000;
}

/** Rampe quintique : dérivées première ET seconde nulles aux nœuds, donc pas de facettes visibles. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bruit de valeur bilinéaire sur le plan infini. Renvoie [0, 1]. */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const u = fade(x - x0);
  const v = fade(z - z0);
  const n00 = hash2(x0, z0, seed);
  const n10 = hash2(x0 + 1, z0, seed);
  const n01 = hash2(x0, z0 + 1, seed);
  const n11 = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

const GRADIENT_EPS = 0.0015;

/**
 * fbm dont chaque octave est amortie par la pente accumulée sous elle.
 * C'est l'approximation d'érosion de la spec : le détail se dépose dans les
 * creux et s'efface sur les flancs raides, au lieu de saupoudrer uniformément.
 * Coût : trois évaluations de bruit par octave — le maillage de la phase 3B
 * choisira le nombre d'octaves selon le niveau de détail.
 */
export function erodedFbm(x: number, z: number, seed: number, octaves = 5): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  let slopeX = 0;
  let slopeZ = 0;
  for (let o = 0; o < octaves; o++) {
    const s = seed + o * 1013;
    // La pente est celle des octaves DÉJÀ posées : une octave ne s'amortit pas
    // elle-même. Le détail se dépose là où le sol en dessous est plat.
    const damping = 1 / (1 + slopeX * slopeX + slopeZ * slopeZ);
    const n = valueNoise(x * frequency, z * frequency, s);
    sum += amplitude * n * damping;
    // Normalisation par une somme CONSTANTE. Diviser par la somme amortie
    // réinjecterait la haute fréquence que l'amortissement venait d'ôter :
    // le quotient de deux signaux qui oscillent oscille encore.
    norm += amplitude;
    slopeX += (valueNoise((x + GRADIENT_EPS) * frequency, z * frequency, s) - n) / GRADIENT_EPS;
    slopeZ += (valueNoise(x * frequency, (z + GRADIENT_EPS) * frequency, s) - n) / GRADIENT_EPS;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm > 0 ? clamp01(sum / norm) : 0;
}

/** fbm ridée : les crêtes sont des plis, pas des bosses. Renvoie [0, 1]. */
export function ridgedFbm(x: number, z: number, seed: number, octaves = 5): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(x * frequency, z * frequency, seed + o * 7919);
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += amplitude * ridge * ridge;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return clamp01(sum / norm);
}
