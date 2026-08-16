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
import { ProceduralTerrain, type TerrainData } from './ProceduralTerrain';
import { ProceduralGrassField } from './ProceduralGrassField';
import { ProceduralVegetation } from './ProceduralVegetation';
import { ProceduralRiver } from './ProceduralRiver';
import { createAgentAvatar } from './AgentAvatarFactory';
import type { VILLAGE_LAYOUT } from './layout';

export interface PrehistoricSceneResult {
  root: Group;
  campfires: Map<string, Group>;
  agentAvatars: Map<string, Group>;
  entities: Entity[];
  grassField: ProceduralGrassField;
  river: ProceduralRiver;
  terrain: TerrainData;
}

export class PrehistoricEnvironment3D {
  public static createWorldScene(
    world: World,
    layout: typeof VILLAGE_LAYOUT
  ): PrehistoricSceneResult {
    const root = new Group();
    root.name = 'Procedural_Nature_World_3D';
    const campfires = new Map<string, Group>();
    const agentAvatars = new Map<string, Group>();
    const entities: Entity[] = [];

    // 1. Procedural Terrain Height & River Reference
    const terrain = ProceduralTerrain.createTerrain();
    const river = new ProceduralRiver();
    const riverMesh = river.createRiver();
    root.add(riverMesh);

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

    // 5. Procedural Forests: Cypress, Oak, Pine, Wildflowers, Boulders
    // 5a. Slender Italian Cypress Trees along ridges & trails (Reference Image 1)
    const cypressLocations: [number, number][] = [
      [8.5, -3.0], [9.2, -4.5], [8.0, -6.0], [9.8, -7.5], // River ridge grove
      [-7.5, -8.0], [-6.8, -9.5], [-8.2, -11.0],           // Vineyard edge
      [5.5, 3.5], [6.2, 5.0],                              // South meadow
    ];

    cypressLocations.forEach(([cx, cz], idx) => {
      const cy = terrain.getHeight(cx, cz);
      const cypress = ProceduralVegetation.createCypressTree(0.85 + Math.random() * 0.3);
      cypress.position.set(cx, cy, cz);
      root.add(cypress);

      const treeEntity = world.createEntity();
      treeEntity.addComponent(Transform, { position: [cx, cy, cz] });
      treeEntity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Cylinder,
        dimensions: [0.22, 4.2, 0],
        friction: 0.8,
        restitution: 0.1,
      });
      treeEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entities.push(treeEntity);
    });

    // 5b. Volumetric Broadleaf Oak Trees (Reference Images 1 & 5)
    const oakLocations: [number, number][] = [
      [-6.5, 2.0], [7.0, -1.0], [-10.5, 5.0], [11.0, 3.0],
      [-2.0, -13.0], [4.5, -14.0], [-8.0, -16.0], [10.0, -15.0],
    ];

    oakLocations.forEach(([ox, oz]) => {
      const oy = terrain.getHeight(ox, oz);
      const oak = ProceduralVegetation.createOakTree(0.9 + Math.random() * 0.25);
      oak.position.set(ox, oy, oz);
      root.add(oak);

      const oakEntity = world.createEntity();
      oakEntity.addComponent(Transform, { position: [ox, oy, oz] });
      oakEntity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Cylinder,
        dimensions: [0.35, 3.2, 0],
        friction: 0.8,
        restitution: 0.1,
      });
      oakEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entities.push(oakEntity);
    });

    // 5c. Wildflower Meadow Patches (Reference Image 5)
    const flowerLocations: [number, number][] = [
      [0.5, -1.5], [-2.5, -1.0], [3.0, -0.5], [-1.0, 2.5],
      [2.5, 2.0], [-4.0, 0.5], [5.0, 1.5], [-3.0, -7.0],
    ];

    flowerLocations.forEach(([fx, fz]) => {
      const fy = terrain.getHeight(fx, fz);
      const patch = ProceduralVegetation.createWildflowerPatch();
      patch.position.set(fx, fy, fz);
      root.add(patch);
    });

    // 5d. Mossy Field Boulders & Shoreline Stones (Reference Images 1, 3, 5)
    const boulderLocations: [number, number][] = [
      [-3.8, -2.5], [4.2, -4.8], [-1.5, -8.5], [6.5, -7.0],
      [-5.5, -11.0], [2.8, -10.5], [-9.0, 1.5], [8.0, 6.0],
    ];

    boulderLocations.forEach(([bx, bz]) => {
      const by = terrain.getHeight(bx, bz);
      const boulder = ProceduralVegetation.createMossyBoulder(0.8 + Math.random() * 0.4);
      boulder.position.set(bx, by, bz);
      root.add(boulder);

      const boulderEntity = world.createEntity();
      boulderEntity.addComponent(Transform, { position: [bx, by, bz] });
      boulderEntity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Box,
        dimensions: [0.8, 0.5, 0.8],
        friction: 0.7,
        restitution: 0.2,
      });
      boulderEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entities.push(boulderEntity);
    });

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
      const shelter = this.createShelter(settlement.color);
      shelter.position.set(0, 0, -1.3);
      tribeGroup.add(shelter);

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
      const rock = this.createFlintRock();
      rock.position.set(-1.4, 0, 0.8);
      tribeGroup.add(rock);

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

    return { root, campfires, agentAvatars, entities, grassField, river, terrain };
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

    for (let i = 0; i < 10; i++) {
      const b = new Mesh(new SphereGeometry(0.05, 6, 6), berryMat);
      b.position.set(
        (Math.random() - 0.5) * 0.65,
        0.32 + Math.random() * 0.38,
        (Math.random() - 0.5) * 0.65
      );
      bush.add(b);
    }

    return bush;
  }

  public static createFlintRock(): Group {
    const rockGroup = new Group();
    const rockMat = new MeshStandardMaterial({ color: 0x475569, roughness: 0.65, metalness: 0.25 });

    const mainRock = new Mesh(new BoxGeometry(0.6, 0.35, 0.45), rockMat);
    mainRock.rotation.y = 0.4;
    mainRock.position.set(0, 0.18, 0);
    rockGroup.add(mainRock);

    const smallRock = new Mesh(new SphereGeometry(0.14, 6, 6), rockMat);
    smallRock.position.set(0.32, 0.1, 0.12);
    rockGroup.add(smallRock);

    return rockGroup;
  }

  public static createShelter(bannerColor: number): Group {
    const shelter = new Group();
    const woodMat = new MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 });
    const hideMat = new MeshStandardMaterial({ color: bannerColor, roughness: 0.7 });

    const pole1 = new Mesh(new CylinderGeometry(0.055, 0.055, 1.8, 6), woodMat);
    pole1.position.set(-0.65, 0.85, 0);
    pole1.rotation.z = -0.38;
    shelter.add(pole1);

    const pole2 = new Mesh(new CylinderGeometry(0.055, 0.055, 1.8, 6), woodMat);
    pole2.position.set(0.65, 0.85, 0);
    pole2.rotation.z = 0.38;
    shelter.add(pole2);

    const roof = new Mesh(new BoxGeometry(1.5, 0.12, 1.3), hideMat);
    roof.position.set(0, 1.2, 0);
    roof.rotation.x = -0.2;
    shelter.add(roof);

    return shelter;
  }
}
