import { SEA_LEVEL, dryReliefAt, landMaskAt } from './relief';

/**
 * Le cours d'eau (spec §6 bis).
 *
 * Une rivière réelle CREUSE sa vallée : on trace donc un cours dont l'altitude
 * décroît strictement vers l'aval, et `terrain.ts` abaisse ensuite le sol
 * jusqu'à lui. Le cours ne connaît pas l'entaille — il se lit sur le relief
 * SEC, ce qui lève la circularité entre « où passe la rivière » et « où le
 * terrain a été creusé ».
 */

export interface CoursePoint {
  readonly x: number;
  readonly z: number;
  readonly elevation: number;
  readonly width: number;
}

export interface RiverCourse {
  readonly points: readonly CoursePoint[];
  readonly length: number;
}

export interface RiverProximity {
  readonly distance: number;
  readonly elevation: number;
  readonly width: number;
}

/** Demi-longueur du tronçon épinglé, en z. Couvre toute la zone simulée. */
export const PINNED_HALF_LENGTH = 60;

const STEP = 6;
const MAX_POINTS = 700;
const WIDTH_SOURCE = 2.6;
const WIDTH_MOUTH = 8;

/**
 * Revanche : de combien la surface libre se tient SOUS le sol environnant.
 *
 * Sans elle, l'altitude du cours égalait celle du sol au village — la nappe
 * affleurait le plateau et s'y répandait, noyant le village. Une rivière a
 * toujours ses berges au-dessus de son eau ; c'est ce qui fait un chenal.
 */
const FREEBOARD = 0.6;

function smoothstepLocal(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** La formule d'origine, à laquelle les points d'eau du village sont calés. */
export function historicalRiverX(z: number): number {
  return 4.0 + Math.sin(z * 0.12) * 3.5;
}

/**
 * L'exutoire : le point de mer le plus proche du village.
 *
 * Sans lui, le tracé s'enlise. Passé le bassin, le terrain devient une plaine
 * où PLUS AUCUNE direction ne descend : la plus forte pente n'a plus rien à
 * dire, l'inertie seule fait tourner le cours en boucle — observé sur 900
 * points à 0,54 m d'altitude. Une rivière réelle, elle, suit la pente
 * RÉGIONALE vers la mer et incise son lit. Ce point est cette connaissance.
 */
function findSeaOutlet(): { x: number; z: number } {
  let best = { x: -3000, z: 0 };
  let bestDistance = Infinity;
  for (let r = 200; r <= 3000; r += 20) {
    for (let a = 0; a < 72; a++) {
      const angle = (a / 72) * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (landMaskAt(x, z) >= 0.2) continue;
      if (r >= bestDistance) continue;
      bestDistance = r;
      best = { x, z };
    }
    if (bestDistance < Infinity) break;
  }
  return best;
}

/**
 * Décalage latéral qui minimise le sol dans un couloir autour du cap.
 *
 * On ne fait PAS d'accumulation d'écoulement : ce terrain n'a pas de réseau de
 * drainage, c'est du bruit fractal avec une cuvette au milieu. Toute marche
 * locale y finit dans un puits — mesuré : 650 pas d'oscillation dans un creux
 * à 0,56 m. Le remplissage de dépressions, la méthode correcte, est un
 * algorithme sur grille à l'échelle du kilomètre carré, hors de propos ici.
 *
 * Le modèle retenu est plus modeste et honnête : le cours va du village à la
 * mer et, chemin faisant, cherche le sol le plus bas dans un couloir autour de
 * son cap. La terminaison est garantie par construction, et la vallée — dont
 * la largeur suit la profondeur — garde des berges douces là où il faut
 * malgré tout entailler.
 */
const CORRIDOR = 420;
const CORRIDOR_SAMPLES = 43;
// Le décalage ne bouge que de tant par pas. Au-delà, deux points du cours
// s'espacent trop : `riverProximityAt` mesure la distance aux POINTS et non
// aux segments, et un écart de 20 m fausse la proximité de 10 m en son milieu.
const OFFSET_SLEW = 5;

function lowestOffset(
  baseX: number,
  baseZ: number,
  perpX: number,
  perpZ: number,
  previous: number,
): number {
  let best = previous;
  let bestRelief = Infinity;
  for (let k = 0; k < CORRIDOR_SAMPLES; k++) {
    const offset = -CORRIDOR + (2 * CORRIDOR * k) / (CORRIDOR_SAMPLES - 1);
    if (Math.abs(offset - previous) > OFFSET_SLEW) continue;
    const relief = dryReliefAt(baseX + perpX * offset, baseZ + perpZ * offset);
    if (relief >= bestRelief) continue;
    bestRelief = relief;
    best = offset;
  }
  return best;
}

function buildCourse(): RiverCourse {
  // 1. Tronçon épinglé : le cours suit EXACTEMENT la formule historique dans
  //    la zone simulée, pour ne pas déplacer les points d'eau du village.
  // La SOURCE est au village. Le terrain en amont lui est plus bas : une
  // rivière qui viendrait de là devrait grimper. Un village fondé sur sa
  // source est d'ailleurs le cas le plus courant qui soit.
  const pinned: { x: number; z: number }[] = [];
  for (let z = 0; z >= -PINNED_HALF_LENGTH; z -= STEP) {
    pinned.push({ x: historicalRiverX(z), z });
  }

  // 3. Aval : cheminement guidé du village vers l'exutoire.
  const outlet = findSeaOutlet();
  const startX = historicalRiverX(-PINNED_HALF_LENGTH);
  const startZ = -PINNED_HALF_LENGTH;
  const spanX = outlet.x - startX;
  const spanZ = outlet.z - startZ;
  const span = Math.hypot(spanX, spanZ);
  const dirX = spanX / span;
  const dirZ = spanZ / span;
  // Perpendiculaire au cap : c'est dans cette direction que l'on cherche le bas.
  const perpX = -dirZ;
  const perpZ = dirX;

  const downstream: { x: number; z: number }[] = [];
  const steps = Math.min(MAX_POINTS, Math.ceil(span / STEP));
  let offset = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const baseX = startX + spanX * t;
    const baseZ = startZ + spanZ * t;
    offset = lowestOffset(baseX, baseZ, perpX, perpZ, offset);
    // Le décalage se referme à l'approche de l'embouchure : la rivière doit
    // finir DANS la mer, pas à côté.
    const taper = 1 - smoothstepLocal(0.75, 1, t);
    downstream.push({ x: baseX + perpX * offset * taper, z: baseZ + perpZ * offset * taper });
  }

  const all = [...pinned, ...downstream];

  // 4. Altitude forcée décroissante, et largeur croissante vers l'aval.
  const points: CoursePoint[] = [];
  let ceiling = Infinity;
  let length = 0;
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    const t = i / Math.max(1, all.length - 1);
    // Le sol sec donne l'altitude visée ; le plafond garantit la descente.
    const elevation = Math.max(SEA_LEVEL - 2, Math.min(dryReliefAt(p.x, p.z) - FREEBOARD, ceiling));
    ceiling = elevation;
    if (i > 0) {
      const q = all[i - 1]!;
      length += Math.hypot(p.x - q.x, p.z - q.z);
    }
    points.push({
      x: p.x,
      z: p.z,
      elevation,
      width: WIDTH_SOURCE + (WIDTH_MOUTH - WIDTH_SOURCE) * t,
    });
  }
  return { points, length };
}

