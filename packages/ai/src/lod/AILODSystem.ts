import { Types, createSystem, type Entity } from '@iwsdk/core';
import { AILOD, AILODLevel, type AILODLevelValue } from '../components/AILOD';

export class AILODSystem extends createSystem(
  {
    lods: { required: [AILOD] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
    nearDistance: { type: Types.Float32, default: 3.0 },
    midDistance: { type: Types.Float32, default: 8.0 },
    cullDistance: { type: Types.Float32, default: 16.0 },
  },
) {
  private playerPos: [number, number, number] = [0, 1.65, 0];

  /** Update active player headset / camera position */
  public setPlayerPosition(pos: [number, number, number]): void {
    this.playerPos = pos;
  }

  /** Check if an entity should execute heavy processing on this frame */
  public shouldUpdateEntity(entity: Entity, time: number): boolean {
    const level = (entity.getValue(AILOD, 'lodLevel') ?? 0) as AILODLevelValue;
    if (level === AILODLevel.CULLED) return false;
    if (level === AILODLevel.FULL) return true;

    const interval = entity.getValue(AILOD, 'updateIntervalMs') ?? 0;
    const lastUpdate = entity.getValue(AILOD, 'lastUpdateTime') ?? 0;

    if (time - lastUpdate >= interval) {
      entity.setValue(AILOD, 'lastUpdateTime', time);
      return true;
    }
    return false;
  }

  override update(_delta: number, _time: number): void {
    if (!this.config.enabled.value) return;

    const near = this.config.nearDistance.value;
    const mid = this.config.midDistance.value;
    const cull = this.config.cullDistance.value;

    for (const entity of this.queries.lods.entities) {
      const pos: [number, number, number] = (entity as any).position ?? [0, 0, 0];
      const dx = pos[0] - this.playerPos[0];
      const dy = pos[1] - this.playerPos[1];
      const dz = pos[2] - this.playerPos[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      let level: AILODLevelValue = AILODLevel.FULL;
      let intervalMs = 0; // Every frame (90 Hz)

      if (distance > cull) {
        level = AILODLevel.CULLED;
        intervalMs = 999999;
      } else if (distance > mid) {
        level = AILODLevel.LOW;
        intervalMs = 100; // 10 Hz
      } else if (distance > near) {
        level = AILODLevel.MEDIUM;
        intervalMs = 33.3; // 30 Hz
      }

      entity.setValue(AILOD, 'distanceToPlayer', distance);
      entity.setValue(AILOD, 'lodLevel', level);
      entity.setValue(AILOD, 'updateIntervalMs', intervalMs);
    }
  }
}
