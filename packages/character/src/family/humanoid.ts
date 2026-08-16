import type { FamilyDescriptor } from './types';

/**
 * Squelette humanoïde. Les alias couvrent les conventions rencontrées dans ce
 * dépôt : Ready Player Me, Mixamo, et la nomenclature de la spécification
 * d'origine. C'est la généralisation de la méthode d'AvatarMeshBinder, qui
 * fait déjà exactement cela pour les visèmes.
 */
export const HUMANOID: FamilyDescriptor = {
  id: 'humanoid',
  adultAge: 18,

  bones: {
    root: ['Hips', 'Root', 'mixamorig:Hips', 'Armature'],
    spine: ['Spine', 'Bone_Spine', 'mixamorig:Spine'],
    chest: ['Spine2', 'Chest', 'Bone_Chest', 'mixamorig:Spine2'],
    neck: ['Neck', 'mixamorig:Neck'],
    head: ['Head', 'mixamorig:Head', 'j_bip_c_head'],
    shoulderL: ['LeftShoulder', 'Bone_Clavicle_L', 'mixamorig:LeftShoulder'],
    upperArmL: ['LeftArm', 'Bone_Arm_L', 'mixamorig:LeftArm'],
    foreArmL: ['LeftForeArm', 'mixamorig:LeftForeArm'],
    handL: ['LeftHand', 'mixamorig:LeftHand'],
    shoulderR: ['RightShoulder', 'Bone_Clavicle_R', 'mixamorig:RightShoulder'],
    upperArmR: ['RightArm', 'Bone_Arm_R', 'mixamorig:RightArm'],
    foreArmR: ['RightForeArm', 'mixamorig:RightForeArm'],
    handR: ['RightHand', 'mixamorig:RightHand'],
    upLegL: ['LeftUpLeg', 'mixamorig:LeftUpLeg'],
    legL: ['LeftLeg', 'mixamorig:LeftLeg'],
    footL: ['LeftFoot', 'mixamorig:LeftFoot'],
    upLegR: ['RightUpLeg', 'mixamorig:RightUpLeg'],
    legR: ['RightLeg', 'mixamorig:RightLeg'],
    footR: ['RightFoot', 'mixamorig:RightFoot'],
  },

  chains: {
    arm: { from: 'shoulderL', to: 'handL', gene: 'armLength', mirror: ['shoulderR', 'handR'] },
    leg: { from: 'upLegL', to: 'footL', gene: 'legLength', mirror: ['upLegR', 'footR'] },
    torso: { from: 'root', to: 'neck', gene: 'torsoLength' },
  },

  morphs: {
    jawWidth: { aliases: ['jawWidth', 'Jaw_Width', 'jawForward'], range: [-1, 1] },
    noseSize: { aliases: ['noseSize', 'Nose_Size'], range: [-1, 1] },
    eyeScale: { aliases: ['eyeScale', 'eyesClosed', 'Eye_Scale'], range: [-1, 1] },
    cheekbone: { aliases: ['cheekbone', 'cheekPuff', 'Cheek_Bone'], range: [-1, 1] },
    bodyMass: { aliases: ['bodyMass', 'Corpulence', 'weight'], range: [0, 1] },
  },

  // Un nourrisson mesure environ 50 cm pour 1,75 m adulte, et sa tête occupe
  // le quart de sa hauteur contre un septième et demi chez l'adulte. Aucune
  // combinaison d'échelles d'os ne produit cela : c'est pourquoi l'âge est un
  // paramètre d'évaluation et non un gène.
  proportions: {
    headToBody: [
      [0, 0.25],
      [3, 0.2],
      [12, 0.15],
      [18, 0.133],
    ],
    limbToTorso: [
      [0, 0.62],
      [12, 0.88],
      [18, 1.0],
    ],
    bodyScale: [
      [0, 0.28],
      [3, 0.52],
      [12, 0.8],
      [18, 1.0],
      [70, 0.98],
    ],
  },

  slots: { rightHand: 'handR', leftHand: 'handL', back: 'chest', head: 'head' },

  genes: {
    stature: { group: 'structure', heritability: 0.9, dominance: 0.5, mutationRate: 0.04 },
    armLength: { group: 'structure', heritability: 0.85, dominance: 0.5, mutationRate: 0.04 },
    legLength: { group: 'structure', heritability: 0.85, dominance: 0.5, mutationRate: 0.04 },
    torsoLength: { group: 'structure', heritability: 0.85, dominance: 0.5, mutationRate: 0.04 },
    shoulderWidth: {
      group: 'structure',
      heritability: 0.8,
      dominance: 0.6,
      mutationRate: 0.05,
      sexLinked: 'm',
    },
    jawWidth: { group: 'face', heritability: 0.7, dominance: 0.5, mutationRate: 0.06, sexLinked: 'm' },
    noseSize: { group: 'face', heritability: 0.75, dominance: 0.5, mutationRate: 0.06 },
    eyeScale: { group: 'face', heritability: 0.7, dominance: 0.5, mutationRate: 0.06 },
    cheekbone: { group: 'face', heritability: 0.7, dominance: 0.5, mutationRate: 0.06 },
    bodyMass: { group: 'face', heritability: 0.5, dominance: 0.5, mutationRate: 0.1 },
    skinTone: { group: 'surface', heritability: 0.95, dominance: 0.5, mutationRate: 0.02 },
    hairTone: { group: 'surface', heritability: 0.9, dominance: 0.4, mutationRate: 0.03 },
    hairStyle: { group: 'surface', heritability: 0.2, dominance: 0.5, mutationRate: 0.3 },
  },
};
