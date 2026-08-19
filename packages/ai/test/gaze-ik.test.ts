import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { NPCGazeTracker } from '../src/components/NPCGazeTracker';
import { GazeIKSystem } from '../src/gaze/GazeIKSystem';

describe('GazeIKSystem', () => {
  let world: World;
  let gazeSystem: GazeIKSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(NPCGazeTracker);
    world.registerSystem(GazeIKSystem);
    gazeSystem = world.getSystem(GazeIKSystem)!;
  });

  it('updates gaze yaw and pitch smoothly with saccades', () => {
    const entity = world.createEntity();
    entity.addComponent(NPCGazeTracker, {
      maxTurnAngleDeg: 60,
      turnSpeed: 10.0,
      saccadeIntervalMs: 500,
    });

    gazeSystem.update(0.1, 1000);

    const yaw = entity.getValue(NPCGazeTracker, 'currentYaw');
    const pitch = entity.getValue(NPCGazeTracker, 'currentPitch');

    expect(typeof yaw).toBe('number');
    expect(typeof pitch).toBe('number');
    expect(Math.abs(yaw!)).toBeLessThanOrEqual(60);
  });

  /**
   * Builds a minimal fake `object3D` (position/rotation/traverse) for an
   * entity, mimicking what a real RPMAvatarRig would expose, without
   * pulling in `three` (not a dependency of packages/ai).
   */
  function withFakeObject3D(
    entity: ReturnType<World['createEntity']>,
    position: { x: number; y: number; z: number },
    bodyYawRad = 0,
  ) {
    (entity as any).object3D = {
      position: { ...position },
      rotation: { x: 0, y: bodyYawRad, z: 0 },
      traverse(cb: (node: any) => void) {
        cb({ name: 'Head', rotation: { x: 0, y: 0, z: 0 } });
      },
    };
  }

  it('Scenario 1: converges its yaw toward the player within 10 degrees after 2 seconds', () => {
    const entity = world.createEntity();
    entity.addComponent(NPCGazeTracker, {
      // A 90-degree bearing (see below) exceeds the codebase's usual
      // maxTurnAngleDeg default (75, see Scenario 2 for that clamp
      // behavior). This scenario is about convergence quality, not the
      // clamp, so it gives the neck enough range to actually reach the
      // player — otherwise this test would just re-measure the clamp
      // (already covered by Scenario 2) instead of proving the gaze
      // tracks the player's real direction.
      maxTurnAngleDeg: 100,
      turnSpeed: 4.0,
      saccadeIntervalMs: 100000, // avoid saccade noise interfering with this scenario
    });
    // NPC facing north (yaw = 0), at origin.
    withFakeObject3D(entity, { x: 0, y: 1.6, z: 0 }, 0);
    // Player due east, 2 meters away -> bearing is atan2(2, 0) = 90 degrees.
    gazeSystem.setPlayerPose({ x: 2, y: 1.6, z: 0 });

    // Simulate ~2 seconds of ticks.
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t += 100;
      gazeSystem.update(0.1, t);
    }

    const yaw = entity.getValue(NPCGazeTracker, 'currentYaw')!;
    // The head must actually point toward the player's real direction
    // (90 degrees), within 10 degrees — not merely toward whatever the
    // neck's turn limit happens to allow.
    expect(Math.abs(yaw - 90)).toBeLessThanOrEqual(10);
  });

  it('Scenario 2: never exceeds maxTurnAngleDeg even when the player is directly behind the NPC', () => {
    const entity = world.createEntity();
    entity.addComponent(NPCGazeTracker, {
      maxTurnAngleDeg: 60,
      turnSpeed: 6.0,
      saccadeIntervalMs: 100000,
    });
    // NPC facing north (yaw = 0) at origin.
    withFakeObject3D(entity, { x: 0, y: 1.6, z: 0 }, 0);
    // Player directly behind the NPC (south, -z), i.e. a 180 degree turn.
    gazeSystem.setPlayerPose({ x: 0, y: 1.6, z: -2 });

    let t = 0;
    for (let i = 0; i < 50; i++) {
      t += 100;
      gazeSystem.update(0.1, t);
    }

    const yaw = entity.getValue(NPCGazeTracker, 'currentYaw')!;
    expect(Math.abs(yaw)).toBeLessThanOrEqual(60);
    // Convergence should have driven the head fully to the clamp.
    expect(Math.abs(yaw)).toBeGreaterThanOrEqual(59);
  });

  it('Scenario 3: micro-saccades keep oscillating around the target without drifting away over 10 seconds', () => {
    const entity = world.createEntity();
    entity.addComponent(NPCGazeTracker, {
      maxTurnAngleDeg: 75,
      turnSpeed: 8.0,
      saccadeIntervalMs: 500,
      saccadeJitterDeg: 2.0,
    });
    withFakeObject3D(entity, { x: 0, y: 1.6, z: 0 }, 0);
    // Player ahead and slightly to the east -> expected base yaw ~ 30deg
    // (dx=1, dz=1.732 -> atan2(dx, dz) = 30deg with north = +z).
    gazeSystem.setPlayerPose({ x: 1, y: 1.6, z: 1.732 });

    let t = 0;
    // First converge (a few seconds).
    for (let i = 0; i < 50; i++) {
      t += 100;
      gazeSystem.update(0.1, t);
    }
    const convergedYaw = entity.getValue(NPCGazeTracker, 'currentYaw')!;
    // Gaze must have actually converged toward the player's real direction
    // (~30deg), not stayed parked near the saccade-only jitter around 0.
    expect(Math.abs(convergedYaw - 30)).toBeLessThanOrEqual(5);

    // Now let 10 more seconds elapse with the player still immobile, and
    // track the observed yaw across saccade-driven ticks.
    let minYaw = Infinity;
    let maxYaw = -Infinity;
    for (let i = 0; i < 100; i++) {
      t += 100;
      gazeSystem.update(0.1, t);
      const yaw = entity.getValue(NPCGazeTracker, 'currentYaw')!;
      minYaw = Math.min(minYaw, yaw);
      maxYaw = Math.max(maxYaw, yaw);
    }

    // Oscillation stays tightly bounded around the player's real direction
    // (saccade jitter is a couple of degrees), never drifting away from it.
    expect(Math.abs(minYaw - 30)).toBeLessThanOrEqual(5);
    expect(Math.abs(maxYaw - 30)).toBeLessThanOrEqual(5);
  });
});
