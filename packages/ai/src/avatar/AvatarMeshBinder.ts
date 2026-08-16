import type { Entity } from '@iwsdk/core';
import { FacialLipSync } from '../components/FacialLipSync';
import { NPCGazeTracker } from '../components/NPCGazeTracker';

export interface AvatarMorphMapping {
  jawOpen?: number;
  viseme_aa?: number;
  viseme_E?: number;
  viseme_I?: number;
  viseme_O?: number;
  viseme_U?: number;
  eyeBlinkLeft?: number;
  eyeBlinkRight?: number;
}

export interface AvatarBindingResult {
  faceMesh: any | null;
  morphTargetDictionary: Record<string, number>;
  mappedMorphs: AvatarMorphMapping;
  headBone: any | null;
  neckBone: any | null;
  leftEyeBone: any | null;
  rightEyeBone: any | null;
}

export interface AvatarBindOptions {
  /** Override face mesh name or search string */
  faceMeshName?: string;
  /** Custom mouth offset relative to head bone [x, y, z] */
  mouthOffset?: [number, number, number];
}

export class AvatarMeshBinder {
  private static readonly VISEME_CANDIDATES: Record<keyof AvatarMorphMapping, string[]> = {
    jawOpen: ['jawOpen', 'mouthOpen', 'jaw_open', 'Mouth_Open', 'A01_Jaw_Open', 'FACS_Jaw_Open'],
    viseme_aa: ['viseme_aa', 'viseme_AA', 'v_aa', 'mouth_aa', 'A02_Mouth_A'],
    viseme_E: ['viseme_E', 'viseme_e', 'v_e', 'mouth_e', 'A03_Mouth_E'],
    viseme_I: ['viseme_I', 'viseme_i', 'v_i', 'mouth_i', 'A04_Mouth_I'],
    viseme_O: ['viseme_O', 'viseme_o', 'v_o', 'mouth_o', 'A05_Mouth_O'],
    viseme_U: ['viseme_U', 'viseme_u', 'v_u', 'mouth_u', 'A06_Mouth_U'],
    eyeBlinkLeft: ['eyeBlinkLeft', 'eyeBlink_L', 'blink_left', 'EyeBlinkLeft', 'Blink_L'],
    eyeBlinkRight: ['eyeBlinkRight', 'eyeBlink_R', 'blink_right', 'EyeBlinkRight', 'Blink_R'],
  };

  private static readonly HEAD_BONE_NAMES = ['head', 'head_01', 'mixamorig:head', 'j_bip_c_head', 'bip01_head'];
  private static readonly NECK_BONE_NAMES = ['neck', 'mixamorig:neck', 'j_bip_c_neck', 'bip01_neck'];
  private static readonly LEFT_EYE_NAMES = ['eye_l', 'lefteye', 'eyeleft', 'mixamorig:lefteye', 'j_bip_l_eye'];
  private static readonly RIGHT_EYE_NAMES = ['eye_r', 'righteye', 'eyeright', 'mixamorig:righteye', 'j_bip_r_eye'];

  /**
   * Traverse a Three.js / glTF avatar hierarchy and bind components (Lip-Sync, Gaze IK, Voice Position).
   */
  public static bindAvatar(
    entity: Entity,
    rootObject: any,
    options: AvatarBindOptions = {}
  ): AvatarBindingResult {
    let faceMesh: any = null;
    let headBone: any = null;
    let neckBone: any = null;
    let leftEyeBone: any = null;
    let rightEyeBone: any = null;

    if (rootObject && typeof rootObject.traverse === 'function') {
      rootObject.traverse((node: any) => {
        const name = (node.name || '').toLowerCase();

        // 1. Detect SkinnedMesh with morph targets
        if (node.morphTargetDictionary && !faceMesh) {
          if (!options.faceMeshName || name.includes(options.faceMeshName.toLowerCase())) {
            faceMesh = node;
          }
        }

        // 2. Detect Bones
        if (this.HEAD_BONE_NAMES.some((candidate) => name.includes(candidate)) && !headBone) {
          headBone = node;
        } else if (this.NECK_BONE_NAMES.some((candidate) => name.includes(candidate)) && !neckBone) {
          neckBone = node;
        } else if (this.LEFT_EYE_NAMES.some((candidate) => name.includes(candidate)) && !leftEyeBone) {
          leftEyeBone = node;
        } else if (this.RIGHT_EYE_NAMES.some((candidate) => name.includes(candidate)) && !rightEyeBone) {
          rightEyeBone = node;
        }
      });
    }

    const dict = faceMesh?.morphTargetDictionary || {};
    const mappedMorphs: AvatarMorphMapping = {};

    for (const [key, candidates] of Object.entries(this.VISEME_CANDIDATES) as Array<[keyof AvatarMorphMapping, string[]]>) {
      for (const candidate of candidates) {
        if (candidate in dict) {
          mappedMorphs[key] = dict[candidate];
          break;
        }
      }
    }

    return {
      faceMesh,
      morphTargetDictionary: dict,
      mappedMorphs,
      headBone,
      neckBone,
      leftEyeBone,
      rightEyeBone,
    };
  }

  /**
   * Apply calculated viseme weights to the avatar's morph targets.
   */
  public static applyVisemes(
    binding: AvatarBindingResult,
    weights: { jaw?: number; aa?: number; e?: number; i?: number; o?: number; u?: number }
  ): void {
    if (!binding.faceMesh?.morphTargetInfluences) return;
    const influences = binding.faceMesh.morphTargetInfluences;

    if (weights.jaw !== undefined && binding.mappedMorphs.jawOpen !== undefined) {
      influences[binding.mappedMorphs.jawOpen] = weights.jaw;
    }
    if (weights.aa !== undefined && binding.mappedMorphs.viseme_aa !== undefined) {
      influences[binding.mappedMorphs.viseme_aa] = weights.aa;
    }
    if (weights.e !== undefined && binding.mappedMorphs.viseme_E !== undefined) {
      influences[binding.mappedMorphs.viseme_E] = weights.e;
    }
    if (weights.i !== undefined && binding.mappedMorphs.viseme_I !== undefined) {
      influences[binding.mappedMorphs.viseme_I] = weights.i;
    }
    if (weights.o !== undefined && binding.mappedMorphs.viseme_O !== undefined) {
      influences[binding.mappedMorphs.viseme_O] = weights.o;
    }
    if (weights.u !== undefined && binding.mappedMorphs.viseme_U !== undefined) {
      influences[binding.mappedMorphs.viseme_U] = weights.u;
    }
  }

  /**
   * Apply head and neck gaze orientation.
   */
  public static applyGazeRotation(
    binding: AvatarBindingResult,
    yawRad: number,
    pitchRad: number
  ): void {
    if (binding.headBone?.rotation) {
      // Smooth 70% head, 30% neck distribution
      binding.headBone.rotation.y = yawRad * 0.7;
      binding.headBone.rotation.x = pitchRad * 0.7;
    }
    if (binding.neckBone?.rotation) {
      binding.neckBone.rotation.y = yawRad * 0.3;
      binding.neckBone.rotation.x = pitchRad * 0.3;
    }
  }
}
