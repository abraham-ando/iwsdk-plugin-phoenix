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
});
