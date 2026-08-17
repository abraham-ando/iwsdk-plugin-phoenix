import { describe, it, expect } from 'vitest';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import { SkinnedApplicator } from '../src/apply/SkinnedApplicator';
import { skinnedLeg } from './fixtures/skinned-leg';

/** Pose compilée minimale : la cuisse passe de 1 m à 1,5 m. */
function poseAllongee(scaleRoot = 1): CompiledCharacter {
  return {
    family: 'humanoid',
    restPose: [
      { role: 'root', position: [0, 0, 0], scale: scaleRoot },
      { role: 'legL', position: [0, -1.5, 0], scale: 1 },
      { role: 'footL', position: [0, -1, 0], scale: 1 },
    ],
    morphs: {},
    surface: {},
    stats: { nominalHeightMeters: 1.75, groundOffsetMeters: 0 },
  };
}

describe('SkinnedApplicator', () => {
  it('déplace réellement la peau quand un os s allonge', () => {
    const { mesh, bones, vertexAt } = skinnedLeg();
    expect(vertexAt(0).y).toBeCloseTo(-1, 6);

    new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(poseAllongee());

    // C'est LA promesse du projet : le sommet du genou est descendu avec l os.
    expect(vertexAt(0).y).toBeCloseTo(-1.5, 6);
    expect(vertexAt(1).y).toBeCloseTo(-2.5, 6);
  });

  it('n appelle JAMAIS calculateInverses — sinon la déformation s annule', () => {
    const { mesh, bones, vertexAt } = skinnedLeg();
    let appels = 0;
    const vrai = mesh.skeleton.calculateInverses.bind(mesh.skeleton);
    mesh.skeleton.calculateInverses = () => { appels++; vrai(); };

    new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(poseAllongee());

    expect(appels).toBe(0);
    expect(vertexAt(0).y).toBeCloseTo(-1.5, 6);
  });

  it('applique une échelle UNIFORME, jamais par axe', () => {
    const { mesh, bones } = skinnedLeg();
    new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(poseAllongee(0.5));
    const root = bones.get('root')!;
    expect(root.scale.x).toBe(0.5);
    expect(root.scale.y).toBe(0.5);
    expect(root.scale.z).toBe(0.5);
  });

  it('ancre le rig sans toucher au squelette', () => {
    const { mesh, bones } = skinnedLeg();
    const pose = { ...poseAllongee(), stats: { nominalHeightMeters: 1.75, groundOffsetMeters: 2.5 } };
    new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(pose);
    expect(mesh.position.y).toBeCloseTo(2.5, 6);
    expect(bones.get('root')!.position.y).toBeCloseTo(0, 6);
  });

  it('applique une pose de repos en moins de deux millisecondes', () => {
    // Même méthode que le budget du compilateur : médiane sur cent applications
    // et non maximum, parce qu'une machine partagée produit des pics qu'on ne
    // veut pas transformer en test instable.
    const { mesh, bones } = skinnedLeg();
    const a = new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    });
    const pose = poseAllongee();
    for (let i = 0; i < 100; i++) a.applyRestPose(pose); // rodage du JIT

    const durees: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      a.applyRestPose(pose);
      durees.push(performance.now() - t0);
    }
    durees.sort((x, y) => x - y);
    expect(durees[50]!).toBeLessThan(2);
  });

  it('ignore un rôle que la liaison ne connaît pas, sans lever', () => {
    const { mesh, bones, vertexAt } = skinnedLeg();
    const pose = poseAllongee();
    pose.restPose.push({ role: 'queue', position: [0, 5, 0], scale: 1 });
    expect(() => new SkinnedApplicator({
      rigRoot: mesh, bones, meshes: [mesh],
      morphIndex: {}, surfaceTargets: {}, ramps: {},
    }).applyRestPose(pose)).not.toThrow();
    expect(vertexAt(0).y).toBeCloseTo(-1.5, 6);
  });
});
