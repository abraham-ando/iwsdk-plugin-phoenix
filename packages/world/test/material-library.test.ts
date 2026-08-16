import { describe, it, expect } from 'vitest';
import { MaterialLibrary, TEXTURE_SIZE } from '../src/materials/MaterialLibrary';

describe('MaterialLibrary', () => {
  it('generates a material lazily and caches the instance', () => {
    const library = new MaterialLibrary('low');
    expect(library.size).toBe(0);
    expect(library.has('rock')).toBe(false);

    const first = library.get('rock');
    expect(library.size).toBe(1);
    expect(library.has('rock')).toBe(true);

    // Same instance: sharing materials is what keeps draw calls down.
    expect(library.get('rock')).toBe(first);
    expect(library.size).toBe(1);
  });

  it('wires the three maps with glTF ORM channel sharing', () => {
    const material = new MaterialLibrary('low').get('rock') as unknown as {
      map: { width: number; colorSpace: string };
      normalMap: { colorSpace: string };
      roughnessMap: unknown;
      metalnessMap: unknown;
      aoMap: unknown;
    };
    expect(material.map).toBeTruthy();
    expect(material.normalMap).toBeTruthy();
    // One ORM texture feeds roughness, metalness and occlusion.
    expect(material.roughnessMap).toBe(material.metalnessMap);
    expect(material.roughnessMap).toBe(material.aoMap);
  });

  it('assigns colour spaces correctly (albedo sRGB, data maps linear)', () => {
    const material = new MaterialLibrary('low').get('sand') as unknown as {
      map: { colorSpace: string };
      normalMap: { colorSpace: string };
      roughnessMap: { colorSpace: string };
    };
    expect(material.map.colorSpace).toBe('srgb');
    expect(material.normalMap.colorSpace).toBe('');
    expect(material.roughnessMap.colorSpace).toBe('');
  });

  it('honours the quality tier texture size', () => {
    expect(TEXTURE_SIZE.low).toBe(512);
    expect(TEXTURE_SIZE.high).toBe(1024);
    const low = new MaterialLibrary('low').get('grass') as unknown as { map: { width: number } };
    const high = new MaterialLibrary('high').get('grass') as unknown as { map: { width: number } };
    expect(low.map.width).toBe(512);
    expect(high.map.width).toBe(1024);
  });

  it('marks textures as repeating so they tile on large surfaces', () => {
    const material = new MaterialLibrary('low').get('grass') as unknown as {
      map: { wrapS: number; wrapT: number; needsUpdate: boolean };
    };
    expect(material.map.wrapS).toBe(1000);
    expect(material.map.wrapT).toBe(1000);
    expect(material.map.needsUpdate).toBe(true);
  });

  it('dispose releases every material and texture it created', () => {
    const library = new MaterialLibrary('low');
    const material = library.get('bark') as unknown as {
      disposed: boolean;
      map: { disposed: boolean };
      normalMap: { disposed: boolean };
      roughnessMap: { disposed: boolean };
    };
    library.dispose();
    expect(material.disposed).toBe(true);
    expect(material.map.disposed).toBe(true);
    expect(material.normalMap.disposed).toBe(true);
    expect(material.roughnessMap.disposed).toBe(true);
    expect(library.size).toBe(0);
  });
});
