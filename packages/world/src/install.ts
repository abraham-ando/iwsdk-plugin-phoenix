import { DomeGradient, IBLGradient, type Entity, type World } from '@iwsdk/core';
import { detectQuality, type QualityTier } from './core/quality';
import { CelestialTime, SkyModel, StarField } from './atmosphere/components';
import { CelestialTimeSystem } from './atmosphere/CelestialTimeSystem';
import { SkyRenderSystem } from './atmosphere/SkyRenderSystem';
import { StarFieldSystem } from './atmosphere/StarFieldSystem';
import { MaterialLibrary } from './materials/MaterialLibrary';
import { ProceduralMaterial } from './materials/components';
import { MaterialSystem } from './materials/MaterialSystem';
import { ExposureSystem } from './atmosphere/ExposureSystem';
import { applyColorManagement } from './core/colorManagement';
import { TerrainTile } from './terrain/components';
import { TerrainStreamingSystem } from './terrain/TerrainStreamingSystem';
import { TerrainMeshSystem } from './terrain/TerrainMeshSystem';

export interface CardinalWorldOptions {
  quality?: QualityTier;
  latitudeDeg?: number;
  dayOfYear?: number;
  turbidity?: number;
}

/**
 * DomeGradient and IBLGradient only work on the level root — anywhere else
 * they are silently ignored. The active level may not be loaded yet at
 * install time, so run the callback now if it is, or once it arrives.
 */
export function withLevelRoot(world: World, callback: (root: Entity) => void): void {
  const current = world.activeLevel.peek();
  if (current) {
    callback(current);
    return;
  }
  const unsubscribe = world.activeLevel.subscribe((root: Entity | null) => {
    if (root) {
      callback(root);
      unsubscribe();
    }
  });
}

/**
 * Installs the environment package into a world: components, systems, and
 * the sky rig on the level root. Mirrors installCardinalAI's shape.
 */
export function installCardinalWorld(
  world: World,
  options: CardinalWorldOptions = {},
): {
  quality: QualityTier;
  materials: MaterialLibrary;
  colorManaged: boolean;
  terrain: { streaming: TerrainStreamingSystem; mesh: TerrainMeshSystem };
} {
  const quality = options.quality ?? detectQuality();
  const materials = new MaterialLibrary(quality);

  world
    .registerComponent(CelestialTime)
    .registerComponent(SkyModel)
    .registerComponent(StarField)
    .registerComponent(ProceduralMaterial)
    .registerComponent(TerrainTile);

  world.registerSystem(CelestialTimeSystem);
  world.registerSystem(SkyRenderSystem, { configData: { quality } });
  world.registerSystem(StarFieldSystem);
  world.registerSystem(ExposureSystem);
  world.registerSystem(MaterialSystem, { configData: { library: materials } });

  // Le matériau du terrain est un CLONE de `grass` : les tuiles ont besoin de
  // vertexColors, ce que les autres usagers de `grass` ne veulent pas. Le
  // clone partage les mêmes textures — seul l'objet matériau est neuf.
  const terrainMaterial = materials.get('grass').clone();
  terrainMaterial.vertexColors = true;
  world.registerSystem(TerrainStreamingSystem, { configData: { material: terrainMaterial } });
  world.registerSystem(TerrainMeshSystem);

  const colorManaged = applyColorManagement((world as unknown as { renderer?: unknown }).renderer);

  withLevelRoot(world, (root) => {
    if (!root.hasComponent(CelestialTime)) {
      root.addComponent(CelestialTime, {
        hour: 12,
        latitudeDeg: options.latitudeDeg ?? 45,
        dayOfYear: options.dayOfYear ?? 172,
        weather: 0,
      });
    }
    if (!root.hasComponent(SkyModel)) {
      root.addComponent(SkyModel, { turbidity: options.turbidity ?? 2.5 });
    }
    if (!root.hasComponent(StarField)) {
      root.addComponent(StarField, {});
    }
    if (!root.hasComponent(DomeGradient)) root.addComponent(DomeGradient, {});
    if (!root.hasComponent(IBLGradient)) root.addComponent(IBLGradient, {});
  });

  return {
    quality,
    materials,
    colorManaged,
    terrain: {
      streaming: world.getSystem(TerrainStreamingSystem) as TerrainStreamingSystem,
      mesh: world.getSystem(TerrainMeshSystem) as TerrainMeshSystem,
    },
  };
}
