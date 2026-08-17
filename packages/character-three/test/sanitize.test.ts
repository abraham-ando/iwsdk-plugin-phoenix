import { describe, it, expect } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from '@iwsdk/core';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { sanitizeClip } from '../src/clips/sanitize';

const roleOf = (name: string): string | null =>
  ({ Hips: 'root', LeftLeg: 'legL', LeftFoot: 'footL' } as Record<string, string>)[name] ?? null;

/** Réplique de F_Dances_001 : dix-sept pistes de translation, seize constantes. */
function danse(): AnimationClip {
  const t = [0, 0.5, 1];
  const tracks: Array<VectorKeyframeTrack | QuaternionKeyframeTrack> = [
    // La racine bouge réellement : 21 cm mesurés sur le vrai clip.
    new VectorKeyframeTrack('Hips.position', t, [0, 0, 0, 0, 0.21, 0, 0, 0, 0]),
    new QuaternionKeyframeTrack('LeftLeg.quaternion', t, [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  ];
  // Seize pistes constantes, qui réencodent les décalages du rig source.
  for (let i = 0; i < 16; i++) {
    const name = i % 2 === 0 ? 'LeftLeg' : 'LeftFoot';
    tracks.push(new VectorKeyframeTrack(`${name}.position`, t, [0, -1, 0, 0, -1, 0, 0, -1, 0]));
  }
  return new AnimationClip('F_Dances_001', 1, tracks);
}

describe('sanitizeClip', () => {
  it('retire les seize pistes constantes et garde celle des hanches', () => {
    const { clip, stripped } = sanitizeClip(danse(), HUMANOID, roleOf);
    expect(stripped).toHaveLength(16);
    const noms = clip.tracks.map((t) => t.name);
    expect(noms).toContain('Hips.position');
    expect(noms).toContain('LeftLeg.quaternion');
    expect(noms.filter((n) => n.endsWith('.position'))).toHaveLength(1);
  });

  it('ne mute pas le clip d origine', () => {
    const original = danse();
    const avant = original.tracks.length;
    sanitizeClip(original, HUMANOID, roleOf);
    expect(original.tracks).toHaveLength(avant);
  });

  it('rend le MÊME objet pour un clip déjà vu', () => {
    const c = danse();
    expect(sanitizeClip(c, HUMANOID, roleOf).clip).toBe(sanitizeClip(c, HUMANOID, roleOf).clip);
  });

  it('lève quand un os non racine bouge réellement', () => {
    const conflit = new AnimationClip('bancal', 1, [
      new VectorKeyframeTrack('LeftLeg.position', [0, 1], [0, -1, 0, 0, -1.4, 0]),
    ]);
    expect(() => sanitizeClip(conflit, HUMANOID, roleOf)).toThrow('LeftLeg');
  });

  it('traite un nœud sans rôle comme non-racine, donc lève s il bouge', () => {
    const c = new AnimationClip('accessoire', 1, [
      new VectorKeyframeTrack('Cape.position', [0, 1], [0, 0, 0, 0, 0.5, 0]),
    ]);
    // Sans rôle, la règle la traite comme non racine et variable : elle lève.
    expect(() => sanitizeClip(c, HUMANOID, roleOf)).toThrow('Cape');
  });
});
