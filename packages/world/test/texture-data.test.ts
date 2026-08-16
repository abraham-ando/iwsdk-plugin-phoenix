import { describe, it, expect } from 'vitest';
import {
  generateHeightField,
  generateAlbedo,
  generateORM,
  generateNormal,
} from '../src/materials/textureData';
import { MATERIAL_DEFINITIONS, MATERIAL_IDS } from '../src/materials/definitions';

const SIZE = 32;
const rock = MATERIAL_DEFINITIONS.rock;

describe('generateHeightField', () => {
  it('produces size² values inside [0, 1]', () => {
    const height = generateHeightField(rock, SIZE);
    expect(height).toHaveLength(SIZE * SIZE);
    for (const v of height) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(Array.from(generateHeightField(rock, SIZE))).toEqual(
      Array.from(generateHeightField(rock, SIZE)),
    );
  });

  it('TILES: the last column continues into the first', () => {
    const height = generateHeightField(rock, SIZE);
    for (let row = 0; row < SIZE; row++) {
      const last = height[row * SIZE + (SIZE - 1)]!;
      const first = height[row * SIZE]!;
      expect(Math.abs(last - first)).toBeLessThan(0.35);
    }
  });

  it('is not flat (there is actual structure)', () => {
    const height = generateHeightField(rock, SIZE);
    expect(Math.max(...height) - Math.min(...height)).toBeGreaterThan(0.2);
  });
});

describe('generateAlbedo', () => {
  it('produces RGBA bytes with opaque alpha', () => {
    const height = generateHeightField(rock, SIZE);
    const albedo = generateAlbedo(rock, height, SIZE);
    expect(albedo).toHaveLength(SIZE * SIZE * 4);
    for (let i = 3; i < albedo.length; i += 4) expect(albedo[i]).toBe(255);
  });

  it('stays within the material palette range', () => {
    const grass = MATERIAL_DEFINITIONS.grass;
    const height = generateHeightField(grass, SIZE);
    const albedo = generateAlbedo(grass, height, SIZE);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < albedo.length; i += 4) {
      r += albedo[i]!;
      g += albedo[i + 1]!;
      b += albedo[i + 2]!;
    }
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});

describe('generateORM', () => {
  it('packs occlusion in R, roughness in G and zero metalness in B', () => {
    const height = generateHeightField(rock, SIZE);
    const orm = generateORM(rock, height, SIZE);
    expect(orm).toHaveLength(SIZE * SIZE * 4);
    for (let i = 0; i < orm.length; i += 4) {
      expect(orm[i + 2]).toBe(0); // dielectric
      expect(orm[i + 3]).toBe(255);
      expect(orm[i + 1]).toBeGreaterThanOrEqual(Math.floor(rock.roughnessLow * 255) - 1);
      expect(orm[i + 1]).toBeLessThanOrEqual(Math.ceil(rock.roughnessHigh * 255) + 1);
    }
  });
});

describe('generateNormal', () => {
  it('produces RGBA bytes centred around the flat normal', () => {
    const height = generateHeightField(rock, SIZE);
    const normal = generateNormal(height, SIZE, rock.normalStrength);
    expect(normal).toHaveLength(SIZE * SIZE * 4);
    let sumB = 0;
    for (let i = 0; i < normal.length; i += 4) {
      expect(normal[i + 3]).toBe(255);
      sumB += normal[i + 2]!;
    }
    expect(sumB / (SIZE * SIZE)).toBeGreaterThan(180);
  });

  it('is flat when the height field is flat', () => {
    const flat = new Float32Array(SIZE * SIZE).fill(0.5);
    const normal = generateNormal(flat, SIZE, 1);
    for (let i = 0; i < normal.length; i += 4) {
      expect(normal[i]).toBe(128); // x = 0
      expect(normal[i + 1]).toBe(128); // y = 0
      expect(normal[i + 2]).toBe(255); // z = 1
    }
  });
});

describe('MATERIAL_DEFINITIONS', () => {
  it('declares every id with a sane palette and roughness range', () => {
    expect(MATERIAL_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of MATERIAL_IDS) {
      const def = MATERIAL_DEFINITIONS[id];
      expect(def.id).toBe(id);
      expect(def.roughnessLow).toBeLessThan(def.roughnessHigh);
      expect(def.roughnessHigh).toBeLessThanOrEqual(1);
      expect(def.octaves).toBeGreaterThan(0);
      for (const channel of [...def.low, ...def.high]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});
