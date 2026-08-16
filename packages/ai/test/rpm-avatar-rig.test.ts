/**
 * Unit tests for RPMAvatarRig — Masculine and Feminine Armature hierarchies,
 * joints, and morph targets.
 */

import { describe, it, expect } from 'vitest';
import { RPMAvatarRig } from '../src/avatar/RPMAvatarRig';
import { AvatarMeshBinder } from '../src/avatar/AvatarMeshBinder';
import { AvatarAnimationController } from '../src/avatar/AvatarAnimationController';

describe('RPMAvatarRig — Ready Player Me Armature Builder', () => {
  it('creates a masculine armature rig with all standard bones and joints', () => {
    const { root, joints } = RPMAvatarRig.createRig({
      gender: 'masculine',
      color: 0x3b82f6,
      name: 'Haran_Avatar',
    });

    expect(root).toBeDefined();
    expect(root.name).toBe('Haran_Avatar');
    expect(joints.hips.name).toBe('Hips');
    expect(joints.spine.name).toBe('Spine');
    expect(joints.chest.name).toBe('Spine1');
    expect(joints.neck.name).toBe('Neck');
    expect(joints.head.name).toBe('Head');
    expect(joints.leftArm.name).toBe('LeftArm');
    expect(joints.rightArm.name).toBe('RightArm');
    expect(joints.leftLeg.name).toBe('LeftLeg');
    expect(joints.rightLeg.name).toBe('RightLeg');
  });

  it('creates a feminine armature rig with standard ARKit morph targets on face mesh', () => {
    const { root, joints } = RPMAvatarRig.createRig({
      gender: 'feminine',
      color: 0xec4899,
      name: 'Mira_Avatar',
    });

    expect(root).toBeDefined();
    expect(joints.faceMesh).toBeDefined();
    expect(joints.faceMesh.morphTargetDictionary).toHaveProperty('jawOpen');
    expect(joints.faceMesh.morphTargetDictionary).toHaveProperty('viseme_aa');
    expect(joints.faceMesh.morphTargetDictionary).toHaveProperty('viseme_E');
    expect(joints.faceMesh.morphTargetDictionary).toHaveProperty('eyeBlinkLeft');
    expect(joints.faceMesh.morphTargetDictionary).toHaveProperty('eyeBlinkRight');
  });

  it('binds successfully with AvatarMeshBinder and controls animations', () => {
    const { root, joints } = RPMAvatarRig.createRig({ gender: 'masculine' });
    const binding = AvatarMeshBinder.bindAvatar(root as any, root as any);

    expect(binding.headBone).toBe(joints.head);
    expect(binding.mappedMorphs.viseme_aa).toBeDefined();

    const controller = new AvatarAnimationController(root, { gender: 'masculine' });
    controller.setTalking(true);
    expect(controller.getCurrentBaseName()).toBe('M_Talking_Variations_001');

    controller.setTalking(false);
    expect(controller.getCurrentBaseName()).toBe('M_Standing_Idle_001');
  });
});
