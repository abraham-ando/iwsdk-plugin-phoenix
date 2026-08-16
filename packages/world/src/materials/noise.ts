/**
 * Periodic value noise (spec §5). The lattice wraps on `period`, so every
 * texture generated from it tiles EXACTLY — seams on a large terrain or a
 * repeated rock face are the fastest way to destroy realism, and they are
 * impossible to fix after the fact.
 *
 * Pure and dependency-free, like packages/simulation: no Three, no npm noise
 * library, fully unit-testable.
 */

/** Deterministic hash of an integer lattice point, in [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep interpolation — C1 continuous, which keeps normals clean. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Positive modulo, so negative coordinates wrap correctly. */
function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

export function valueNoise2D(x: number, y: number, period: number, seed: number): number {
  const px = wrap(x, period);
  const py = wrap(y, period);
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = smooth(px - ix);
  const fy = smooth(py - iy);

  // Lattice indices wrap on `period` — this is what makes the result tileable.
  const x0 = wrap(ix, period);
  const x1 = wrap(ix + 1, period);
  const y0 = wrap(iy, period);
  const y1 = wrap(iy + 1, period);

  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x1, y0, seed);
  const n01 = hash2(x0, y1, seed);
  const n11 = hash2(x1, y1, seed);

  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

export function fbm2D(
  x: number,
  y: number,
  period: number,
  seed: number,
  octaves = 4,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    // Frequency doubles per octave; the period doubles with it, so every
    // octave stays periodic on the ORIGINAL period.
    sum +=
      valueNoise2D(x * frequency, y * frequency, period * frequency, seed + octave * 101) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }
  return sum / norm;
}

export function ridged2D(
  x: number,
  y: number,
  period: number,
  seed: number,
  octaves = 4,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const n = valueNoise2D(x * frequency, y * frequency, period * frequency, seed + octave * 197);
    // Fold around 0.5 and invert: creates sharp crests instead of blobs.
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += ridge * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}
