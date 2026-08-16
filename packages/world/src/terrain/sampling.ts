import {
  heightAt,
  landMaskAt,
  humidityAt,
  riverCenterX,
  classifyBiome,
  BIOME_IDS,
  type BiomeId,
} from '@iwsdk/cardinal-simulation';

/**
 * Échantillonnage d'une tuile EN GRILLE (spec §6).
 *
 * L'astuce tient en une phrase : la pente se dérive des voisins déjà calculés
 * au lieu d'être redemandée point par point. Mesuré sur une tuile 33×33,
 * 7,87 ms deviennent 0,98 ms — la différence entre un streaming impossible et
 * un streaming à une tuile par image, dans un budget VR de 11 à 14 ms.
 */
export interface TileSample {
  readonly size: number;
  readonly segments: number;
  readonly height: Float32Array;
  readonly slope: Float32Array;
  readonly color: Float32Array;
}

/** Teinte par biome. Le sol qu'on voit suit la classification du moteur. */
export const BIOME_RGB: Readonly<Record<BiomeId, readonly [number, number, number]>> = {
  ocean: [0.118, 0.227, 0.373],
  beach: [0.831, 0.639, 0.451],
  wetland: [0.302, 0.486, 0.059],
  grassland: [0.396, 0.639, 0.051],
  forest: [0.212, 0.325, 0.078],
  rock: [0.392, 0.455, 0.545],
  alpine: [0.886, 0.906, 0.925],
};

export function sampleTile(
  originX: number,
  originZ: number,
  size: number,
  segments: number,
): TileSample {
  const n = segments + 1;
  const step = size / segments;
  const height = new Float32Array(n * n);
  const slope = new Float32Array(n * n);
  const color = new Float32Array(n * n * 3);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      height[j * n + i] = heightAt(originX + i * step, originZ + j * step);
    }
  }

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // Différences centrées, repliées aux bords : la tuile ne connaît pas ses
      // voisines, mais un bord légèrement approché est invisible et gratuit.
      const i0 = i > 0 ? i - 1 : i;
      const i1 = i < n - 1 ? i + 1 : i;
      const j0 = j > 0 ? j - 1 : j;
      const j1 = j < n - 1 ? j + 1 : j;
      const dx = (height[j * n + i1]! - height[j * n + i0]!) / ((i1 - i0) * step);
      const dz = (height[j1 * n + i]! - height[j0 * n + i]!) / ((j1 - j0) * step);
      const s = Math.atan(Math.hypot(dx, dz));
      slope[j * n + i] = s;

      const x = originX + i * step;
      const z = originZ + j * step;
      const sample = classifyBiome(
        height[j * n + i]!,
        s,
        landMaskAt(x, z),
        humidityAt(x, z),
        Math.abs(x - riverCenterX(z)),
      );
      let r = 0;
      let g = 0;
      let b = 0;
      for (const id of BIOME_IDS) {
        const w = sample.weights[id];
        if (w <= 0) continue;
        const rgb = BIOME_RGB[id];
        r += rgb[0] * w;
        g += rgb[1] * w;
        b += rgb[2] * w;
      }
      color[(j * n + i) * 3] = r;
      color[(j * n + i) * 3 + 1] = g;
      color[(j * n + i) * 3 + 2] = b;
    }
  }

  return { size, segments, height, slope, color };
}
