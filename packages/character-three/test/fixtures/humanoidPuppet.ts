import {
  Bone, BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh,
  MeshBasicMaterial, Object3D, Skeleton, SkinnedMesh, Uint16BufferAttribute,
} from '@iwsdk/core';

/**
 * Convention de nommage des os de la fixture.
 *
 * - `'mixamo'` (défaut) — `mixamorig:Hips`… C'est le jeu d'alias SECONDAIRE de
 *   `HUMANOID.bones`, celui qui prouve que le résolveur ne dépend pas du nom
 *   canonique.
 * - `'rpm'` — `Hips`, `Spine2`, `Head`… la convention des deux avatars T-pose
 *   réellement livrés (mesurée dans `tpose-rig.test.ts`), et la SEULE des deux
 *   qu'un `AnimationMixer` sache viser.
 *
 * Mesuré, et c'est la raison d'être de cette option : `PropertyBinding` lit
 * `:` comme un séparateur de « répertoire ». Une piste `mixamorig:Hips.position`
 * est donc analysée en `{ nodeName: 'Hips' }` — qui ne désigne aucun nœud d'un
 * rig nommé à la Mixamo — et une piste `mixamorigHips.position` (le nom
 * assaini) n'en désigne pas davantage tant que les NŒUDS ne sont pas assainis
 * eux aussi, ce que fait `GLTFLoader` et pas cette fixture. Autrement dit :
 * aucun clip ne peut animer le rig `'mixamo'`, quel que soit le nom qu'on
 * donne à ses pistes. C'est exactement le trou qui laissait les cinq tests du
 * système d'animation verts avec un mixer branché sur rien.
 */
export type BoneNaming = 'mixamo' | 'rpm';

/**
 * Construit le squelette HUMANOID complet, en vrais `Object3D` — les mêmes noms
 * que la fixture `RigNode` de `resolve.test.ts`, mais ici de vrais nœuds de
 * scène. `hips` est l'os racine, pas le conteneur : les deux fabriques
 * ci-dessous l'enveloppent dans un `Object3D` séparé, le motif réaliste d'un
 * import glTF — exactement ce que `assertBonesAreDescendants` vérifie.
 */
function buildSkeleton(naming: BoneNaming): { hips: Bone; bones: Record<string, Object3D> } {
  const bones: Record<string, Object3D> = {};
  const prefix = naming === 'mixamo' ? 'mixamorig:' : '';

  const bone = (role: string, name: string, y = 0): Bone => {
    const b = new Bone();
    b.name = `${prefix}${name}`;
    b.position.set(0, y, 0);
    bones[role] = b;
    return b;
  };

  const hips = bone('root', 'Hips', 0.95);
  const spine = bone('spine', 'Spine', 0.12);
  const chest = bone('chest', 'Spine2', 0.14);
  const neck = bone('neck', 'Neck', 0.16);
  const head = bone('head', 'Head', 0.09);

  const arm = (side: 'Left' | 'Right') => {
    const suffix = side === 'Left' ? 'L' : 'R';
    const shoulder = bone(`shoulder${suffix}`, `${side}Shoulder`, 0.05);
    const upperArm = bone(`upperArm${suffix}`, `${side}Arm`, 0.13);
    const foreArm = bone(`foreArm${suffix}`, `${side}ForeArm`, 0.27);
    const hand = bone(`hand${suffix}`, `${side}Hand`, 0.25);
    shoulder.add(upperArm);
    upperArm.add(foreArm);
    foreArm.add(hand);
    return shoulder;
  };

  const leg = (side: 'Left' | 'Right') => {
    const suffix = side === 'Left' ? 'L' : 'R';
    const upLeg = bone(`upLeg${suffix}`, `${side}UpLeg`, -0.05);
    const shin = bone(`leg${suffix}`, `${side}Leg`, -0.44);
    const foot = bone(`foot${suffix}`, `${side}Foot`, -0.42);
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

  return { hips, bones };
}

/** Enveloppe une racine d'armature dans le conteneur que `createCharacter` reçoit. */
function wrap(hips: Bone): Object3D {
  const root = new Object3D();
  root.name = 'Character';
  root.add(hips);
  return root;
}

/**
 * Rig marionnette : aucun `SkinnedMesh`. Un simple `Mesh` nommé `Body` (un
 * alias de `HUMANOID.surfaces.skinTone`) donne à `createCharacter` une boîte
 * englobante finie et une cible de teinte — sans lui, `Box3.setFromObject`
 * reste vide (aucun enfant n'a de géométrie) et la hauteur mesurée serait
 * -Infinity.
 */
export function humanoidPuppet(naming: BoneNaming = 'mixamo'): {
  root: Object3D;
  bones: Record<string, Object3D>;
  body: Mesh<BoxGeometry, MeshBasicMaterial>;
} {
  const { hips, bones } = buildSkeleton(naming);

  const body = new Mesh(new BoxGeometry(0.4, 1.75, 0.3), new MeshBasicMaterial());
  body.name = 'Body';
  body.position.set(0, 0.875, 0);
  hips.add(body);

  return { root: wrap(hips), bones, body };
}

/**
 * Même squelette, mais le maillage est un `SkinnedMesh` porteur d'un
 * `morphTargetDictionary` pour chaque morph de visage de HUMANOID — de quoi
 * vérifier que `CharacterExpressionSystem` projette le gène `[0,1]` dans la
 * plage `[-1,1]` que la famille déclare, jusqu'à l'influence réellement
 * écrite sur le maillage. Lié à un vrai `Skeleton([hips])` : `Box3.setFromObject`
 * calcule la boîte englobante d'un `SkinnedMesh` via `applyBoneTransform`, qui
 * lit `mesh.skeleton` — sans liaison, `createCharacter` lève avant même
 * d'atteindre ce que ce test vérifie.
 */
export function humanoidSkinned(naming: BoneNaming = 'mixamo'): {
  root: Object3D;
  bones: Record<string, Object3D>;
  mesh: SkinnedMesh;
} {
  const { hips, bones } = buildSkeleton(naming);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0], 4));

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.name = 'Body';
  mesh.bind(new Skeleton([hips]));
  mesh.morphTargetDictionary = {
    jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4,
  };
  mesh.morphTargetInfluences = [0, 0, 0, 0, 0];
  hips.add(mesh);

  return { root: wrap(hips), bones, mesh };
}
