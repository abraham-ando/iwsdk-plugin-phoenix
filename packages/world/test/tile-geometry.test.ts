import { describe, it, expect } from 'vitest';
import {
  buildTileGeometry,
  tileVertexCount,
  tileTriangleCount,
  SKIRT_DEPTH,
} from '../src/terrain/geometry';
import { sampleTile } from '../src/terrain/sampling';

describe('comptes', () => {
  it('compte la grille plus les quatre jupes', () => {
    const segments = 4;
    const n = segments + 1;
    expect(tileVertexCount(segments)).toBe(n * n + 4 * n);
    expect(tileTriangleCount(segments)).toBe(2 * segments * segments + 4 * 2 * segments);
  });
});

describe('buildTileGeometry', () => {
  const sample = sampleTile(0, 0, 32, 4);
  const geom = buildTileGeometry(sample);

  it('remplit position, couleur et index', () => {
    const verts = tileVertexCount(4);
    expect(geom.getAttribute('position').count).toBe(verts);
    expect(geom.getAttribute('color').count).toBe(verts);
    expect(geom.getIndex()!.count).toBe(tileTriangleCount(4) * 3);
  });

  it('place la grille aux hauteurs échantillonnées, en repère local à la tuile', () => {
    const pos = geom.getAttribute('position');
    const n = 5;
    const step = 32 / 4;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = j * n + i;
        expect(pos.getX(v)).toBeCloseTo(i * step, 4);
        expect(pos.getZ(v)).toBeCloseTo(j * step, 4);
        expect(pos.getY(v)).toBeCloseTo(sample.height[v]!, 4);
      }
    }
  });

  it('SUSPEND la jupe sous le bord, jamais au-dessus', () => {
    // Une jupe qui remonterait percerait la surface et se verrait.
    const pos = geom.getAttribute('position');
    const n = 5;
    for (let v = n * n; v < tileVertexCount(4); v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      let matched = false;
      for (let g = 0; g < n * n && !matched; g++) {
        if (Math.abs(pos.getX(g) - x) < 1e-4 && Math.abs(pos.getZ(g) - z) < 1e-4) {
          expect(pos.getY(v)).toBeCloseTo(pos.getY(g) - SKIRT_DEPTH, 4);
          matched = true;
        }
      }
      expect(matched, `sommet de jupe ${v} sans bord correspondant`).toBe(true);
    }
  });

  it("n'indexe aucun sommet inexistant", () => {
    const idx = geom.getIndex()!;
    const verts = tileVertexCount(4);
    for (let i = 0; i < idx.count; i++) {
      expect(idx.getX(i)).toBeGreaterThanOrEqual(0);
      expect(idx.getX(i)).toBeLessThan(verts);
    }
  });

  it("ORIENTE les jupes vers l'extérieur de la tuile", () => {
    // Une jupe mal orientée est supprimée par le rejet des faces arrière :
    // elle existe dans les données et ne bouche rien à l'écran.
    const pos = geom.getAttribute('position');
    const idx = geom.getIndex()!;
    const centre = 32 / 2;
    const gridTris = 2 * 4 * 4;
    let checked = 0;
    for (let t = gridTris; t < tileTriangleCount(4); t++) {
      const a = idx.getX(t * 3);
      const b = idx.getX(t * 3 + 1);
      const c = idx.getX(t * 3 + 2);
      const ax = pos.getX(a);
      const ay = pos.getY(a);
      const az = pos.getZ(a);
      const ux = pos.getX(b) - ax;
      const uy = pos.getY(b) - ay;
      const uz = pos.getZ(b) - az;
      const vx = pos.getX(c) - ax;
      const vy = pos.getY(c) - ay;
      const vz = pos.getZ(c) - az;
      const nx = uy * vz - uz * vy;
      const nz = ux * vy - uy * vx;
      const cx = (ax + pos.getX(b) + pos.getX(c)) / 3 - centre;
      const cz = (az + pos.getZ(b) + pos.getZ(c)) / 3 - centre;
      if (Math.hypot(nx, nz) < 1e-9) continue;
      expect(nx * cx + nz * cz, `triangle de jupe ${t} orienté vers l'intérieur`).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
