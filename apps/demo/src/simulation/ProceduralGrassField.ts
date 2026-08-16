/**
 * Procedural Volumetric Grass Field with Wind Simulation.
 * Generates thousands of lush, wind-responsive stylized grass tufts
 * using InstancedMesh with heightmap projection.
 */

import {
  InstancedMesh,
  PlaneGeometry,
  MeshStandardMaterial,
  Color,
  Group,
  Float32BufferAttribute,
} from '@iwsdk/core';
import { getTerrainHeight, isRiverAt } from '@iwsdk/cardinal-simulation';

/**
 * L'herbe n'habille que les abords immédiats du joueur, pas tout le terrain.
 * Elle dérivait de ProceduralTerrain.SIZE, ce qui n'avait plus de sens dès que
 * le terrain est devenu infini : la même densité se serait diluée sur un km².
 */
const GRASS_SPREAD = 28.8;

export class ProceduralGrassField {
  private instancedGrass: InstancedMesh | null = null;
  private count: number;
  private basePositions: { x: number; y: number; z: number; rotY: number; scale: number }[] = [];
  private dummyGroup = new Group();

  constructor(count: number = 3200) {
    this.count = count;
  }

  /**
   * Builds the instanced grass field across the procedural landscape.
   */
  public createGrass(): InstancedMesh {
    // Stylized dual-sided curved grass blade geometry
    const bladeGeom = new PlaneGeometry(0.18, 0.65, 1, 3);
    bladeGeom.translate(0, 0.325, 0); // Origin at blade base

    // Blade vertex colors: dark emerald root -> vibrant sunlit lime tip
    const colRoot = new Color(0x2d4a1d);
    const colTip = new Color(0x84cc16);
    const bladeColors: number[] = [];
    const pos = bladeGeom.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const factor = Math.min(1, Math.max(0, y / 0.65));
      const c = new Color().copy(colRoot).lerp(colTip, factor);
      bladeColors.push(c.r, c.g, c.b);
    }
    bladeGeom.setAttribute('color', new Float32BufferAttribute(bladeColors, 3));

    const mat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.05,
      side: 2, // DoubleSide
    });

    this.instancedGrass = new InstancedMesh(bladeGeom, mat, this.count);
    this.instancedGrass.name = 'Procedural_Grass_Instanced';
    this.instancedGrass.receiveShadow = true;

    this.basePositions = [];

    // Distribute grass across the meadow and rolling hills
    const spread = GRASS_SPREAD;
    let placed = 0;
    let attempts = 0;

    while (placed < this.count && attempts < this.count * 4) {
      attempts++;
      const x = (Math.random() - 0.5) * spread * 2;
      const z = (Math.random() - 0.5) * spread * 2 - 4.0;

      // Skip inside the river channel
      if (isRiverAt(x, z)) continue;

      const y = getTerrainHeight(x, z);

      // Grass density is higher on sunny meadows and hills
      const scale = 0.75 + Math.random() * 0.55;
      const rotY = Math.random() * Math.PI * 2;

      this.basePositions.push({ x, y, z, rotY, scale });

      this.dummyGroup.position.set(x, y, z);
      this.dummyGroup.rotation.set(0, rotY, 0);
      this.dummyGroup.scale.set(scale, scale, scale);
      this.dummyGroup.updateMatrix();

      this.instancedGrass.setMatrixAt(placed, this.dummyGroup.matrix);
      placed++;
    }

    this.instancedGrass.instanceMatrix.needsUpdate = true;
    return this.instancedGrass;
  }

  /**
   * Animate wind wave propagation across the grass blades.
   */
  public updateWind(timeSeconds: number): void {
    if (!this.instancedGrass) return;

    const windSpeed = 1.8;
    const windFreq = 0.25;

    for (let i = 0; i < this.basePositions.length; i++) {
      const p = this.basePositions[i];
      // Spatial wind wave moving diagonally across the hills
      const wave = Math.sin((p.x + p.z) * windFreq + timeSeconds * windSpeed);
      const windBend = wave * 0.18;

      this.dummyGroup.position.set(p.x, p.y, p.z);
      this.dummyGroup.rotation.set(windBend, p.rotY, windBend * 0.6);
      this.dummyGroup.scale.set(p.scale, p.scale, p.scale);
      this.dummyGroup.updateMatrix();

      this.instancedGrass.setMatrixAt(i, this.dummyGroup.matrix);
    }

    this.instancedGrass.instanceMatrix.needsUpdate = true;
  }
}
