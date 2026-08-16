import { describe, it, expect } from 'vitest';
import { World, LocomotionEnvironment } from '@iwsdk/core';
import { TerrainTile } from '../src/terrain/components';
import { TerrainStreamingSystem } from '../src/terrain/TerrainStreamingSystem';
import { TerrainMeshSystem } from '../src/terrain/TerrainMeshSystem';
import { TILE_SIZE, MAX_RING } from '../src/terrain/tiling';

function makeRig() {
  const world = new World();
  world.registerComponent(TerrainTile).registerComponent(LocomotionEnvironment);

  // Le mock d'elics ne connaît pas createTransformEntity : on l'ajoute ici
  // plutôt que dans le mock, pour que le mock reste une image honnête de
  // @iwsdk/core et non un fourre-tout.
  (world as unknown as { createTransformEntity: unknown }).createTransformEntity = (
    object: unknown,
  ) => {
    const entity = world.createEntity();
    (entity as unknown as { object3D: unknown }).object3D = object;
    // IWSDK ajoute dispose() par-dessus destroy() d'elics, et le dépôt impose
    // dispose() parce que destroy() fuit la mémoire GPU. Le mock doit donc
    // exposer le contrat qu'IWSDK expose, pas celui d'elics brut.
    const raw = entity as unknown as { dispose?: () => void; destroy: () => void };
    raw.dispose = () => raw.destroy();
    return entity;
  };
  (world as unknown as { activeLevel: unknown }).activeLevel = { peek: () => null };

  world.registerSystem(TerrainStreamingSystem);
  world.registerSystem(TerrainMeshSystem);
  const streaming = world.getSystem(TerrainStreamingSystem) as TerrainStreamingSystem;
  const mesh = world.getSystem(TerrainMeshSystem) as TerrainMeshSystem;

  // Le joueur : un simple porteur de position, comme XROrigin qui étend Group.
  const player = { position: { x: 0, y: 0, z: 0 } };
  (streaming as unknown as { player: unknown }).player = player;
  return { world, streaming, mesh, player };
}

describe('TerrainStreamingSystem', () => {
  it('crée une entité par tuile voulue', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    const side = 2 * MAX_RING + 1;
    expect(rig.streaming.pendingCount).toBe(side * side);
  });

  it('NE FAIT RIEN tant que le joueur reste dans sa tuile', () => {
    // Sinon le monde se reconstruirait à chaque pas.
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    const after = rig.streaming.pendingCount;
    const key = rig.streaming.lastCentreKey;
    rig.player.position.x = TILE_SIZE - 1;
    rig.streaming.update(0.016, 0.016);
    expect(rig.streaming.pendingCount).toBe(after);
    expect(rig.streaming.lastCentreKey).toBe(key);
  });

  it('réagit quand le joueur franchit une frontière de tuile', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    const before = rig.streaming.lastCentreKey;
    rig.player.position.x = TILE_SIZE * 2 + 1;
    rig.streaming.update(0.016, 0.016);
    expect(rig.streaming.lastCentreKey).not.toBe(before);
    // L'ensemble garde sa taille : on a glissé, pas grossi.
    const side = 2 * MAX_RING + 1;
    expect(rig.streaming.pendingCount).toBe(side * side);
  });

  it('ne rend MARCHABLE que le proche anneau', () => {
    // Le locomoteur parcourt tous les environnements enregistrés à chaque
    // image, sans tri spatial : en donner 49 lui imposerait 49 requêtes BVH
    // par frame.
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    let walkable = 0;
    let total = 0;
    for (const entity of rig.mesh.queries.tiles.entities) {
      total++;
      if (entity.hasComponent(LocomotionEnvironment)) {
        walkable++;
        expect(entity.getValue(TerrainTile, 'lod')).toBe(0);
      }
    }
    expect(total).toBe((2 * MAX_RING + 1) ** 2);
    expect(walkable).toBe(9); // les anneaux 0 et 1
  });
});

describe('TerrainMeshSystem', () => {
  it("ne construit qu'un nombre borné de tuiles par image", () => {
    // Le budget VR est de 11 à 14 ms au total ; une tuile 33x33 coûte 0,98 ms.
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    rig.mesh.update(0.016, 0);
    expect(rig.mesh.builtCount).toBeLessThanOrEqual(rig.mesh.TILES_PER_FRAME);
    expect(rig.mesh.builtCount).toBeGreaterThan(0);
  });

  it('finit par tout construire, image après image', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    const side = 2 * MAX_RING + 1;
    for (let frame = 0; frame < side * side + 5; frame++) rig.mesh.update(0.016, frame * 0.016);
    expect(rig.mesh.builtCount).toBe(side * side);
  });

  it('marque comme construite chaque tuile traitée', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    for (let frame = 0; frame < 60; frame++) rig.mesh.update(0.016, frame * 0.016);
    for (const entity of rig.mesh.queries.tiles.entities) {
      expect(entity.getValue(TerrainTile, '_needsBuild')).toBe(false);
    }
  });

  it('donne à chaque tuile une géométrie non vide', () => {
    const rig = makeRig();
    rig.streaming.update(0.016, 0);
    for (let frame = 0; frame < 60; frame++) rig.mesh.update(0.016, frame * 0.016);
    for (const entity of rig.mesh.queries.tiles.entities) {
      const object = (entity as unknown as { object3D: { geometry: unknown } }).object3D;
      const geom = object.geometry as { getAttribute: (n: string) => { count: number } };
      expect(geom.getAttribute('position').count).toBeGreaterThan(0);
    }
  });
});
