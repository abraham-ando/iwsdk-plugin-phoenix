/**
 * Ready Player Me Avatar Rig Builder.
 * Constructs humanoid skeletal rigs matching the official Ready Player Me
 * Masculine and Feminine Armature hierarchies with morph targets and joints.
 */

import type { RPMGender } from './RPMAnimationCatalog';

export interface RPMAvatarRigOptions {
  gender?: RPMGender;
  color?: number;
  accentColor?: number;
  scale?: number;
  name?: string;
  nodeFactory?: (name: string) => any;
}

export interface RPMAvatarJoints {
  hips: any;
  spine: any;
  chest: any;
  neck: any;
  head: any;
  faceMesh: any;
  leftShoulder: any;
  leftArm: any;
  leftForeArm: any;
  leftHand: any;
  rightShoulder: any;
  rightArm: any;
  rightForeArm: any;
  rightHand: any;
  leftUpLeg: any;
  leftLeg: any;
  leftFoot: any;
  rightUpLeg: any;
  rightLeg: any;
  rightFoot: any;
}

function defaultHierarchyNode(name: string): any {
  if (typeof (globalThis as any).THREE?.Group !== 'undefined') {
    const g = new (globalThis as any).THREE.Group();
    g.name = name;
    return g;
  }
  const children: any[] = [];
  const node: any = {
    name,
    children,
    position: {
      x: 0,
      y: 0,
      z: 0,
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
      },
    },
    rotation: {
      x: 0,
      y: 0,
      z: 0,
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
      },
    },
    scale: {
      x: 1,
      y: 1,
      z: 1,
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
      },
    },
    add(child: any) {
      children.push(child);
      child.parent = this;
      return this;
    },
    remove(child: any) {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      return this;
    },
    traverse(cb: (n: any) => void) {
      cb(this);
      for (const c of children) {
        if (c && typeof c.traverse === 'function') c.traverse(cb);
        else if (c) cb(c);
      }
    },
  };
  return node;
}

export class RPMAvatarRig {
  /**
   * Build a fully articulated 3D avatar rig adhering to Ready Player Me armature standards.
   */
  public static createRig(options: RPMAvatarRigOptions = {}): {
    root: any;
    joints: RPMAvatarJoints;
  } {
    const gender = options.gender ?? 'masculine';
    const isFem = gender === 'feminine';
    const s = options.scale ?? 1.0;
    const createNode = options.nodeFactory ?? defaultHierarchyNode;

    const root = createNode(options.name ?? `RPM_Avatar_${gender}`);

    // Proportions
    const shoulderWidth = (isFem ? 0.32 : 0.42) * s;
    const torsoHeight = (isFem ? 0.42 : 0.48) * s;
    const legLength = (isFem ? 0.68 : 0.74) * s;

    // 1. Root & Hips
    const hips = createNode('Hips');
    hips.position.set(0, legLength, 0);
    root.add(hips);

    // 2. Spine & Chest
    const spine = createNode('Spine');
    spine.position.set(0, 0.1 * s, 0);
    hips.add(spine);

    const chest = createNode('Spine1');
    chest.position.set(0, torsoHeight * 0.5, 0);
    spine.add(chest);

    // 3. Neck & Head
    const neck = createNode('Neck');
    neck.position.set(0, torsoHeight * 0.5, 0);
    chest.add(neck);

    const head = createNode('Head');
    head.position.set(0, 0.12 * s, 0);
    neck.add(head);

    // Face mesh with standard Ready Player Me / ARKit morph targets
    const faceMesh = createNode('Wolf3D_Avatar');
    faceMesh.morphTargetDictionary = {
      jawOpen: 0,
      viseme_aa: 1,
      viseme_E: 2,
      viseme_I: 3,
      viseme_O: 4,
      viseme_U: 5,
      eyeBlinkLeft: 6,
      eyeBlinkRight: 7,
      mouthSmile: 8,
      mouthPucker: 9,
    };
    faceMesh.morphTargetInfluences = new Array(10).fill(0);
    head.add(faceMesh);

    // Eyes
    const leftEye = createNode('LeftEye');
    leftEye.position.set(-0.045 * s, 0.02 * s, 0.11 * s);
    head.add(leftEye);

    const rightEye = createNode('RightEye');
    rightEye.position.set(0.045 * s, 0.02 * s, 0.11 * s);
    head.add(rightEye);

    // 4. Left Arm & Hand
    const leftShoulder = createNode('LeftShoulder');
    leftShoulder.position.set(-shoulderWidth * 0.5, torsoHeight * 0.4, 0);
    chest.add(leftShoulder);

    const leftArm = createNode('LeftArm');
    leftShoulder.add(leftArm);

    const leftForeArm = createNode('LeftForeArm');
    leftForeArm.position.set(0, -0.28 * s, 0);
    leftArm.add(leftForeArm);

    const leftHand = createNode('LeftHand');
    leftHand.position.set(0, -0.26 * s, 0);
    leftForeArm.add(leftHand);

    // 5. Right Arm & Hand
    const rightShoulder = createNode('RightShoulder');
    rightShoulder.position.set(shoulderWidth * 0.5, torsoHeight * 0.4, 0);
    chest.add(rightShoulder);

    const rightArm = createNode('RightArm');
    rightShoulder.add(rightArm);

    const rightForeArm = createNode('RightForeArm');
    rightForeArm.position.set(0, -0.28 * s, 0);
    rightArm.add(rightForeArm);

    const rightHand = createNode('RightHand');
    rightHand.position.set(0, -0.26 * s, 0);
    rightForeArm.add(rightHand);

    // 6. Left Leg & Foot
    const leftUpLeg = createNode('LeftUpLeg');
    leftUpLeg.position.set(-0.09 * s, -0.08 * s, 0);
    hips.add(leftUpLeg);

    const leftLeg = createNode('LeftLeg');
    leftLeg.position.set(0, -0.35 * s, 0);
    leftUpLeg.add(leftLeg);

    const leftFoot = createNode('LeftFoot');
    leftFoot.position.set(0, -0.32 * s, 0.05 * s);
    leftLeg.add(leftFoot);

    // 7. Right Leg & Foot
    const rightUpLeg = createNode('RightUpLeg');
    rightUpLeg.position.set(0.09 * s, -0.08 * s, 0);
    hips.add(rightUpLeg);

    const rightLeg = createNode('RightLeg');
    rightLeg.position.set(0, -0.35 * s, 0);
    rightUpLeg.add(rightLeg);

    const rightFoot = createNode('RightFoot');
    rightFoot.position.set(0, -0.32 * s, 0.05 * s);
    rightLeg.add(rightFoot);

    const joints: RPMAvatarJoints = {
      hips,
      spine,
      chest,
      neck,
      head,
      faceMesh,
      leftShoulder,
      leftArm,
      leftForeArm,
      leftHand,
      rightShoulder,
      rightArm,
      rightForeArm,
      rightHand,
      leftUpLeg,
      leftLeg,
      leftFoot,
      rightUpLeg,
      rightLeg,
      rightFoot,
    };

    return { root, joints };
  }
}
