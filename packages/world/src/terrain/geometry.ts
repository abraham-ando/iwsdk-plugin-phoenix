import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from '@iwsdk/core';
import type { TileSample } from './sampling';

/**
 * Profondeur de la jupe, en mètres.
 *
 * Doit dépasser la plus grande fente possible entre deux niveaux voisins :
 * une tuile grossière coupe au droit là où sa voisine fine suit le relief.
 * 2,5 m couvre confortablement l'écart observé sur ce terrain.
 */
export const SKIRT_DEPTH = 2.5;

export function tileVertexCount(segments: number): number {
  const n = segments + 1;
  return n * n + 4 * n;
}

export function tileTriangleCount(segments: number): number {
  return 2 * segments * segments + 4 * 2 * segments;
}

type EdgeOutward = 'minZ' | 'maxZ' | 'minX' | 'maxX';

export function buildTileGeometry(sample: TileSample, skirtDepth = SKIRT_DEPTH): BufferGeometry {
  const { segments, size, height, color } = sample;
  const n = segments + 1;
  const step = size / segments;
  const vertexCount = tileVertexCount(segments);

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(tileTriangleCount(segments) * 3);

  // --- Grille. Repère LOCAL à la tuile : l'entité porte la translation. ---
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      positions[v * 3] = i * step;
      positions[v * 3 + 1] = height[v]!;
      positions[v * 3 + 2] = j * step;
      colors[v * 3] = color[v * 3]!;
      colors[v * 3 + 1] = color[v * 3 + 1]!;
      colors[v * 3 + 2] = color[v * 3 + 2]!;
    }
  }

  let t = 0;
  const tri = (a: number, b: number, c: number): void => {
    indices[t++] = a;
    indices[t++] = b;
    indices[t++] = c;
  };

  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      tri(a, c, b);
      tri(b, c, d);
    }
  }

  // --- Jupes. Un bord = n sommets recopiés, descendus de skirtDepth. ---
  // L'ordre des sommets est choisi pour que l'enroulement produise une normale
  // dirigée VERS L'EXTÉRIEUR : une jupe orientée vers l'intérieur serait
  // supprimée par le rejet des faces arrière et ne boucherait donc rien, tout
  // en existant dans les données — un défaut parfaitement invisible.
  const edges: { grid: (k: number) => number; outward: EdgeOutward }[] = [
    { grid: (k) => k, outward: 'minZ' },
    { grid: (k) => (n - 1) * n + k, outward: 'maxZ' },
    { grid: (k) => k * n, outward: 'minX' },
    { grid: (k) => k * n + (n - 1), outward: 'maxX' },
  ];

  let skirtBase = n * n;
  for (const edge of edges) {
    for (let k = 0; k < n; k++) {
      const g = edge.grid(k);
      const v = skirtBase + k;
      positions[v * 3] = positions[g * 3]!;
      positions[v * 3 + 1] = positions[g * 3 + 1]! - skirtDepth;
      positions[v * 3 + 2] = positions[g * 3 + 2]!;
      colors[v * 3] = colors[g * 3]!;
      colors[v * 3 + 1] = colors[g * 3 + 1]!;
      colors[v * 3 + 2] = colors[g * 3 + 2]!;
    }
    for (let k = 0; k < segments; k++) {
      const g0 = edge.grid(k);
      const g1 = edge.grid(k + 1);
      const s0 = skirtBase + k;
      const s1 = skirtBase + k + 1;
      // Vérifié au produit vectoriel bord par bord : minZ et maxX veulent
      // (g0, g1, s0), maxZ et minX veulent (g0, s0, g1). Les deux formes ne
      // sont PAS interchangeables — se tromper rend la jupe invisible sans
      // rien signaler.
      if (edge.outward === 'minZ' || edge.outward === 'maxX') {
        tri(g0, g1, s0);
        tri(g1, s1, s0);
      } else {
        tri(g0, s0, g1);
        tri(g1, s0, s1);
      }
    }
    skirtBase += n;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
