import { createSystem, Types, InstancedMesh, Object3D, type Entity } from '@iwsdk/core';
import { scatterAt, heightAt, SCATTER_TILE, type ScatterItem } from '@iwsdk/cardinal-simulation';
import { lodForRing } from '../terrain/tiling';
import { FloraTile } from './components';
import type { FloraAsset } from './floraAssets';

/**
 * Instancie la flore d'une tuile (spec §8).
 *
 * Une `InstancedMesh` par espèce et par tuile : le semis vient du MOTEUR, si
 * bien que la forêt vue et la forêt exploitable sont la même par construction.
 */
export class FloraSystem extends createSystem(
  { tiles: { required: [FloraTile] } },
  {
    assets: { type: Types.Object, default: null },
    barkMaterial: { type: Types.Object, default: null },
    leafMaterial: { type: Types.Object, default: null },
  },
) {
  public plantedTiles = 0;
  public instanceCount = 0;
  /** Derniers niveaux choisis, pour que les tests puissent les constater. */
  public lastLevelNear = 0;
  public lastLevelFar = 0;

  /** Alloué une fois : toute allocation par image est traitée comme un défaut. */
  private readonly dummy = new Object3D();

  /**
   * Les maillages plantés, par tuile.
   *
   * Sans ce registre, la flore SURVIT à sa tuile : le streaming libère
   * l'entité de tuile au changement de niveau de détail, mais les
   * `InstancedMesh` sont des entités séparées que rien ne rattache. Elles
   * s'accumulaient — 690 maillages devenus 960 sur une longue session, et
   * 361 000 triangles devenus 554 000, au-dessus du budget.
   */
  private readonly planted = new Map<string, Entity[]>();

  public override init(): void {
    this.queries.tiles.subscribe('disqualify', (entity) => {
      const key = `${entity.getValue(FloraTile, 'tx') ?? 0},${entity.getValue(FloraTile, 'tz') ?? 0}`;
      for (const mesh of this.planted.get(key) ?? []) mesh.dispose();
      this.planted.delete(key);
    });
  }

  public override update(_delta: number, _time: number): void {
    const assets = this.config.assets.value as FloraAsset[] | null;
    if (assets === null) return;

    const player = this.player as unknown as { position: { x: number; z: number } } | undefined;
    const centreX = Math.floor((player?.position.x ?? 0) / SCATTER_TILE);
    const centreZ = Math.floor((player?.position.z ?? 0) / SCATTER_TILE);

    for (const entity of this.queries.tiles.entities) {
      if (entity.getValue(FloraTile, '_needsPlant') !== true) continue;

      const tx = entity.getValue(FloraTile, 'tx')!;
      const tz = entity.getValue(FloraTile, 'tz')!;

      // Le niveau de détail suit l'anneau, comme le terrain. Ce n'est pas une
      // optimisation différable : au niveau le plus fin, le budget de 500 000
      // triangles n'autoriserait que quelques dizaines d'arbres en tout.
      const ring = Math.max(Math.abs(tx - centreX), Math.abs(tz - centreZ));
      const level = Math.min(Math.max(0, lodForRing(ring)), 2);

      const bySpecies = new Map<string, ScatterItem[]>();
      for (const item of scatterAt(tx, tz)) {
        const list = bySpecies.get(item.species);
        if (list === undefined) bySpecies.set(item.species, [item]);
        else list.push(item);
      }

      const key = `${tx},${tz}`;
      const created: Entity[] = [];

      for (const [species, group] of bySpecies) {
        const asset = assets.find((a) => a.id === species);
        if (asset === undefined || asset.lods.length === 0) continue;
        const lod = asset.lods[Math.min(level, asset.lods.length - 1)]!;

        // DEUX maillages par espèce : l'écorce et le feuillage ont chacun leur
        // matériau. Fusionnés, tout l'arbre prenait celui du feuillage — et
        // l'écorce représente 83 % de sa géométrie.
        const parts: [unknown, unknown][] = [
          [lod.bark, this.config.barkMaterial.value],
          [lod.leaves, this.config.leafMaterial.value],
        ];

        for (const [geometry, material] of parts) {
          if (geometry === null || geometry === undefined) continue;
          const mesh = new InstancedMesh(
            geometry as ConstructorParameters<typeof InstancedMesh>[0],
            material as ConstructorParameters<typeof InstancedMesh>[1],
            group.length,
          );
          mesh.name = `Flora ${species} ${tx},${tz}`;
          mesh.castShadow = false; // la flore reçoit l'ombre, elle n'en projette pas
          mesh.receiveShadow = true;

          for (let i = 0; i < group.length; i++) {
            const item = group[i]!;
            this.dummy.position.set(item.x, heightAt(item.x, item.z), item.z);
            this.dummy.rotation.set(0, item.rotationY, 0);
            this.dummy.scale.set(item.scale, item.scale, item.scale);
            this.dummy.updateMatrix();
            mesh.setMatrixAt(i, this.dummy.matrix);
          }
          mesh.instanceMatrix.needsUpdate = true;
          created.push(this.world.createTransformEntity(mesh, undefined));
        }
        this.instanceCount += group.length;
      }

      // La flore est enregistrée sous sa tuile : elle mourra avec elle.
      for (const mesh of this.planted.get(key) ?? []) mesh.dispose();
      this.planted.set(key, created);

      if (ring <= 1) this.lastLevelNear = level;
      else this.lastLevelFar = level;

      entity.setValue(FloraTile, '_needsPlant', false);
      this.plantedTiles++;
    }
  }
}
