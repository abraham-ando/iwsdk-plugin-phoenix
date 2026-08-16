import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from '@iwsdk/core';
import { getRiverCourse, riverSurfaceAt, heightAt } from '@iwsdk/cardinal-simulation';

/**
 * Le ruban d'eau (spec §7).
 *
 * LA PROFONDEUR EST CALCULÉE AU SOMMET, CÔTÉ CPU, avec la fonction du moteur,
 * puis stockée comme attribut. Le nuanceur l'interpole gratuitement. On
 * supprime ainsi le poste le plus coûteux d'une eau réaliste sur mobile — la
 * cible de rendu de profondeur — et l'on rend surtout la divergence
 * impossible : l'eau et le terrain lisent la même fonction.
 */

/** Colonnes de sommets en travers du lit. Impair, pour avoir un axe. */
export const RIVER_COLUMNS = 7;

/**
 * La nappe est posée un rien au-dessus de sa hauteur exacte, pour ne pas
 * lutter contre le lit dans le tampon de profondeur.
 */
export const WATER_EDGE_LIFT = 0.02;

/** Bornes de la recherche de rive, en multiples de la largeur du lit. */
const EDGE_SEARCH_MIN = 0.6;
const EDGE_SEARCH_MAX = 6;
const EDGE_SEARCH_STEPS = 12;

/**
 * Demi-largeur jusqu'à la RIVE, c'est-à-dire jusqu'au point où la nappe
 * rencontre le terrain.
 *
 * Une marge fixe laissait un demi-mètre d'eau au bord du ruban : l'écume et
 * l'estompage du bord, qui s'éteignent tous deux à profondeur nulle, ne se
 * déclenchaient jamais. La rive n'est pas une marge à deviner, c'est un lieu
 * à trouver — par dichotomie sur le terrain du moteur.
 */
function halfWidthToShore(
  x: number,
  z: number,
  perpX: number,
  perpZ: number,
  surface: number,
  width: number,
): number {
  let low = width * EDGE_SEARCH_MIN;
  let high = width * EDGE_SEARCH_MAX;
  // Si même la borne haute est encore sous l'eau, on s'arrête là : mieux vaut
  // un ruban trop court qu'un ruban qui s'étale sur toute la vallée.
  if (heightAt(x + perpX * high, z + perpZ * high) < surface) return high;
  for (let i = 0; i < EDGE_SEARCH_STEPS; i++) {
    const mid = (low + high) / 2;
    if (heightAt(x + perpX * mid, z + perpZ * mid) < surface) low = mid;
    else high = mid;
  }
  return high;
}

export function riverVertexCount(points: number, columns = RIVER_COLUMNS): number {
  return points * columns;
}

export function buildRiverGeometry(): BufferGeometry {
  const course = getRiverCourse();
  const rows = course.points.length;
  const cols = RIVER_COLUMNS;
  const count = riverVertexCount(rows, cols);

  const positions = new Float32Array(count * 3);
  const depths = new Float32Array(count);
  const flows = new Float32Array(count * 2);
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);

  for (let row = 0; row < rows; row++) {
    const p = course.points[row]!;
    // Tangente : la direction de l'écoulement, prise sur les points voisins.
    const previous = course.points[Math.max(0, row - 1)]!;
    const next = course.points[Math.min(rows - 1, row + 1)]!;
    let tx = next.x - previous.x;
    let tz = next.z - previous.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // Perpendiculaire : la direction en travers du lit.
    const px = -tz;
    const pz = tx;

    const surface = riverSurfaceAt(p.x, p.z) + WATER_EDGE_LIFT;
    // Chaque rive est cherchée SÉPARÉMENT : un lit n'est pas symétrique.
    const left = halfWidthToShore(p.x, p.z, -px, -pz, surface, p.width);
    const right = halfWidthToShore(p.x, p.z, px, pz, surface, p.width);

    for (let col = 0; col < cols; col++) {
      const t = (col / (cols - 1)) * 2 - 1; // -1 (berge) .. +1 (berge)
      const half = t < 0 ? left : right;
      const x = p.x + px * half * t;
      const z = p.z + pz * half * t;
      const v = row * cols + col;

      positions[v * 3] = x;
      positions[v * 3 + 1] = surface;
      positions[v * 3 + 2] = z;
      // La profondeur vient du MOTEUR, pas d'un profil inventé.
      depths[v] = Math.max(0, surface - WATER_EDGE_LIFT - heightAt(x, z));
      flows[v * 2] = tx;
      flows[v * 2 + 1] = tz;
    }
  }

  let i = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[i++] = a;
      indices[i++] = c;
      indices[i++] = b;
      indices[i++] = b;
      indices[i++] = c;
      indices[i++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new Float32BufferAttribute(depths, 1));
  geometry.setAttribute('aFlow', new Float32BufferAttribute(flows, 2));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
