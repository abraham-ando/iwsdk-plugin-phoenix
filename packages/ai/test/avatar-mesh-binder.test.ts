import { describe, it, expect, beforeEach } from 'vitest';
import { World, Entity } from '@iwsdk/core';
import { AvatarMeshBinder } from '../src/avatar/AvatarMeshBinder';
import { FacialLipSync } from '../src/components/FacialLipSync';
import { NPCGazeTracker } from '../src/components/NPCGazeTracker';

describe('AvatarMeshBinder', () => {
  let world: World;
  let entity: Entity;

  beforeEach(() => {
    world = new World();
    world.registerComponent(FacialLipSync);
    world.registerComponent(NPCGazeTracker);

    entity = world.createEntity();
    entity.addComponent(FacialLipSync);
    entity.addComponent(NPCGazeTracker);
  });

  it('should discover morph targets and skeleton bones from mock 3D hierarchy', () => {
    const mockRoot = {
      traverse(callback: (node: any) => void) {
        callback({
          name: 'Wolf3D_Head',
          morphTargetDictionary: {
            viseme_aa: 0,
            viseme_E: 1,
            jawOpen: 2,
          },
          morphTargetInfluences: [0, 0, 0],
        });
        callback({
          name: 'mixamorig:Head',
          rotation: { x: 0, y: 0, z: 0 },
        });
        callback({
          name: 'mixamorig:Neck',
          rotation: { x: 0, y: 0, z: 0 },
        });
      },
    };

    const result = AvatarMeshBinder.bindAvatar(entity, mockRoot);

    expect(result.faceMesh).toBeDefined();
    expect(result.headBone).toBeDefined();
    expect(result.neckBone).toBeDefined();
    expect(result.mappedMorphs.viseme_aa).toBe(0);
    expect(result.mappedMorphs.jawOpen).toBe(2);
  });

  it('should apply visemes to morph target influences correctly', () => {
    const influences = [0, 0, 0];
    const mockBinding = {
      faceMesh: { morphTargetInfluences: influences },
      morphTargetDictionary: { viseme_aa: 0, viseme_E: 1, jawOpen: 2 },
      mappedMorphs: { viseme_aa: 0, viseme_E: 1, jawOpen: 2 },
      headBone: null,
      neckBone: null,
      leftEyeBone: null,
      rightEyeBone: null,
    };

    AvatarMeshBinder.applyVisemes(mockBinding, { jaw: 0.8, aa: 0.5 });

    expect(influences[2]).toBe(0.8); // jawOpen
    expect(influences[0]).toBe(0.5); // viseme_aa
  });

  it('should apply gaze rotation to head and neck bones', () => {
    const head = { rotation: { x: 0, y: 0, z: 0 } };
    const neck = { rotation: { x: 0, y: 0, z: 0 } };
    const mockBinding = {
      faceMesh: null,
      morphTargetDictionary: {},
      mappedMorphs: {},
      headBone: head,
      neckBone: neck,
      leftEyeBone: null,
      rightEyeBone: null,
    };

    AvatarMeshBinder.applyGazeRotation(mockBinding, 1.0, 0.5);

    expect(head.rotation.y).toBeCloseTo(0.7);
    expect(head.rotation.x).toBeCloseTo(0.35);
    expect(neck.rotation.y).toBeCloseTo(0.3);
    expect(neck.rotation.x).toBeCloseTo(0.15);
  });
});
