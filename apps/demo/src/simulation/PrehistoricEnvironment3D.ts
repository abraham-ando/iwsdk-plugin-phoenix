/**
 * Magnificent Procedural 3D Environment with Three.js & IWSDK ECS.
 * Combines multi-octave terrain heightmaps, volumetric wind-animated grass,
 * Italian cypress & broadleaf oak trees, winding azure riverbeds,
 * cultivated vineyard terraces, wildflower patches, mossy boulders,
 * and full Havok physics collisions.
 */

import {
  World,
  Entity,
  Transform,
  Group,
  Mesh,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  Color,
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
} from '@iwsdk/core';
import { getTerrainHeight, isRiverAt } from '@iwsdk/cardinal-simulation';

/** Ce dont la scène a besoin du terrain : poser des objets, pas le mailler. */
export interface TerrainData {
  getHeight: (x: number, z: number) => number;
  isRiver: (x: number, z: number) => boolean;
  size: number;
}
import { ProceduralGrassField } from './ProceduralGrassField';
import { ProceduralVegetation } from './ProceduralVegetation';
import { createAgentAvatar } from './AgentAvatarFactory';
import type { MaterialLibrary } from '@iwsdk/cardinal-world';
import type { VILLAGE_LAYOUT } from './layout';

export interface PrehistoricSceneResult {
  root: Group;
  campfires: Map<string, Group>;
  shelters: Map<string, Group>;
  berryBushes: Map<string, Group>;
  flintDeposits: Map<string, Group>;
  campStorages: Map<string, Group>;
  agentAvatars: Map<string, Group>;
  entities: Entity[];
  grassField: ProceduralGrassField;
  terrain: TerrainData;
}

