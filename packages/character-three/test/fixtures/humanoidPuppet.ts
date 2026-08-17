import { Bone, BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from '@iwsdk/core';

/**
 * Hiérarchie HUMANOID complète, en vrais `Object3D`, alias Mixamo — les mêmes
 * noms que la fixture `RigNode` de `resolve.test.ts`, mais ici de vrais nœuds
 * de scène. Le conteneur rendu est un `Object3D` séparé qui ENGLOBE l'os
 * racine (`mixamorig:Hips`) : c'est le motif réaliste d'un import glTF, où le
 * nœud de scène qui reçoit `createCharacter` n'est PAS lui-même un os, mais
 * un ancêtre commun — exactement ce que `assertBonesAreDescendants` vérifie.
 * Aucun `SkinnedMesh` : c'est le cas marionnette, le plus simple des deux
 * applicateurs.
 */
export function humanoidPuppet(): { root: Object3D; bones: Record<string, Object3D> } {
  const bones: Record<string, Object3D> = {};

  const bone = (role: string, name: string, y = 0): Bone => {
    const b = new Bone();
    b.name = name;
    b.position.set(0, y, 0);
    bones[role] = b;
    return b;
  };

  const hips = bone('root', 'mixamorig:Hips', 0.95);
  const spine = bone('spine', 'mixamorig:Spine', 0.12);
  const chest = bone('chest', 'mixamorig:Spine2', 0.14);
  const neck = bone('neck', 'mixamorig:Neck', 0.16);
  const head = bone('head', 'mixamorig:Head', 0.09);

  const arm = (side: 'Left' | 'Right') => {
    const suffix = side === 'Left' ? 'L' : 'R';
    const shoulder = bone(`shoulder${suffix}`, `mixamorig:${side}Shoulder`, 0.05);
    const upperArm = bone(`upperArm${suffix}`, `mixamorig:${side}Arm`, 0.13);
    const foreArm = bone(`foreArm${suffix}`, `mixamorig:${side}ForeArm`, 0.27);
    const hand = bone(`hand${suffix}`, `mixamorig:${side}Hand`, 0.25);
    shoulder.add(upperArm);
    upperArm.add(foreArm);
    foreArm.add(hand);
    return shoulder;
  };

  const leg = (side: 'Left' | 'Right') => {
    const suffix = side === 'Left' ? 'L' : 'R';
    const upLeg = bone(`upLeg${suffix}`, `mixamorig:${side}UpLeg`, -0.05);
    const shin = bone(`leg${suffix}`, `mixamorig:${side}Leg`, -0.44);
    const foot = bone(`foot${suffix}`, `mixamorig:${side}Foot`, -0.42);
    upLeg.add(shin);
    shin.add(foot);
    return upLeg;
  };

  neck.add(head);
  chest.add(neck);
  chest.add(arm('Left'));
  chest.add(arm('Right'));
  spine.add(chest);
  hips.add(spine);
  hips.add(leg('Left'));
  hips.add(leg('Right'));

  // Un maillage sans squelette, juste pour donner une boîte englobante finie
  // à `createCharacter` — sans lui, `Box3.setFromObject` reste vide (aucun
  // enfant n'a de géométrie) et la hauteur mesurée serait -Infinity.
  const body = new Mesh(new BoxGeometry(0.4, 1.75, 0.3), new MeshBasicMaterial());
  body.name = 'BodyPlaceholder';
  body.position.set(0, 0.875, 0);
  hips.add(body);

  // Le conteneur rendu à `createCharacter` : un nœud de scène distinct de
  // l'armature, comme le nœud racine d'un glTF importé qui porte à la fois
  // le maillage et le squelette comme enfants.
  const root = new Object3D();
  root.name = 'Character';
  root.add(hips);

  return { root, bones };
}
