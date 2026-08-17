import { DomeGradient, IBLGradient, Mesh, type Entity, type World } from '@iwsdk/core';
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
import { GroundGuardSystem } from './terrain/GroundGuardSystem';
import { TerrainMeshSystem } from './terrain/TerrainMeshSystem';
import { WaterSurface } from './water/components';
import { WaterSystem } from './water/WaterSystem';
import { buildRiverGeometry } from './water/riverGeometry';
import { createWaterMaterial } from './water/WaterMaterial';
import { FloraTile } from './flora/components';
import { FloraSystem } from './flora/FloraSystem';
import { loadFloraAssets } from './flora/floraAssets';
import { SmartObjectVisual, AnimalVisual } from './objects/components';
import { SmartObjectVisualSystem } from './objects/SmartObjectVisualSystem';
import { FaunaSystem } from './objects/FaunaSystem';

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
  water: WaterSystem;
  flora: FloraSystem;
  objects: SmartObjectVisualSystem;
  fauna: FaunaSystem;
} {
  const quality = options.quality ?? detectQuality();
  const materials = new MaterialLibrary(quality);

  world
    .registerComponent(CelestialTime)
    .registerComponent(SkyModel)
    .registerComponent(StarField)
    .registerComponent(ProceduralMaterial)
    .registerComponent(TerrainTile)
    .registerComponent(WaterSurface)
    .registerComponent(FloraTile)
    .registerComponent(SmartObjectVisual)
    .registerComponent(AnimalVisual);

  // Priorités explicites, bande 10-50, en amont des personnages (60) :
  // atmosphère, puis matériaux, puis terrain, puis eau, puis flore, puis
  // projection des objets et de la faune.
  world.registerSystem(CelestialTimeSystem, { priority: 10 });
  world.registerSystem(SkyRenderSystem, { priority: 12, configData: { quality } });
  world.registerSystem(StarFieldSystem, { priority: 14 });
  world.registerSystem(ExposureSystem, { priority: 16 });
  world.registerSystem(MaterialSystem, { priority: 20, configData: { library: materials } });

  // Le matériau du terrain est un CLONE de `grass` : les tuiles ont besoin de
  // vertexColors, ce que les autres usagers de `grass` ne veulent pas. Le
  // clone partage les mêmes textures — seul l'objet matériau est neuf.
  const terrainMaterial = materials.get('grass').clone();
  terrainMaterial.vertexColors = true;
  world.registerSystem(TerrainStreamingSystem, {
    priority: 30,
    configData: { material: terrainMaterial },
  });
  world.registerSystem(TerrainMeshSystem, { priority: 32 });
  // Juste après la construction des tuiles : si l'une manque encore sous les
  // pieds du joueur, le sol analytique le rattrape avant qu'il ne tombe.
  world.registerSystem(GroundGuardSystem, { priority: 33 });
  world.registerSystem(WaterSystem, { priority: 34 });

  // La flore partage le matériau de feuillage : une seule instance pour tout
  // le monde, comme la bibliothèque le prévoit.
  world.registerSystem(FloraSystem, {
    priority: 36,
    configData: {
      assets: null,
      barkMaterial: materials.get('bark'),
      leafMaterial: materials.get('foliage'),
    },
  });
  world.registerSystem(SmartObjectVisualSystem, { priority: 40 });
  world.registerSystem(FaunaSystem, { priority: 42 });

  // Les géométries arrivent du réseau. Le système reste inerte jusque-là, ce
  // qui est correct : une tuile non plantée le sera au passage suivant.
  void loadFloraAssets()
    .then((assets) => {
      const flora = world.getSystem(FloraSystem) as FloraSystem;
      flora.config.assets.value = assets;
    })
    .catch((error: unknown) => {
      // Un échec de chargement laisse le monde sans arbres : il doit se voir.
      console.warn('[cardinal-world] flore indisponible :', error);
    });

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

    // La nappe est construite UNE fois : seule une uniforme de temps bouge
    // ensuite. Elle ne projette ni ne reçoit d'ombre — une ombre portée sur
    // de l'eau transparente coûte cher et ne se voit pas.
    const water = new Mesh(buildRiverGeometry(), createWaterMaterial());
    water.name = 'RiverSurface';
    water.castShadow = false;
    water.receiveShadow = false;
    const surface = world.createTransformEntity(water, root);
    surface.addComponent(WaterSurface, {});
  });

  return {
    quality,
    materials,
    colorManaged,
    terrain: {
      streaming: world.getSystem(TerrainStreamingSystem) as TerrainStreamingSystem,
      mesh: world.getSystem(TerrainMeshSystem) as TerrainMeshSystem,
    },
    water: world.getSystem(WaterSystem) as WaterSystem,
    flora: world.getSystem(FloraSystem) as FloraSystem,
    objects: world.getSystem(SmartObjectVisualSystem) as SmartObjectVisualSystem,
    fauna: world.getSystem(FaunaSystem) as FaunaSystem,
  };
}
