import { Types, createSystem, type Entity } from '@iwsdk/core';
import { FacialLipSync } from '../components/FacialLipSync';
import { SpatialVoice } from '../components/SpatialVoice';

/** Common morph target names found in VRM, Ready Player Me, and standard glTF avatars */
export const MORPH_TARGET_NAMES = {
  JAW_OPEN: ['jawOpen', 'mouthOpen', 'v_aa', 'viseme_aa', 'mouth_open'],
  MOUTH_PUCKER: ['mouthPucker', 'mouthFunnel', 'v_ou', 'viseme_O', 'mouth_pucker'],
  VISEME_AA: ['viseme_aa', 'v_aa', 'aa', 'A'],
  VISEME_O: ['viseme_O', 'v_ou', 'oh', 'O'],
  VISEME_E: ['viseme_E', 'v_ee', 'ee', 'E'],
};

export class LipSyncSystem extends createSystem(
  {
    syncs: { required: [FacialLipSync] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
    simulatedFrequencyHz: { type: Types.Float32, default: 6.0 },
  },
) {
  private activeAmplitudes = new Map<number, number>();

  /**
   * Feed raw audio energy / amplitude envelope for an entity.
   */
  public setAudioAmplitude(entityId: number, amplitude: number): void {
    this.activeAmplitudes.set(entityId, Math.max(0, Math.min(1, amplitude)));
  }

  override update(delta: number, time: number): void {
    if (!this.config.enabled.value) return;

    for (const entity of this.queries.syncs.entities) {
      const entityId = entity.index ?? (entity as any).id ?? 0;
      // Guard on `.bitmask` — elics' actual registration marker; `.bit`
      // doesn't exist and was always falsy, so this always fell through
      // to the amplitude-only fallback below.
      const isSpeaking = ((SpatialVoice as any).bitmask && entity.hasComponent(SpatialVoice))
        ? Boolean(entity.getValue(SpatialVoice, 'isPlaying'))
        : (this.activeAmplitudes.get(entityId) ?? 0) > 0.05;

      const currentJaw = entity.getValue(FacialLipSync, 'jawOpen') ?? 0;
      const smoothing = entity.getValue(FacialLipSync, 'smoothing') ?? 0.35;
      const intensity = entity.getValue(FacialLipSync, 'intensityMultiplier') ?? 1.0;

      let targetJaw = 0;
      let targetPucker = 0;
      let targetAA = 0;
      let targetO = 0;
      let targetE = 0;

      if (isSpeaking) {
        // Compute procedural cadence modulated by audio energy or cadence time
        const rawAmp = this.activeAmplitudes.get(entityId);
        const cadence =
          rawAmp !== undefined
            ? rawAmp * intensity
            : (0.4 + 0.5 * Math.abs(Math.sin(time * 0.015 * this.config.simulatedFrequencyHz.value))) * intensity;

        targetJaw = Math.min(1.0, cadence);
        targetAA = targetJaw * 0.8;
        targetO = (0.5 + 0.5 * Math.cos(time * 0.01)) * targetJaw * 0.6;
        targetE = (0.5 + 0.5 * Math.sin(time * 0.012)) * targetJaw * 0.5;
        targetPucker = targetO * 0.4;
      }

      // Smooth interpolation
      const nextJaw = currentJaw + (targetJaw - currentJaw) * smoothing;
      const nextAA = (entity.getValue(FacialLipSync, 'visemeAA') ?? 0) + (targetAA - (entity.getValue(FacialLipSync, 'visemeAA') ?? 0)) * smoothing;
      const nextO = (entity.getValue(FacialLipSync, 'visemeO') ?? 0) + (targetO - (entity.getValue(FacialLipSync, 'visemeO') ?? 0)) * smoothing;
      const nextE = (entity.getValue(FacialLipSync, 'visemeE') ?? 0) + (targetE - (entity.getValue(FacialLipSync, 'visemeE') ?? 0)) * smoothing;
      const nextPucker = (entity.getValue(FacialLipSync, 'mouthPucker') ?? 0) + (targetPucker - (entity.getValue(FacialLipSync, 'mouthPucker') ?? 0)) * smoothing;

      entity.setValue(FacialLipSync, 'jawOpen', nextJaw);
      entity.setValue(FacialLipSync, 'visemeAA', nextAA);
      entity.setValue(FacialLipSync, 'visemeO', nextO);
      entity.setValue(FacialLipSync, 'visemeE', nextE);
      entity.setValue(FacialLipSync, 'mouthPucker', nextPucker);

      // Apply to Three.js Object3D Morph Targets if available
      this.applyToThreeMorphTargets(entity, {
        jaw: nextJaw,
        aa: nextAA,
        o: nextO,
        e: nextE,
        pucker: nextPucker,
      });
    }
  }

  /**
   * Traverse entity object3D hierarchy and set morphTargetInfluences on meshes.
   */
  private applyToThreeMorphTargets(
    entity: Entity,
    weights: { jaw: number; aa: number; o: number; e: number; pucker: number }
  ): void {
    const object3D = (entity as any).object3D;
    if (!object3D || typeof object3D.traverse !== 'function') return;

    object3D.traverse((node: any) => {
      if (node.morphTargetDictionary && node.morphTargetInfluences) {
        for (const [key, idx] of Object.entries(node.morphTargetDictionary as Record<string, number>)) {
          const lower = key.toLowerCase();
          if (MORPH_TARGET_NAMES.JAW_OPEN.some((n) => lower.includes(n.toLowerCase()))) {
            node.morphTargetInfluences[idx] = weights.jaw;
          } else if (MORPH_TARGET_NAMES.VISEME_AA.some((n) => lower.includes(n.toLowerCase()))) {
            node.morphTargetInfluences[idx] = weights.aa;
          } else if (MORPH_TARGET_NAMES.VISEME_O.some((n) => lower.includes(n.toLowerCase()))) {
            node.morphTargetInfluences[idx] = weights.o;
          }
        }
      }
    });
  }
}
