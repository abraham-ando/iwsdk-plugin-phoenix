import {
  createSystem,
  Types,
  Mesh,
  BufferGeometry,
  LocomotionEnvironment,
  type Entity,
} from '@iwsdk/core';
import { TerrainTile } from './components';
import {
  desiredTiles,
  diffTiles,
  tileIndexFor,
  tileKey,
  tileOriginX,
  tileOriginZ,
  type TileSpec,
} from './tiling';

/**
 * Maintient l'ensemble de tuiles voulu autour du joueur (spec §6).
 *
 * Ne travaille que lorsque le joueur CHANGE de tuile : recalculer l'ensemble
 * à chaque image gaspillerait le budget pour un résultat identique.
 */
export class TerrainStreamingSystem extends createSystem(
  { tiles: { required: [TerrainTile] } },
  { material: { type: Types.Object, default: null } },
) {
  public pendingCount = 0;
  public lastCentreKey = '';

  private readonly current = new Map<string, TileSpec>();

  public override init(): void {
    // On NE PASSE PAS par withLevelRoot : install.ts importe ce système, donc
    // lui emprunter un utilitaire créerait un cycle d'imports. Le signal se
    // lit directement, avec peek() comme l'exige la règle du dépôt.
    this.lastCentreKey = '';
  }

  private levelRootNow(): Entity | undefined {
    const signal = (this.world as unknown as { activeLevel?: { peek: () => Entity | null } })
      .activeLevel;
    return signal?.peek() ?? undefined;
  }

  public override update(_delta: number, _time: number): void {
    const player = this.player as unknown as { position: { x: number; z: number } } | undefined;
    if (player === undefined) return;

    const centre = tileKey(tileIndexFor(player.position.x), tileIndexFor(player.position.z));
    if (centre === this.lastCentreKey) return;
    this.lastCentreKey = centre;

    const desired = desiredTiles(player.position.x, player.position.z);
    const diff = diffTiles(this.current, desired);

    for (const key of diff.toRemove) {
      for (const entity of this.queries.tiles.entities) {
        const k = tileKey(entity.getValue(TerrainTile, 'tx')!, entity.getValue(TerrainTile, 'tz')!);
        if (k !== key) continue;
        // dispose(), jamais destroy() : destroy fuit la mémoire GPU.
        entity.dispose();
        break;
      }
      this.current.delete(key);
    }

    const levelRoot = this.levelRootNow();

    for (const spec of diff.toBuild) {
      // La tuile naît avec une géométrie VIDE : TerrainMeshSystem la remplira
      // quand le budget de l'image le permettra. Tout construire ici ferait
      // exploser la frame où le joueur franchit une frontière.
      const mesh = new Mesh(
        new BufferGeometry(),
        this.config.material.value as ConstructorParameters<typeof Mesh>[1],
      );
      mesh.name = `TerrainTile ${spec.tx},${spec.tz}`;
      mesh.position.set(tileOriginX(spec.tx), 0, tileOriginZ(spec.tz));
      mesh.castShadow = false; // le sol reçoit l'ombre, il n'en projette pas
      mesh.receiveShadow = true;

      const entity = this.world.createTransformEntity(mesh, levelRoot);
      entity.addComponent(TerrainTile, {
        tx: spec.tx,
        tz: spec.tz,
        lod: spec.lod,
        _needsBuild: true,
      });

      // SEULES les tuiles de niveau 0 sont marchables. Le locomoteur parcourt
      // tous les environnements enregistrés à chaque image, sans tri spatial :
      // en donner 49 lui imposerait 49 requêtes BVH par frame.
      if (spec.lod === 0) entity.addComponent(LocomotionEnvironment);

      this.current.set(tileKey(spec.tx, spec.tz), spec);
    }

    this.pendingCount = this.current.size;
  }
}
