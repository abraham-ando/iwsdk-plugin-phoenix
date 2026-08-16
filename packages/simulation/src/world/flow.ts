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
const MAX_POINTS = 400;
const SOURCE_Z = 260;
const WIDTH_SOURCE = 2.6;
const WIDTH_MOUTH = 8;

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
 * Direction de plus forte descente, tempérée par l'inertie et l'exutoire.
 *
 * Le pur gradient s'enlise dans le moindre creux ; l'inertie donne au cours
 * l'élan qu'a une rivière réelle, et l'attrait de l'exutoire lui donne un cap
 * quand la plaine ne descend plus. `sign` vaut -1 pour remonter vers la source,
 * où l'exutoire ne doit évidemment pas peser.
 */
function bestDirection(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  sign: number,
  outlet: { x: number; z: number } | null,
): [number, number] {
  let bestX = dirX;
  let bestZ = dirZ;
  let bestScore = -Infinity;
  const here = dryReliefAt(x, z);
  let gx = 0;
  let gz = 0;
  if (outlet !== null) {
    const dx = outlet.x - x;
    const dz = outlet.z - z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) {
      gx = dx / len;
      gz = dz / len;
    }
  }
  for (let a = 0; a < 24; a++) {
    const angle = (a / 24) * Math.PI * 2;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    const inertia = cx * dirX + cz * dirZ;
    if (inertia < -0.2) continue; // un cours ne se retourne pas sur lui-même
    const raw = (here - dryReliefAt(x + cx * STEP, z + cz * STEP)) * sign;
    // Le dénivelé local est BORNÉ. Le bruit de détail crée des creux de 1 à 2 m
    // sur 6 m, qui écrasaient l'attrait de l'exutoire : le cours chassait les
    // bosses et tournait en rond. Une rivière de plaine suit la pente
    // RÉGIONALE, pas les accidents centimétriques.
    const drop = Math.max(-1.5, Math.min(1.5, raw));
    const goal = cx * gx + cz * gz;
    const score = drop * 0.8 + inertia * 0.5 + goal * (outlet === null ? 0 : 3);
    if (score <= bestScore) continue;
    bestScore = score;
    bestX = cx;
    bestZ = cz;
  }
  return [bestX, bestZ];
}

function buildCourse(): RiverCourse {
  // 1. Tronçon épinglé : le cours suit EXACTEMENT la formule historique dans
  //    la zone simulée, pour ne pas déplacer les points d'eau du village.
  const pinned: { x: number; z: number }[] = [];
  for (let z = PINNED_HALF_LENGTH; z >= -PINNED_HALF_LENGTH; z -= STEP) {
    pinned.push({ x: historicalRiverX(z), z });
  }

  // 2. Amont : on remonte vers la crête depuis le début de l'épinglage, puis
  //    on retourne la séquence pour que le cours parte bien de la source.
  const upstream: { x: number; z: number }[] = [];
  let ux = historicalRiverX(PINNED_HALF_LENGTH);
  let uz = PINNED_HALF_LENGTH;
  let udx = 0;
  let udz = 1;
  while (uz < SOURCE_Z && upstream.length < 140) {
    const [nx, nz] = bestDirection(ux, uz, udx, udz, -1, null);
    ux += nx * STEP;
    uz += nz * STEP;
    udx = nx;
    udz = nz;
    upstream.push({ x: ux, z: uz });
  }
  upstream.reverse();

  // 3. Aval : descente libre jusqu'à la mer.
  const downstream: { x: number; z: number }[] = [];
  let dx = historicalRiverX(-PINNED_HALF_LENGTH);
  let dz = -PINNED_HALF_LENGTH;
  let ddx = -1;
  let ddz = 0;
  const outlet = findSeaOutlet();
  while (downstream.length < MAX_POINTS) {
    const [nx, nz] = bestDirection(dx, dz, ddx, ddz, 1, outlet);
    dx += nx * STEP;
    dz += nz * STEP;
    ddx = nx;
    ddz = nz;
    downstream.push({ x: dx, z: dz });
    if (landMaskAt(dx, dz) < 0.35) break; // la mer est atteinte
  }

  const all = [...upstream, ...pinned, ...downstream];

  // 4. Altitude forcée décroissante, et largeur croissante vers l'aval.
  const points: CoursePoint[] = [];
  let ceiling = Infinity;
  let length = 0;
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    const t = i / Math.max(1, all.length - 1);
    // Le sol sec donne l'altitude visée ; le plafond garantit la descente.
    const elevation = Math.max(SEA_LEVEL - 2, Math.min(dryReliefAt(p.x, p.z), ceiling));
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

export function riverProximityAt(x: number, z: number): RiverProximity {
  const course = getRiverCourse();
  const candidates = getIndex().get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));

  // Hors de toute cellule indexée, il n'y a aucun point de cours à moins d'une
  // cellule : on parcourt alors la polyligne, ce qui n'arrive que loin de l'eau
  // et jamais dans le chemin chaud.
  let best = FAR;
  let bestDistance = Infinity;
  const count = candidates === undefined ? course.points.length : candidates.length;
  for (let k = 0; k < count; k++) {
    const i = candidates === undefined ? k : candidates[k]!;
    const p = course.points[i]!;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= bestDistance) continue;
    bestDistance = d;
    best = { distance: d, elevation: p.elevation, width: p.width };
  }
  return best;
}