export class PrehistoricEnvironment3D {
  public static createWorldScene(
    world: World,
    layout: typeof VILLAGE_LAYOUT,
    materials?: MaterialLibrary
  ): PrehistoricSceneResult {
    const root = new Group();
    root.name = 'Procedural_Nature_World_3D';
    const campfires = new Map<string, Group>();
    const shelters = new Map<string, Group>();
    const berryBushes = new Map<string, Group>();
    const flintDeposits = new Map<string, Group>();
    const campStorages = new Map<string, Group>();
    const agentAvatars = new Map<string, Group>();
    const entities: Entity[] = [];

    // 1. Le terrain est désormais streamé en tuiles par @iwsdk/cardinal-world.
    // Cette scène n'a besoin que de POSER des objets dessus, donc de la
    // fonction de hauteur — pas d'un maillage. L'ancien appel construisait
    // 9409 sommets et 42 ms de classification de biomes pour un mesh qui
    // n'était JAMAIS ajouté à la scène.
    const terrain: TerrainData = {
      getHeight: getTerrainHeight,
      isRiver: isRiverAt,
      size: 64,
    };
    // La surface d'eau est désormais construite et animée par
    // @iwsdk/cardinal-world : elle porte sa profondeur par sommet, ses vagues
    // de Gerstner et son écume de rive, et suit le cours du moteur.

    // 2. Procedural Volumetric Wind-Swaying Grass Field (3200+ Blades)
    const grassField = new ProceduralGrassField(3200);
    const grassMesh = grassField.createGrass();
    root.add(grassMesh);

    // 4. Cultivated Vineyard Terraces (as seen in Reference Image 1)
    const vineyard = ProceduralVegetation.createVineyardTerrace();
    const vineY = terrain.getHeight(-12, -5);
    vineyard.position.set(-12, vineY, -5);
    vineyard.rotation.y = 0.35;
    root.add(vineyard);

    const vineEntity = world.createEntity();
    vineEntity.addComponent(Transform, { position: [-12, vineY, -5] });
    vineEntity.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Box,
      dimensions: [6.5, 0.6, 6.5],
      friction: 0.7,
      restitution: 0.1,
    });
    vineEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
    entities.push(vineEntity);

    // 5. La flore SAUVAGE est désormais semée par le moteur (scatterAt) et
    // instanciée par @iwsdk/cardinal-world. Le bosquet de cyprès posé à la main
    // qui vivait ici faisait double emploi.
    //
    // Les chênes du VILLAGE restent posés ici : ils portent des smart objects
    // exploitables, et scatterAt observe une réserve autour du plateau — sans
    // quoi les agents bûcheronneraient des arbres invisibles.

    // Plus de chênes posés à la main : l'écologie E1 les a retirés du
    // village au profit du semis, et FloraSystem instancie la forêt.
    // Le filtre qui vivait ici rendait une liste vide depuis lors.

    // 6. The 3 Tribal Settlements on the Natural Landscape (from the layout —
    // the same entries the simulation engine spawns its smart objects from).
    for (const settlement of layout.settlements) {
      const groundY = terrain.getHeight(settlement.x, settlement.z);
      const pos: [number, number, number] = [settlement.x, groundY, settlement.z];

      const tribeGroup = new Group();
      tribeGroup.position.set(...pos);

      // Campfire with static collider
      const campfire = this.createCampfire(settlement.tribe);
      tribeGroup.add(campfire);
      campfires.set(settlement.tribe, campfire);

      const fireEntity = world.createEntity();
      fireEntity.addComponent(Transform, { position: pos });
      fireEntity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Cylinder,
        dimensions: [0.45, 0.3, 0],
        friction: 0.8,
        restitution: 0.1,
      });
      fireEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entities.push(fireEntity);

      // Tribal Shelter with static collider
      const shelter = this.createShelter(settlement.color, materials);
      shelter.position.set(0, 0, -1.3);
      tribeGroup.add(shelter);
      shelters.set(settlement.tribe, shelter);

      const shelterEntity = world.createEntity();
      shelterEntity.addComponent(Transform, { position: [pos[0], pos[1], pos[2] - 1.3] });
      shelterEntity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Box,
        dimensions: [1.6, 1.4, 1.4],
        friction: 0.6,
        restitution: 0.1,
      });
      shelterEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entities.push(shelterEntity);

      // Tribal Runestone Monolith with glowing glyph
      const monolith = this.createTribalMonolith(settlement.tribe, settlement.color);
      monolith.position.set(-1.8, 0, -0.6);
      tribeGroup.add(monolith);

      const monoEntity = world.createEntity();
      monoEntity.addComponent(Transform, { position: [pos[0] - 1.8, pos[1], pos[2] - 0.6] });
      monoEntity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Box,
        dimensions: [0.5, 2.2, 0.5],
        friction: 0.7,
        restitution: 0.1,
      });
      monoEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entities.push(monoEntity);

      // Berry Bush with static collider
      const bush = this.createBerryBush();
      bush.position.set(1.5, 0, 0.6);
      tribeGroup.add(bush);
      berryBushes.set(settlement.tribe, bush);

      const bushEntity = world.createEntity();
      bushEntity.addComponent(Transform, { position: [pos[0] + 1.5, pos[1], pos[2] + 0.6] });
      bushEntity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Sphere,
        dimensions: [0.5, 0, 0],
        friction: 0.6,
        restitution: 0.0,
      });
      bushEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entities.push(bushEntity);

      // Flint Rock formation with static collider
      const rock = this.createFlintRock(materials);
      rock.position.set(-1.4, 0, 0.8);
      tribeGroup.add(rock);
      flintDeposits.set(settlement.tribe, rock);

      // Le cellier, calé à l'OUEST du foyer comme le scénario le place.
      const storage = this.createCampStorage(materials);
      storage.position.set(-0.9, 0, -0.7);
      tribeGroup.add(storage);
      campStorages.set(settlement.tribe, storage);

      const rockEntity = world.createEntity();
      rockEntity.addComponent(Transform, { position: [pos[0] - 1.4, pos[1], pos[2] + 0.8] });
      rockEntity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Box,
        dimensions: [0.7, 0.4, 0.6],
        friction: 0.7,
        restitution: 0.2,
      });
      rockEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entities.push(rockEntity);

      root.add(tribeGroup);
    }

    // 7. Villager avatars, free-roaming in world space: their transforms are
    // driven every frame by CardinalSimulationSystem from the engine's views.
    const colorByTribe = new Map(layout.settlements.map((s) => [s.tribe, s.color]));
    for (const agent of layout.agents) {
      const avatar = createAgentAvatar(
        agent.name,
        colorByTribe.get(agent.tribe) ?? 0x3b82f6,
        agent.gender
      );
      avatar.position.set(agent.x, terrain.getHeight(agent.x, agent.z), agent.z);
      root.add(avatar);
      agentAvatars.set(agent.id, avatar);
    }

    return {
      root,
      campfires,
      shelters,
      berryBushes,
      flintDeposits,
      campStorages,
      agentAvatars,
      entities,
      grassField,
      terrain,
    };
  }

  public static createCampfire(tribeName: string): Group {
    const fire = new Group();
    fire.name = `Campfire_${tribeName}`;

    // Stone ring
    const stoneMat = new MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      const stone = new Mesh(new SphereGeometry(0.09, 8, 8), stoneMat);
      stone.position.set(Math.cos(angle) * 0.4, 0.06, Math.sin(angle) * 0.4);
      fire.add(stone);
    }

    // Crossed Charcoal Logs
    const woodMat = new MeshStandardMaterial({ color: 0x3f1f06, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const log = new Mesh(new CylinderGeometry(0.045, 0.045, 0.55, 6), woodMat);
      log.rotation.z = Math.PI / 4;
      log.rotation.y = (i * Math.PI) / 4;
      log.position.set(0, 0.12, 0);
      fire.add(log);
    }

    // Fire Flame Core
    const flameMat = new MeshStandardMaterial({
      color: 0xf97316,
      emissive: new Color(0xff5500),
      roughness: 0.1,
    });
    const flame = new Mesh(new SphereGeometry(0.22, 12, 12), flameMat);
    flame.name = 'flame';
    flame.position.set(0, 0.26, 0);
    fire.add(flame);

    return fire;
  }

  public static setCampfireLit(fire: Group, isLit: boolean): void {
    const flame = fire.getObjectByName('flame');
    if (flame) {
      flame.visible = isLit;
    }
  }

  public static createTribalMonolith(tribeName: string, glowColor: number): Group {
    const mono = new Group();
    const stoneMat = new MeshStandardMaterial({ color: 0x334155, roughness: 0.85, metalness: 0.2 });
    const runeMat = new MeshStandardMaterial({
      color: glowColor,
      emissive: new Color(glowColor),
      roughness: 0.2,
    });

    const pillar = new Mesh(new BoxGeometry(0.45, 2.2, 0.4), stoneMat);
    pillar.position.set(0, 1.1, 0);
    pillar.rotation.y = 0.2;
    mono.add(pillar);

    const rune = new Mesh(new SphereGeometry(0.14, 8, 8), runeMat);
    rune.position.set(0, 1.5, 0.22);
    mono.add(rune);

    return mono;
  }

  public static createBerryBush(): Group {
    const bush = new Group();
    const leafMat = new MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 });
    const berryMat = new MeshStandardMaterial({
      color: 0xe11d48,
      emissive: new Color(0x9f1239),
      roughness: 0.3,
    });

    const core = new Mesh(new SphereGeometry(0.48, 12, 12), leafMat);
    core.position.set(0, 0.48, 0);
    bush.add(core);

    // Les baies vivent sous un enfant nommé `fill` : c'est la convention que
    // SmartObjectVisualSystem met à l'échelle, et qui masque à zéro. Sans ce
    // groupe, un buisson cueilli gardait toutes ses baies.
    const fill = new Group();
    fill.name = 'fill';
    for (let i = 0; i < 10; i++) {
      const b = new Mesh(new SphereGeometry(0.05, 6, 6), berryMat);
      b.position.set(
        (Math.random() - 0.5) * 0.65,
        0.32 + Math.random() * 0.38,
        (Math.random() - 0.5) * 0.65
      );
      fill.add(b);
    }
    bush.add(fill);

    return bush;
  }

  /**
   * Le tas de provisions du campement. Le moteur le connaît depuis toujours
   * (`camp_storage`, baies et bois mis de côté) ; rien ne le dessinait, si
   * bien qu'une journée de cueillette n'avait aucun retour visible.
   */
  public static createCampStorage(materials?: MaterialLibrary): Group {
    const storage = new Group();
    const woodMat = materials
      ? materials.get('bark')
      : new MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 });

    // Le panier reste ; ce qu'il contient monte et descend.
    const basket = new Mesh(new CylinderGeometry(0.34, 0.28, 0.26, 10), woodMat);
    basket.position.set(0, 0.13, 0);
    storage.add(basket);

    const fill = new Group();
    fill.name = 'fill';
    const heapMat = new MeshStandardMaterial({ color: 0xb45309, roughness: 0.75 });
    const heap = new Mesh(new SphereGeometry(0.26, 10, 8), heapMat);
    heap.position.set(0, 0.3, 0);
    heap.scale.set(1, 0.6, 1);
    fill.add(heap);
    storage.add(fill);

    return storage;
  }

  public static createFlintRock(materials?: MaterialLibrary): Group {
    const rockGroup = new Group();
    const rockMat = materials
      ? materials.get('flint')
      : new MeshStandardMaterial({ color: 0x475569, roughness: 0.65, metalness: 0.25 });

    const mainRock = new Mesh(new BoxGeometry(0.6, 0.35, 0.45), rockMat);
    mainRock.rotation.y = 0.4;
    mainRock.position.set(0, 0.18, 0);
    rockGroup.add(mainRock);

    // L'éclat détachable porte l'état : c'est lui qui s'amenuise à mesure
    // qu'on taille, le socle restant.
    const fill = new Group();
    fill.name = 'fill';
    const smallRock = new Mesh(new SphereGeometry(0.14, 6, 6), rockMat);
    smallRock.position.set(0.32, 0.1, 0.12);
    fill.add(smallRock);
    rockGroup.add(fill);

    return rockGroup;
  }

  public static createShelter(bannerColor: number, materials?: MaterialLibrary): Group {
    const shelter = new Group();
    const woodMat = materials
      ? materials.get('bark')
      : new MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 });
    // The hide keeps its tribal banner colour: it is how you tell the three
    // settlements apart at a glance. Texture comes from the library, tint
    // from the tribe.
    const hideMat = materials
      ? (() => {
          const tinted = materials.get('hide').clone();
          tinted.color = new Color(bannerColor);
          return tinted;
        })()
      : new MeshStandardMaterial({ color: bannerColor, roughness: 0.7 });

    // `from<N>` : la pièce apparaît à l'étape N de la construction et ne
    // disparaît plus. Aucune géométrie n'est ajoutée — les trois pièces
    // existaient déjà, il leur manquait un nom.
    const pole1 = new Mesh(new CylinderGeometry(0.055, 0.055, 1.8, 6), woodMat);
    pole1.name = 'from1';
    pole1.position.set(-0.65, 0.85, 0);
    pole1.rotation.z = -0.38;
    shelter.add(pole1);

    const pole2 = new Mesh(new CylinderGeometry(0.055, 0.055, 1.8, 6), woodMat);
    pole2.name = 'from2';
    pole2.position.set(0.65, 0.85, 0);
    pole2.rotation.z = 0.38;
    shelter.add(pole2);

    const roof = new Mesh(new BoxGeometry(1.5, 0.12, 1.3), hideMat);
    roof.name = 'from4';
    roof.position.set(0, 1.2, 0);
    roof.rotation.x = -0.2;
    shelter.add(roof);

    return shelter;
  }
}
