import { Types, createSystem, type Entity } from '@iwsdk/core';
import { SpatialVoice } from '../components/SpatialVoice';

export interface OcclusionCheckCallback {
  (sourcePos: [number, number, number], listenerPos: [number, number, number]): boolean;
}

export class AcousticOcclusionSystem extends createSystem(
  {
    voices: { required: [SpatialVoice] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
    occludedCutoffHz: { type: Types.Float32, default: 700.0 },
    clearCutoffHz: { type: Types.Float32, default: 20000.0 },
    occlusionAttenuation: { type: Types.Float32, default: 0.4 },
  },
) {
  private customRaycaster?: OcclusionCheckCallback;
  private listenerPosition: [number, number, number] = [0, 1.65, 0];
  private occlusionStates = new Map<number, boolean>();

  /** Register a custom geometric raycast occlusion function */
  public setRaycaster(fn: OcclusionCheckCallback): void {
    this.customRaycaster = fn;
  }

  /** Update listener/player head position */
  public setListenerPosition(pos: [number, number, number]): void {
    this.listenerPosition = pos;
  }

  /** Check if a given entity audio source is currently occluded */
  public isEntityOccluded(entity: Entity): boolean {
    const id = entity.index ?? (entity as any).id ?? 0;
    return this.occlusionStates.get(id) ?? false;
  }

  /** Manually set entity occlusion flag */
  public setEntityOcclusion(entity: Entity, occluded: boolean): void {
    const id = entity.index ?? (entity as any).id ?? 0;
    this.occlusionStates.set(id, occluded);
  }

  /** Compute effective filter cutoff frequency for an entity */
  public getCutoffFrequency(entity: Entity): number {
    return this.isEntityOccluded(entity)
      ? this.config.occludedCutoffHz.value
      : this.config.clearCutoffHz.value;
  }

  /** Compute effective volume attenuation factor for an entity */
  public getVolumeMultiplier(entity: Entity): number {
    return this.isEntityOccluded(entity)
      ? this.config.occlusionAttenuation.value
      : 1.0;
  }

  override update(_delta: number, _time: number): void {
    if (!this.config.enabled.value || !this.customRaycaster) return;

    for (const entity of this.queries.voices.entities) {
      const id = entity.index ?? (entity as any).id ?? 0;
      const pos: [number, number, number] = (entity as any).position ?? [0, 0, 0];
      const occluded = this.customRaycaster(pos, this.listenerPosition);
      this.occlusionStates.set(id, occluded);
    }
  }
}
