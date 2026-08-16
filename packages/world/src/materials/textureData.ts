import { fbm2D, ridged2D } from './noise';
import type { MaterialDefinition } from './definitions';

/**
 * Pure texture generation (spec §5): typed arrays in, typed arrays out.
 * No canvas, no DOM, no GPU — which is why every pixel rule here is unit
 * tested. MaterialLibrary only wraps the result in DataTexture objects.
 */

/** Grayscale structure the other maps are derived from. */
export function generateHeightField(definition: MaterialDefinition, size: number): Float32Array {
  const height = new Float32Array(size * size);
  const sample = definition.pattern === 'ridged' ? ridged2D : fbm2D;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map pixel space onto the noise period so the texture tiles exactly.
      const nx = (x / size) * definition.frequency;
      const ny = (y / size) * definition.frequency;
      height[y * size + x] = sample(
        nx,
        ny,
        definition.frequency,
        definition.seed,
        definition.octaves,
      );
    }
  }
  return height;
}

const toByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

export function generateAlbedo(
  definition: MaterialDefinition,
  height: Float32Array,
  size: number,
): Uint8Array {
  const albedo = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const t = height[i]!;
    albedo[i * 4] = toByte(definition.low[0] + (definition.high[0] - definition.low[0]) * t);
    albedo[i * 4 + 1] = toByte(definition.low[1] + (definition.high[1] - definition.low[1]) * t);
    albedo[i * 4 + 2] = toByte(definition.low[2] + (definition.high[2] - definition.low[2]) * t);
    albedo[i * 4 + 3] = 255;
  }
  return albedo;
}

/** glTF convention: R = ambient occlusion, G = roughness, B = metalness. */
export function generateORM(
  definition: MaterialDefinition,
  height: Float32Array,
  size: number,
): Uint8Array {
  const orm = new Uint8Array(size * size * 4);
  const span = definition.roughnessHigh - definition.roughnessLow;
  for (let i = 0; i < size * size; i++) {
    const t = height[i]!;
    // Crevices (low height) are both rougher and more occluded.
    orm[i * 4] = toByte(0.55 + 0.45 * t);
    orm[i * 4 + 1] = toByte(definition.roughnessHigh - span * t);
    orm[i * 4 + 2] = 0;
    orm[i * 4 + 3] = 255;
  }
  return orm;
}

export function generateNormal(height: Float32Array, size: number, strength: number): Uint8Array {
  const normal = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => {
    // Wrap so the normal map tiles as cleanly as the height field.
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return height[wy * size + wx]!;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Tangent-space normal from the height gradient, then normalised.
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      normal[i] = toByte((nx / length) * 0.5 + 0.5);
      normal[i + 1] = toByte((ny / length) * 0.5 + 0.5);
      normal[i + 2] = toByte((nz / length) * 0.5 + 0.5);
      normal[i + 3] = 255;
    }
  }
  return normal;
}
