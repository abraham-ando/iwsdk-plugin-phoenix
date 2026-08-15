import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { AILOD, AILODLevel } from '../src/components/AILOD';
import { AILODSystem } from '../src/lod/AILODSystem';

describe('AILODSystem', () => {
  let world: World;
  let lodSystem: AILODSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(AILOD);
    world.registerSystem(AILODSystem);
    lodSystem = world.getSystem(AILODSystem) as AILODSystem;
    lodSystem.setPlayerPosition([0, 0, 0]);
  });

  it('adjusts LOD tiers and throttling intervals based on distance to player', () => {
    const nearEntity = world.createEntity();
    nearEntity.addComponent(AILOD);
    (nearEntity as any).position = [1, 0, 1]; // dist ~1.41m (<3m)

    const midEntity = world.createEntity();
    midEntity.addComponent(AILOD);
    (midEntity as any).position = [4, 0, 3]; // dist 5.0m (3-8m)

    const farEntity = world.createEntity();
    farEntity.addComponent(AILOD);
    (farEntity as any).position = [10, 0, 0]; // dist 10.0m (8-16m)

    const culledEntity = world.createEntity();
    culledEntity.addComponent(AILOD);
    (culledEntity as any).position = [20, 0, 0]; // dist 20.0m (>16m)

    lodSystem.update(0.016, 0);

    expect(nearEntity.getValue(AILOD, 'lodLevel')).toBe(AILODLevel.FULL);
    expect(nearEntity.getValue(AILOD, 'updateIntervalMs')).toBe(0);

    expect(midEntity.getValue(AILOD, 'lodLevel')).toBe(AILODLevel.MEDIUM);
    expect(midEntity.getValue(AILOD, 'updateIntervalMs')).toBeCloseTo(33.3);

    expect(farEntity.getValue(AILOD, 'lodLevel')).toBe(AILODLevel.LOW);
    expect(farEntity.getValue(AILOD, 'updateIntervalMs')).toBe(100);

    expect(culledEntity.getValue(AILOD, 'lodLevel')).toBe(AILODLevel.CULLED);
  });
});
