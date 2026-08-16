import { createSystem, LocomotionEnvironment, type Entity } from '@iwsdk/core';
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
    const player = this.player as unknown as { position: { x: number; z: number } } | undefined;
    const px = player?.position.x ?? 0;
    const pz = player?.position.z ?? 0;

    for (let built = 0; built < this.TILES_PER_FRAME; built++) {
      // LA TUILE LA PLUS PROCHE D'ABORD, jamais l'ordre de la requête.
      //
      // Celui-ci commence au coin de la zone streamée : la tuile sous les pieds
      // du joueur serait la 25ᵉ construite. Pendant ces 25 images il n'a aucun
      // sol, la gravité l'emporte, il passe SOUS le terrain — et le rayon de
      // détection du sol, dirigé vers le bas, ne le rattrape plus jamais.
      // Observé en session réelle : une chute de 5191 m.
      let entity: Entity | undefined;
      let bestDistance = Infinity;
      for (const candidate of this.queries.tiles.entities) {
        if (candidate.getValue(TerrainTile, '_needsBuild') !== true) continue;
        const cx = tileOriginX(candidate.getValue(TerrainTile, 'tx')!) + TILE_SIZE / 2;
        const cz = tileOriginZ(candidate.getValue(TerrainTile, 'tz')!) + TILE_SIZE / 2;
        const distance = (cx - px) * (cx - px) + (cz - pz) * (cz - pz);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        entity = candidate;
      }
      if (entity === undefined) return;

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

      // SEULES les tuiles de niveau 0 sont marchables : le locomoteur parcourt
      // tous les environnements enregistrés à chaque image, sans tri spatial,
      // donc en donner 49 lui imposerait 49 requêtes BVH par frame.
      // Et le composant n'arrive qu'ICI, la géométrie étant désormais remplie :
      // le poser plus tôt faisait échouer la fusion sur un maillage vide.
      if (lod === 0 && !entity.hasComponent(LocomotionEnvironment)) {
        entity.addComponent(LocomotionEnvironment);
      }

      entity.setValue(TerrainTile, '_needsBuild', false);
      this.builtCount++;
    }
  }
}