let cached: RiverCourse | null = null;

export function getRiverCourse(): RiverCourse {
  if (cached === null) cached = buildCourse();
  return cached;
}

// --- Index spatial ---------------------------------------------------------
// `isRiverAt` est appelé par agent et par tick, et `heightAt` par sommet de
// tuile : parcourir la polyligne à chaque requête serait ruineux.

const CELL = 32;

let index: Map<string, number[]> | null = null;

function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function getIndex(): Map<string, number[]> {
  if (index !== null) return index;
  const built = new Map<string, number[]>();
  const course = getRiverCourse();
  for (let i = 0; i < course.points.length; i++) {
    const p = course.points[i]!;
    const cx = Math.floor(p.x / CELL);
    const cz = Math.floor(p.z / CELL);
    // Un point est inscrit dans sa cellule ET ses voisines : une requête n'a
    // alors qu'une seule cellule à consulter, et jamais neuf.
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const key = cellKey(cx + ox, cz + oz);
        const list = built.get(key);
        if (list === undefined) built.set(key, [i]);
        else list.push(i);
      }
    }
  }
  index = built;
  return built;
}

const FAR: RiverProximity = { distance: Infinity, elevation: SEA_LEVEL, width: 0 };

/**
 * Proximité au cours. EXACTE à moins d'une cellule ({@link CELL} mètres) du
 * cours, et `Infinity` au-delà.
 *
 * Ce contrat n'est pas un raccourci : c'est ce qui rend la fonction utilisable.
 * Replier sur un parcours de la polyligne hors index coûtait 306 comparaisons
 * — pour la grande majorité des points du terrain, qui sont loin de l'eau. Le
 * chemin réputé rare était le plus fréquent, et `heightAt` passait de 0,60 à
 * 2,51 µs. L'entaille ne porte qu'à 17,6 m au plus : au-delà d'une cellule,
 * la distance exacte n'intéresse personne.
 */
export function riverProximityAt(x: number, z: number): RiverProximity {
  const candidates = getIndex().get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (candidates === undefined) return FAR;

  const course = getRiverCourse();
  let best = FAR;
  let bestDistance = Infinity;
  for (let k = 0; k < candidates.length; k++) {
    const i = candidates[k]!;
    const p = course.points[i]!;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= bestDistance) continue;
    bestDistance = d;
    best = { distance: d, elevation: p.elevation, width: p.width };
  }
  return best;
}
