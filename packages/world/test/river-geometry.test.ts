import { describe, it, expect } from 'vitest';
import {
  buildRiverGeometry,
  riverVertexCount,
  RIVER_COLUMNS,
  WATER_EDGE_LIFT,
} from '../src/water/riverGeometry';
import { getRiverCourse, riverSurfaceAt, heightAt } from '@iwsdk/cardinal-simulation';

describe('buildRiverGeometry', () => {
  const geom = buildRiverGeometry();
  const course = getRiverCourse();

  it('maille une rangée par point de cours', () => {
    expect(riverVertexCount(course.points.length)).toBe(course.points.length * RIVER_COLUMNS);
    expect(geom.getAttribute('position').count).toBe(riverVertexCount(course.points.length));
  });

  it("porte la profondeur et l'écoulement par sommet", () => {
    const verts = riverVertexCount(course.points.length);
    expect(geom.getAttribute('aDepth').count).toBe(verts);
    expect(geom.getAttribute('aFlow').count).toBe(verts);
  });

  it('POSE LA NAPPE À LA HAUTEUR DU MOTEUR, jamais à une réimplémentation', () => {
    // Si la surface d'eau divergeait de riverSurfaceAt, la rivière flotterait
    // au-dessus de son lit ou disparaîtrait dedans.
    const pos = geom.getAttribute('position');
    for (let row = 0; row < course.points.length; row += 7) {
      const centre = row * RIVER_COLUMNS + Math.floor(RIVER_COLUMNS / 2);
      const p = course.points[row]!;
      expect(pos.getY(centre)).toBeCloseTo(riverSurfaceAt(p.x, p.z) + WATER_EDGE_LIFT, 4);
    }
  });

  it('rend une profondeur positive, nulle aux berges et maximale au centre', () => {
    const depth = geom.getAttribute('aDepth');
    for (let i = 0; i < depth.count; i++) expect(depth.getX(i)).toBeGreaterThanOrEqual(0);

    let checked = 0;
    for (let row = 0; row < course.points.length; row += 11) {
      const base = row * RIVER_COLUMNS;
      const left = depth.getX(base);
      const right = depth.getX(base + RIVER_COLUMNS - 1);
      // Près de l'embouchure la vallée est noyée sur toute sa largeur : la
      // recherche de rive bute alors sur sa borne et le bord est légitimement
      // plus profond que l'axe. Le profil en chenal ne vaut que là où le ruban
      // touche réellement terre.
      if (left > 0.05 || right > 0.05) continue;
      const centre = depth.getX(base + Math.floor(RIVER_COLUMNS / 2));
      expect(left, `berge gauche, rangée ${row}`).toBeLessThanOrEqual(centre);
      expect(right, `berge droite, rangée ${row}`).toBeLessThanOrEqual(centre);
      checked++;
    }
    expect(checked, 'rangées à profil de chenal vérifiées').toBeGreaterThan(5);
  });

  it("MEURT À ZÉRO SUR LA RIVE : sans cela, ni écume ni estompage", () => {
    // L'écume et l'alpha du bord s'éteignent tous deux à profondeur nulle. Une
    // marge fixe laissait un demi-mètre d'eau au bord du ruban, et aucun des
    // deux ne se déclenchait jamais.
    const depth = geom.getAttribute('aDepth');
    const rows = course.points.length;
    let dry = 0;
    for (let row = 0; row < rows; row++) {
      const base = row * RIVER_COLUMNS;
      if (depth.getX(base) < 0.02 && depth.getX(base + RIVER_COLUMNS - 1) < 0.02) dry++;
    }
    // Quelques rangées peuvent buter sur la borne de recherche, là où la vallée
    // est noyée sur toute sa largeur ; la grande majorité doit toucher terre.
    expect(dry / rows, 'proportion de rangées atteignant les deux rives').toBeGreaterThan(0.8);
  });

  it('accorde la profondeur avec le terrain du moteur', () => {
    const pos = geom.getAttribute('position');
    const depth = geom.getAttribute('aDepth');
    for (let i = 0; i < pos.count; i += 13) {
      const expected = Math.max(
        0,
        pos.getY(i) - WATER_EDGE_LIFT - heightAt(pos.getX(i), pos.getZ(i)),
      );
      expect(depth.getX(i)).toBeCloseTo(expected, 4);
    }
  });

  it("porte une direction d'écoulement unitaire", () => {
    const flow = geom.getAttribute('aFlow');
    for (let i = 0; i < flow.count; i += 17) {
      expect(Math.hypot(flow.getX(i), flow.getY(i))).toBeCloseTo(1, 4);
    }
  });

  it('indexe deux triangles par quad, sans sommet inexistant', () => {
    const idx = geom.getIndex()!;
    const rows = course.points.length;
    expect(idx.count).toBe((rows - 1) * (RIVER_COLUMNS - 1) * 6);
    const verts = riverVertexCount(rows);
    for (let i = 0; i < idx.count; i += 7) {
      expect(idx.getX(i)).toBeGreaterThanOrEqual(0);
      expect(idx.getX(i)).toBeLessThan(verts);
    }
  });

  it("NE S'ÉTALE PAS EN INONDATION : la largeur reste celle d'une rivière", () => {
    // Sans borne, le ruban atteignait 96 m là où le fond de vallée passe sous
    // la nappe. L'eau SERAIT géométriquement si large, mais cela se lit comme
    // une inondation ; ce qui déborde relève du marais, hors périmètre.
    const pos = geom.getAttribute('position');
    for (let row = 0; row < course.points.length; row++) {
      const a = row * RIVER_COLUMNS;
      const b = a + RIVER_COLUMNS - 1;
      const span = Math.hypot(pos.getX(b) - pos.getX(a), pos.getZ(b) - pos.getZ(a));
      // Tolérance à 1 cm : les positions sont stockées en flottants 32 bits,
      // dont la précision est plus grossière qu'un epsilon symbolique.
      expect(span, `rangée ${row}`).toBeLessThanOrEqual(course.points[row]!.width * 5 + 0.01);
    }
  });

  it('ne produit aucun NaN', () => {
    for (const name of ['position', 'aDepth', 'aFlow']) {
      const a = geom.getAttribute(name);
      for (let i = 0; i < a.array.length; i++) {
        expect(Number.isFinite(a.array[i] as number), `${name}[${i}]`).toBe(true);
      }
    }
  });
});
