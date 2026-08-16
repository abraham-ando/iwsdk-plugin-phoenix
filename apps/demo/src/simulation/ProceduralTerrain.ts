/**
 * Procedural Terrain Generator with Multi-Layered Biomes & Vertex Colors.
 * Creates rolling hills, sandy riverbanks, agricultural terraces and rocky
 * crags. The height/river/shore math lives in @iwsdk/cardinal-simulation
 * (single source of truth shared with the headless engine); this class only
 * builds the render mesh on top of it.
 */

import {
  PlaneGeometry,
  MeshStandardMaterial,
  Mesh,
  Color,
  Float32BufferAttribute,
} from '@iwsdk/core';
import {
  getTerrainHeight,
  isRiverAt,
  isShoreAt,
  riverCenterX,
  biomeAt,
  BIOME_IDS,
  type BiomeId,
} from '@iwsdk/cardinal-simulation';
import type { MaterialLibrary } from '@iwsdk/cardinal-world';

export interface TerrainData {
  mesh: Mesh;
  getHeight: (x: number, z: number) => number;
  isRiver: (x: number, z: number) => boolean;
  size: number;
}

export class ProceduralTerrain {
  public static readonly SIZE = 64;
  public static readonly SEGMENTS = 96;

  /**
   * Continuous height lookup — delegates to the simulation engine.
   */
  public static getHeight(x: number, z: number): number {
    return getTerrainHeight(x, z);
  }

  /**
   * Checks if coordinate is in the riverbed channel.
   */
  public static isRiver(x: number, z: number): boolean {
    return isRiverAt(x, z);
  }

  /**
   * Checks if coordinate is on the sandy river shoreline.
   */
  public static isShore(x: number, z: number): boolean {
    return isShoreAt(x, z);
  }

  /**
   * Builds the procedural vertex-colored terrain mesh.
   */
  public static createTerrain(materials?: MaterialLibrary): TerrainData {
    const size = this.SIZE;
    const segments = this.SEGMENTS;
    const geom = new PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);

    const posAttr = geom.attributes.position;
    const colors: number[] = [];

    // Color palette
    const colDeepGrass = new Color(0x365314); // Dark emerald mossy grass
    const colLushGrass = new Color(0x65a30d); // Vibrant sunlit meadow grass
    const colGoldenGrass = new Color(0x84cc16); // High hill golden grass
    const colSand = new Color(0xd4a373); // Warm river shore sand
    const colDirt = new Color(0x78350f); // Rich agricultural dirt
    const colRock = new Color(0x64748b); // Mountain cliff rock

    // Une teinte par biome du moteur. Les seuils d'altitude codés en dur qui
    // vivaient ici (roche au-dessus de 4,5 m) encodaient l'ancienne plage de
    // relief et ne se déclencheraient plus jamais : le sol qu'on voit et les
    // ressources que les agents y trouvent découlent maintenant du même calcul.
    const biomeColors: Record<BiomeId, Color> = {
      ocean: new Color(0x1e3a5f),
      beach: colSand,
      wetland: new Color(0x4d7c0f),
      grassland: colLushGrass,
      forest: colDeepGrass,
      rock: colRock,
      alpine: new Color(0xe2e8f0),
    };

    // Alloué une fois : la boucle couvre 9409 sommets.
    const vertexCol = new Color();

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const y = this.getHeight(x, z);
      posAttr.setY(i, y);

      const distToRiver = Math.abs(x - riverCenterX(z));

      if (distToRiver < 2.4) {
        // Riverbed — la rivière n'est pas un biome en phase 3A.
        vertexCol.copy(colSand).lerp(colDirt, 0.4);
      } else if (distToRiver < 4.5) {
        // Sandy River Shoreline
        const shoreFactor = (distToRiver - 2.4) / 2.1;
        vertexCol.copy(colSand).lerp(colLushGrass, shoreFactor);
      } else {
        const { weights } = biomeAt(x, z);
        vertexCol.setRGB(0, 0, 0);
        for (const id of BIOME_IDS) {
          const w = weights[id];
          if (w <= 0) continue;
          const c = biomeColors[id];
          vertexCol.r += c.r * w;
          vertexCol.g += c.g * w;
          vertexCol.b += c.b * w;
        }
        // Les hauteurs dorent l'herbe, comme avant.
        if (y > 1.5) vertexCol.lerp(colGoldenGrass, Math.min(1, (y - 1.5) / 2.5));
      }

      colors.push(vertexCol.r, vertexCol.g, vertexCol.b);
    }

    geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    // The library material carries grain and relief; vertex colours keep
    // carrying the biome hues on top of it. clone() is deliberate: the
    // terrain needs vertexColors, which other users of 'grass' do not want.
    // The clone shares the same textures — only the material object is new.
    let mat: MeshStandardMaterial;
    if (materials) {
      mat = materials.get('grass').clone();
      mat.vertexColors = true;
    } else {
      mat = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0.05,
        flatShading: false,
      });
    }

    const mesh = new Mesh(geom, mat);
    mesh.name = 'Procedural_Terrain_Mesh';
    mesh.receiveShadow = true;

    return {
      mesh,
      getHeight: (x: number, z: number) => this.getHeight(x, z),
      isRiver: (x: number, z: number) => this.isRiver(x, z),
      size,
    };
  }
}
