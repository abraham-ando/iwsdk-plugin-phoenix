/**
 * Physics Simulation System — Havok-powered 3D rigid bodies & collisions.
 * Manages static colliders (ground, obstacles), kinematic NPC capsules,
 * and dynamic grabbable/throwable physical items (flint stones, potions, logs).
 */

import {
  createSystem,
  Entity,
  Transform,
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  PhysicsManipulation,
  Mesh,
  SphereGeometry,
  BoxGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  Color,
  RayInteractable,
  OneHandGrabbable,
  DistanceGrabbable,
  LocomotionEnvironment,
} from '@iwsdk/core';

export class PhysicsSimulationSystem extends createSystem({}) {
  private groundEntity: Entity | null = null;
  private dynamicItems: Entity[] = [];

  init(): void {
    // 1. Static Ground Havok Physics Collider (so physical items rest on the earth)
    this.groundEntity = this.world.createEntity();
    this.groundEntity.addComponent(Transform, { position: [0, -0.2, 0] });
    this.groundEntity.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Box,
      dimensions: [64, 0.4, 64],
      friction: 0.8,
      restitution: 0.1,
    });
    this.groundEntity.addComponent(PhysicsBody, {
      state: PhysicsState.Static,
    });
    const groundMesh = new Mesh(
      new BoxGeometry(64, 0.4, 64),
      new MeshStandardMaterial({ visible: false })
    );
    this.groundEntity.object3D?.add(groundMesh);

    // 2. Spawn Interactive Physical Props (Flint stones, Potions, Logs)
    this.spawnPhysicalFlintStone([0.5, 1.2, -2.5]);
    this.spawnPhysicalFlintStone([-0.5, 1.2, -2.5]);
    this.spawnPhysicalHealingPotion([0.8, 1.2, -2.0]);
    this.spawnPhysicalWoodLog([0, 1.2, -2.2]);
  }

  /**
   * Spawns a dynamic grabbable flint stone with physical mass and restitution.
   */
  public spawnPhysicalFlintStone(pos: [number, number, number]): Entity {
    const stone = this.world.createEntity();
    stone.addComponent(Transform, { position: pos });

    const stoneMesh = new Mesh(
      new SphereGeometry(0.12, 10, 10),
      new MeshStandardMaterial({ color: 0x64748b, roughness: 0.7, metalness: 0.2 })
    );
    stone.object3D?.add(stoneMesh);

    stone.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Sphere,
      dimensions: [0.12, 0, 0],
      density: 2.5,
      friction: 0.7,
      restitution: 0.3,
    });
    stone.addComponent(PhysicsBody, {
      state: PhysicsState.Dynamic,
      linearDamping: 0.05,
      angularDamping: 0.05,
      gravityFactor: 1.0,
    });
    stone.addComponent(RayInteractable, {});
    stone.addComponent(DistanceGrabbable, { movementMode: 'MoveFromTarget' });

    this.dynamicItems.push(stone);
    return stone;
  }

  /**
   * Spawns a dynamic healing potion elixir bottle.
   */
  public spawnPhysicalHealingPotion(pos: [number, number, number]): Entity {
    const potion = this.world.createEntity();
    potion.addComponent(Transform, { position: pos });

    const bottleMesh = new Mesh(
      new CylinderGeometry(0.06, 0.08, 0.22, 12),
      new MeshStandardMaterial({
        color: 0xef4444,
        emissive: new Color(0x7f1d1d),
        roughness: 0.2,
        metalness: 0.3,
      })
    );
    potion.object3D?.add(bottleMesh);

    potion.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Cylinder,
      dimensions: [0.08, 0.22, 0],
      density: 1.2,
      friction: 0.5,
      restitution: 0.2,
    });
    potion.addComponent(PhysicsBody, {
      state: PhysicsState.Dynamic,
      linearDamping: 0.05,
      angularDamping: 0.05,
      gravityFactor: 1.0,
    });
    potion.addComponent(RayInteractable, {});
    potion.addComponent(DistanceGrabbable, { movementMode: 'MoveFromTarget' });

    this.dynamicItems.push(potion);
    return potion;
  }

  /**
   * Spawns a physical wood log for campfire fuel.
   */
  public spawnPhysicalWoodLog(pos: [number, number, number]): Entity {
    const logEntity = this.world.createEntity();
    logEntity.addComponent(Transform, { position: pos });

    const logMesh = new Mesh(
      new CylinderGeometry(0.06, 0.06, 0.45, 8),
      new MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 })
    );
    logEntity.object3D?.add(logMesh);

    logEntity.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Cylinder,
      dimensions: [0.06, 0.45, 0],
      density: 1.5,
      friction: 0.8,
      restitution: 0.1,
    });
    logEntity.addComponent(PhysicsBody, {
      state: PhysicsState.Dynamic,
      linearDamping: 0.08,
      angularDamping: 0.08,
      gravityFactor: 1.0,
    });
    logEntity.addComponent(RayInteractable, {});
    logEntity.addComponent(DistanceGrabbable, { movementMode: 'MoveFromTarget' });

    this.dynamicItems.push(logEntity);
    return logEntity;
  }

  /**
   * Apply a physical toss impulse to a target item.
   */
  public tossItem(entity: Entity, impulseVector: [number, number, number]): void {
    if (entity.hasComponent(PhysicsBody)) {
      entity.addComponent(PhysicsManipulation, {
        force: impulseVector,
      });
    }
  }
}
