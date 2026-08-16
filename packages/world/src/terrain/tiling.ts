/**
 * Pavage du terrain (spec §6). Pur : aucune dépendance à Three ni à l'ECS,
 * donc entièrement testable. C'est ici que vit TOUT le raisonnement du
 * streaming ; les systèmes ECS ne font qu'appliquer ces décisions.
 */

/** Côté d'une tuile, en mètres. */
export const TILE_SIZE = 32;

/**
 * Nombre de quads par côté, par niveau de détail.
 * Chaque niveau divise le précédent : les bords s'alignent alors sur un sommet
 * sur deux, ce qui rend les fissures régulières — et donc masquables par une
 * jupe de hauteur bornée.
 */
export const LOD_SEGMENTS: readonly number[] = [32, 16, 8];

/** Anneau le plus lointain encore streamé (distance de Chebyshev, en tuiles). */
export const MAX_RING = 3;

export interface TileSpec {
  readonly tx: number;
  readonly tz: number;
  readonly lod: number;
}

export interface TileDiff {
  readonly toBuild: TileSpec[];
  readonly toRemove: string[];
}

export function tileIndexFor(worldCoord: number): number {
  return Math.floor(worldCoord / TILE_SIZE);
}

export function tileOriginX(tx: number): number {
  return tx * TILE_SIZE;
}

export function tileOriginZ(tz: number): number {
  return tz * TILE_SIZE;
}

export function tileKey(tx: number, tz: number): string {
  return `${tx},${tz}`;
}

/** Les deux premiers anneaux restent en pleine résolution : c'est là qu'on marche. */
export function lodForRing(ring: number): number {
  if (ring < 0 || ring > MAX_RING) return -1;
  if (ring <= 1) return 0;
  return Math.min(ring - 1, LOD_SEGMENTS.length - 1);
}

export function desiredTiles(playerX: number, playerZ: number): TileSpec[] {
  const cx = tileIndexFor(playerX);
  const cz = tileIndexFor(playerZ);
  const tiles: TileSpec[] = [];
  for (let dz = -MAX_RING; dz <= MAX_RING; dz++) {
    for (let dx = -MAX_RING; dx <= MAX_RING; dx++) {
      // Chebyshev : des anneaux carrés, alignés sur la grille de tuiles.
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      const lod = lodForRing(ring);
      if (lod < 0) continue;
      tiles.push({ tx: cx + dx, tz: cz + dz, lod });
    }
  }
  return tiles;
}

/**
 * Différence entre ce qui existe et ce qu'il faut.
 *
 * Une tuile dont le niveau de détail change est retirée PUIS reconstruite :
 * la géométrie n'est pas redimensionnable en place, et tenter de la muter
 * laisserait des attributs de l'ancienne résolution.
 */
export function diffTiles(
  current: ReadonlyMap<string, TileSpec>,
  desired: readonly TileSpec[],
): TileDiff {
  const toBuild: TileSpec[] = [];
  const wanted = new Map<string, TileSpec>();

  for (const spec of desired) {
    const key = tileKey(spec.tx, spec.tz);
    wanted.set(key, spec);
    const existing = current.get(key);
    if (existing === undefined || existing.lod !== spec.lod) toBuild.push(spec);
  }

  const toRemove: string[] = [];
  for (const [key, spec] of current) {
    const replacement = wanted.get(key);
    // Plus voulue, ou voulue à une autre résolution : dans les deux cas elle
    // part — pour disparaître, ou pour renaître au bon niveau.
    if (replacement === undefined || replacement.lod !== spec.lod) toRemove.push(key);
  }

  return { toBuild, toRemove };
}
