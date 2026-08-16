import { createSystem } from '@iwsdk/core';
import { TerrainTile } from './components';
import { LOD_SEGMENTS, TILE_SIZE, tileOriginX, tileOriginZ } from './tiling';
import { sampleTile } from './sampling';
import { buildTileGeometry } from './geometry';

/**
 * Construit les tuiles marquées, AU PLUS UNE PAR IMAGE (spec §6).
 *
 * Le chiffre n'est pas arbitraire : une tuile 33×33 complète coûte 0,98 ms
 * mesurées, et une image VR entière en vaut 11 à 14. En construire deux
 * mangerait un cinquième du budget pour le seul terrain.
 */
export class TerrainMeshSystem extends createSystem({
  tiles: { required: [TerrainTile] },
}) {
  public readonly TILES_PER_FRAME = 1;
  public builtCount = 0;

  public override update(_delta: number, _time: number): void {
    let budget = this.TILES_PER_FRAME;
    for (const entity of this.queries.tiles.entities) {
      if (budget <= 0) return;
      if (entity.getValue(TerrainTile, '_needsBuild') !== true) continue;

      const tx = entity.getValue(TerrainTile, 'tx')!;
      const tz = entity.getValue(TerrainTile, 'tz')!;
      const lod = entity.getValue(TerrainTile, 'lod')!;
      const segments = LOD_SEGMENTS[Math.min(lod, LOD_SEGMENTS.length - 1)]!;

      const sample = sampleTile(tileOriginX(tx), tileOriginZ(tz), TILE_SIZE, segments);
      const geometry = buildTileGeometry(sample);

      const object = (entity as unknown as { object3D?: { geometry?: unknown } }).object3D;
      if (object !== undefined) {
        const previous = object.geometry as { dispose?: () => void } | undefined;
        // Libérer AVANT de remplacer : un remplacement muet fuit le tampon GPU.
        // C'est le pendant de la règle « dispose(), jamais destroy() ».
        previous?.dispose?.();
        object.geometry = geometry;
      }

      entity.setValue(TerrainTile, '_needsBuild', false);
      this.builtCount++;
      budget--;
    }
  }
}
