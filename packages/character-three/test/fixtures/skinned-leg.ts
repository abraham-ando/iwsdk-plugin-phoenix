import {
  Bone, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial,
  Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3,
} from '@iwsdk/core';

/**
 * Chaîne hanche → genou → cheville, avec un sommet pondéré sur chaque os.
 * C'est la fixture qui a servi à établir, par la mesure, que déplacer un os
 * EST la déformation et que recalculer les matrices inverses l'annule.
 */
export function skinnedLeg() {
  const hip = new Bone(); hip.name = 'Hips';
  const knee = new Bone(); knee.name = 'LeftLeg'; knee.position.set(0, -1, 0);
  const ankle = new Bone(); ankle.name = 'LeftFoot'; ankle.position.set(0, -1, 0);
  hip.add(knee); knee.add(ankle);

  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 0, -2, 0], 3));
  geom.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 2, 0, 0, 0], 4));
  geom.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4));

  const mesh = new SkinnedMesh(geom, new MeshBasicMaterial());
  mesh.add(hip);
  mesh.bind(new Skeleton([hip, knee, ankle]));
  mesh.updateMatrixWorld(true);

  const bones = new Map([['root', hip], ['legL', knee], ['footL', ankle]]);

  /** Position skinnée du sommet `i`, telle que le GPU la calculerait. */
  const vertexAt = (i: number): Vector3 => {
    const v = new Vector3().fromBufferAttribute(geom.getAttribute('position'), i);
    mesh.applyBoneTransform(i, v);
    return v;
  };

  return { mesh, bones, vertexAt };
}
