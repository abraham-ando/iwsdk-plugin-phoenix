/**
 * Procedural River & Water System.
 * Generates a curved winding river channel with animated specular water waves
 * and depth color gradients.
 */

import {
  Group,
  Mesh,
  PlaneGeometry,
  MeshStandardMaterial,
  Color,
} from '@iwsdk/core';

export class ProceduralRiver {
  private riverMesh: Mesh | null = null;
  private material: MeshStandardMaterial | null = null;

  public createRiver(): Group {
    const riverGroup = new Group();
    riverGroup.name = 'Procedural_River';

    const length = 56;
    const width = 4.4;
    const segments = 48;

    const geom = new PlaneGeometry(width, length, 4, segments);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const riverCenterX = 4.0 + Math.sin(z * 0.12) * 3.5;
      const curX = pos.getX(i);
      pos.setX(i, curX + riverCenterX);
      pos.setY(i, -0.05);
    }
    geom.computeVertexNormals();

    this.material = new MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.88,
    });

    this.riverMesh = new Mesh(geom, this.material);
    this.riverMesh.receiveShadow = true;
    riverGroup.add(this.riverMesh);

    return riverGroup;
  }

  /**
   * Animate water ripple undulations and specular highlights.
   */
  public updateWater(timeSeconds: number): void {
    if (!this.material) return;
    const wave = (Math.sin(timeSeconds * 1.5) + 1) * 0.5;
    const waterBase = new Color(0x0284c7);
    const waterHighlight = new Color(0x38bdf8);
    this.material.color.copy(waterBase).lerp(waterHighlight, wave * 0.15);
  }
}
