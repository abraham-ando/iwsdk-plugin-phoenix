/**
 * Procedural River & Water System.
 * Generates a curved winding river channel with animated specular water waves
 * and depth color gradients.
 */

import { Group, Mesh, PlaneGeometry, MeshStandardMaterial, Color } from '@iwsdk/core';
// L'axe de la rivière vient du moteur : le ruban d'eau et le lit creusé dans le
// terrain suivent la même courbe par construction, jamais par recopie.
import { getRiverCourse, riverSurfaceAt } from '@iwsdk/cardinal-simulation';

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

    // Le ruban suit le COURS et descend avec lui : la nappe n'est plus un plan
    // posé à -0,05 m, elle a la pente que le moteur lui donne.
    const course = getRiverCourse();
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const along = pos.getZ(i) / length + 0.5; // [0, 1] le long du plan
      const idx = Math.min(
        course.points.length - 1,
        Math.max(0, Math.round(along * (course.points.length - 1))),
      );
      const p = course.points[idx]!;
      const lateral = pos.getX(i);
      pos.setX(i, p.x + lateral * ((p.width * 1.6) / width));
      pos.setZ(i, p.z);
      pos.setY(i, riverSurfaceAt(p.x, p.z) + 0.05);
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
