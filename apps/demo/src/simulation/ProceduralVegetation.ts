/**
 * Procedural Vegetation & Flora Generator.
 * Creates Italian Cypress trees, volumetric Oak trees, mountain Pines,
 * vineyard crop rows, wildflower patches, and mossy field boulders.
 */

import {
  Group,
  Mesh,
  CylinderGeometry,
  SphereGeometry,
  BoxGeometry,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Color,
} from '@iwsdk/core';

export class ProceduralVegetation {
  /**
   * Slender Italian Cypress Tree (as seen in Image 1).
   */
  public static createCypressTree(scale: number = 1.0): Group {
    const tree = new Group();
    tree.name = 'Cypress_Tree';

    const trunkMat = new MeshStandardMaterial({ color: 0x3f2e21, roughness: 0.9 });
    const foliageMat = new MeshStandardMaterial({
      color: 0x14532d, // Dark emerald green
      roughness: 0.8,
    });

    // Slender lower trunk
    const trunk = new Mesh(new CylinderGeometry(0.1 * scale, 0.14 * scale, 1.2 * scale, 8), trunkMat);
    trunk.position.set(0, 0.6 * scale, 0);
    tree.add(trunk);

    // Conical tall slender foliage
    const cone1 = new Mesh(new CylinderGeometry(0.25 * scale, 0.5 * scale, 2.2 * scale, 8), foliageMat);
    cone1.position.set(0, 1.8 * scale, 0);
    tree.add(cone1);

    const cone2 = new Mesh(new CylinderGeometry(0.1 * scale, 0.38 * scale, 2.4 * scale, 8), foliageMat);
    cone2.position.set(0, 3.4 * scale, 0);
    tree.add(cone2);

    const tip = new Mesh(new CylinderGeometry(0, 0.18 * scale, 1.4 * scale, 8), foliageMat);
    tip.position.set(0, 4.8 * scale, 0);
    tree.add(tip);

    return tree;
  }

  /**
   * Volumetric Broadleaf Oak Tree (as seen in Images 1 & 5).
   */
  public static createOakTree(scale: number = 1.0): Group {
    const tree = new Group();
    tree.name = 'Oak_Tree';

    const trunkMat = new MeshStandardMaterial({ color: 0x451a03, roughness: 0.85 });
    const foliageMat = new MeshStandardMaterial({
      color: 0x22c55e, // Vibrant leafy green
      roughness: 0.75,
    });

    // Sturdy rugged trunk
    const trunk = new Mesh(new CylinderGeometry(0.22 * scale, 0.35 * scale, 2.0 * scale, 8), trunkMat);
    trunk.position.set(0, 1.0 * scale, 0);
    tree.add(trunk);

    // Interlocking volumetric foliage spheres for lush organic canopy
    const canopyOffsets: [number, number, number, number][] = [
      [0, 2.4 * scale, 0, 1.1 * scale],
      [-0.6 * scale, 2.2 * scale, 0.4 * scale, 0.85 * scale],
      [0.6 * scale, 2.3 * scale, -0.3 * scale, 0.9 * scale],
      [0.2 * scale, 2.6 * scale, 0.5 * scale, 0.75 * scale],
      [-0.4 * scale, 2.8 * scale, -0.4 * scale, 0.8 * scale],
    ];

    for (const [ox, oy, oz, r] of canopyOffsets) {
      const leafCluster = new Mesh(new SphereGeometry(r, 8, 8), foliageMat);
      leafCluster.position.set(ox, oy, oz);
      tree.add(leafCluster);
    }

    return tree;
  }

  /**
   * Wildflower Meadow Patch (as seen in Image 5).
   * Spawns clusters of purple lavender, golden marigolds, and white daisies.
   */
  public static createWildflowerPatch(): Group {
    const patch = new Group();
    patch.name = 'Wildflower_Patch';

    const stemMat = new MeshStandardMaterial({ color: 0x166534, roughness: 0.8 });
    const flowerColors = [
      0xa855f7, // Lavender purple
      0xfacc15, // Golden marigold
      0xf8fafc, // White daisy
      0xef4444, // Red poppy
    ];

    for (let i = 0; i < 14; i++) {
      const col = flowerColors[i % flowerColors.length];
      const petalMat = new MeshStandardMaterial({
        color: col,
        emissive: new Color(col).multiplyScalar(0.2),
        roughness: 0.4,
      });

      const fx = (Math.random() - 0.5) * 1.6;
      const fz = (Math.random() - 0.5) * 1.6;
      const h = 0.25 + Math.random() * 0.25;

      // Stem
      const stem = new Mesh(new CylinderGeometry(0.015, 0.015, h, 4), stemMat);
      stem.position.set(fx, h * 0.5, fz);
      patch.add(stem);

      // Petal head
      const blossom = new Mesh(new SphereGeometry(0.05, 5, 5), petalMat);
      blossom.position.set(fx, h, fz);
      patch.add(blossom);
    }

    return patch;
  }

  /**
   * Cultivated Agricultural Crop Rows / Vineyard (as seen in Image 1).
   */
  public static createVineyardTerrace(): Group {
    const terrace = new Group();
    terrace.name = 'Vineyard_Terrace';

    const cropMat = new MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 });
    const postMat = new MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });

    // 6 linear parallel hedgerows
    for (let row = 0; row < 6; row++) {
      const rowX = row * 1.1;

      // Continuous hedge mound
      const hedge = new Mesh(new BoxGeometry(0.45, 0.55, 6.0), cropMat);
      hedge.position.set(rowX, 0.28, 0);
      terrace.add(hedge);

      // Wooden support posts
      for (let p = -2.8; p <= 2.8; p += 1.4) {
        const post = new Mesh(new CylinderGeometry(0.03, 0.03, 0.8, 4), postMat);
        post.position.set(rowX, 0.4, p);
        terrace.add(post);
      }
    }

    return terrace;
  }

  /**
   * Mossy Field Boulder / River Rock (as seen in Images 1, 3, 5).
   */
  public static createMossyBoulder(scale: number = 1.0): Group {
    const rockGroup = new Group();
    rockGroup.name = 'Mossy_Boulder';

    const rockMat = new MeshStandardMaterial({
      color: 0x4b5563,
      roughness: 0.8,
      metalness: 0.15,
    });
    const mossMat = new MeshStandardMaterial({
      color: 0x365314, // Velvet dark moss
      roughness: 0.9,
    });

    const boulder = new Mesh(new IcosahedronGeometry(0.6 * scale, 1), rockMat);
    boulder.scale.set(1.1, 0.7, 0.9);
    boulder.position.set(0, 0.35 * scale, 0);
    rockGroup.add(boulder);

    // Moss layer cap on top
    const mossCap = new Mesh(new SphereGeometry(0.45 * scale, 6, 6), mossMat);
    mossCap.scale.set(1.0, 0.35, 0.8);
    mossCap.position.set(0, 0.52 * scale, 0);
    rockGroup.add(mossCap);

    return rockGroup;
  }
}
