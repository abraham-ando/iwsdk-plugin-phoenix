import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { classifyTranslationTrack, CONSTANT_TRACK_EPSILON } from '../src/compile/clips';

describe('classifyTranslationTrack', () => {
  it('garde la translation de la racine : c est la locomotion', () => {
    // M_Walk_001 déplace Hips de 3,21 m — mesuré sur le clip réel.
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'root', amplitudeMeters: 3.21 }))
      .toBe('keep');
  });

  it('retire une piste constante sur un os non-racine', () => {
    // F_Dances_001 porte seize pistes de ce type : elles réencodent les
    // décalages d os du rig source et n emportent aucun mouvement.
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'legL', amplitudeMeters: 0 }))
      .toBe('strip');
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'foreArmR', amplitudeMeters: 1e-9 }))
      .toBe('strip');
  });

  it('signale un conflit quand un os non-racine bouge réellement', () => {
    // Ce cas n existe dans aucun des quatre clips mesurés, mais s il survenait
    // il écraserait la morphologie sans qu on le voie. Il doit crier.
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'legL', amplitudeMeters: 0.05 }))
      .toBe('conflict');
  });

  it('place le seuil de constance à un micromètre', () => {
    expect(CONSTANT_TRACK_EPSILON).toBe(1e-6);
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'legL', amplitudeMeters: 9e-7 }))
      .toBe('strip');
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'legL', amplitudeMeters: 2e-6 }))
      .toBe('conflict');
  });

  it('traite un rôle inconnu comme non-racine', () => {
    expect(classifyTranslationTrack(HUMANOID, { boneRole: 'queue', amplitudeMeters: 0 }))
      .toBe('strip');
  });
});
