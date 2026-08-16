import {
  DataTexture,
  MeshStandardMaterial,
  RGBAFormat,
  UnsignedByteType,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
} from '@iwsdk/core';
import type { QualityTier } from '../core/quality';
import { MATERIAL_DEFINITIONS, type MaterialId } from './definitions';
import { generateHeightField, generateAlbedo, generateORM, generateNormal } from './textureData';

/** Texture resolution per quality tier (spec §5). */
export const TEXTURE_SIZE: Record<QualityTier, number> = { low: 512, high: 1024 };

/**
 * Shared, lazily generated PBR materials (spec §5).
 *
 * Two properties earn their keep: materials are generated only on first
 * request (a 1024² RGBA texture is 4 MB — generating the whole catalogue
 * up front would waste VRAM), and every entity shares one instance per id,
 * which is what keeps the draw-call budget reachable on a headset.
 *
 * The library also OWNS disposal — the code it replaces leaked a material
 * per mesh.
 */
export class MaterialLibrary {
  private readonly materials = new Map<MaterialId, MeshStandardMaterial>();
  private readonly textures: DataTexture[] = [];

  constructor(private readonly quality: QualityTier) {}

  get size(): number {
    return this.materials.size;
  }

  has(id: MaterialId): boolean {
    return this.materials.has(id);
  }

  get(id: MaterialId): MeshStandardMaterial {
    const cached = this.materials.get(id);
    if (cached !== undefined) return cached;

    const definition = MATERIAL_DEFINITIONS[id];
    const size = TEXTURE_SIZE[this.quality];
    const height = generateHeightField(definition, size);

    const albedoMap = this.makeTexture(
      generateAlbedo(definition, height, size),
      size,
      SRGBColorSpace,
    );
    const normalMap = this.makeTexture(
      generateNormal(height, size, definition.normalStrength),
      size,
      NoColorSpace,
    );
    const ormMap = this.makeTexture(generateORM(definition, height, size), size, NoColorSpace);

    const material = new MeshStandardMaterial({
      map: albedoMap,
      normalMap,
      // glTF convention: one ORM texture, three slots reading their channel.
      roughnessMap: ormMap,
      metalnessMap: ormMap,
      aoMap: ormMap,
      roughness: 1,
      metalness: 0,
    });
    this.materials.set(id, material);
    return material;
  }

  private makeTexture(
    data: Uint8Array,
    size: number,
    colorSpace: typeof SRGBColorSpace | typeof NoColorSpace,
  ): DataTexture {
    const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    texture.colorSpace = colorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
    this.textures.push(texture);
    return texture;
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.materials.clear();
    this.textures.length = 0;
  }
}
