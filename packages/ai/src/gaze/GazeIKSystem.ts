import { Types, createSystem, type Entity } from '@iwsdk/core';
import { NPCGazeTracker } from '../components/NPCGazeTracker';

export interface PlayerHeadPose {
  x: number;
  y: number;
  z: number;
}

export class GazeIKSystem extends createSystem(
  {
    gazers: { required: [NPCGazeTracker] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
    defaultPlayerHeight: { type: Types.Float32, default: 1.65 },
  },
) {
  private playerPose: PlayerHeadPose = { x: 0, y: 1.65, z: 2.0 };

  /** Update active player headset / camera position */
  public setPlayerPose(pose: Partial<PlayerHeadPose>): void {
    this.playerPose = { ...this.playerPose, ...pose };
  }

  override update(delta: number, time: number): void {
    if (!this.config.enabled.value) return;

    for (const entity of this.queries.gazers.entities) {
      const maxTurn = entity.getValue(NPCGazeTracker, 'maxTurnAngleDeg') ?? 75.0;
      const turnSpeed = entity.getValue(NPCGazeTracker, 'turnSpeed') ?? 4.0;
      const saccadeInterval = entity.getValue(NPCGazeTracker, 'saccadeIntervalMs') ?? 2500;
      const saccadeJitter = entity.getValue(NPCGazeTracker, 'saccadeJitterDeg') ?? 2.0;
      const lastSaccade = entity.getValue(NPCGazeTracker, 'lastSaccadeTime') ?? 0;

      let saccadeYaw = entity.getValue(NPCGazeTracker, 'saccadeOffsetYaw') ?? 0;
      let saccadePitch = entity.getValue(NPCGazeTracker, 'saccadeOffsetPitch') ?? 0;

      // Check if time for a quick eye/head saccade shift
      if (time - lastSaccade > saccadeInterval) {
        saccadeYaw = (Math.random() * 2 - 1) * saccadeJitter;
        saccadePitch = (Math.random() * 2 - 1) * (saccadeJitter * 0.6);
        entity.setValue(NPCGazeTracker, 'lastSaccadeTime', time);
        entity.setValue(NPCGazeTracker, 'saccadeOffsetYaw', saccadeYaw);
        entity.setValue(NPCGazeTracker, 'saccadeOffsetPitch', saccadePitch);
      }

      // Calculate desired target angle towards player pose
      const targetYaw = Math.max(-maxTurn, Math.min(maxTurn, saccadeYaw));
      const targetPitch = Math.max(-maxTurn * 0.5, Math.min(maxTurn * 0.5, saccadePitch));

      const currentYaw = entity.getValue(NPCGazeTracker, 'currentYaw') ?? 0;
      const currentPitch = entity.getValue(NPCGazeTracker, 'currentPitch') ?? 0;

      // Smooth exponential/lerp convergence
      const lerpFactor = Math.min(1.0, turnSpeed * delta);
      const nextYaw = currentYaw + (targetYaw - currentYaw) * lerpFactor;
      const nextPitch = currentPitch + (targetPitch - currentPitch) * lerpFactor;

      entity.setValue(NPCGazeTracker, 'currentYaw', nextYaw);
      entity.setValue(NPCGazeTracker, 'currentPitch', nextPitch);

      // Apply rotation to Three.js Object3D head/neck bone if present
      const object3D = (entity as any).object3D;
      if (object3D && typeof object3D.traverse === 'function') {
        object3D.traverse((node: any) => {
          const lower = (node.name || '').toLowerCase();
          if (lower.includes('head') || lower.includes('neck')) {
            node.rotation.y = (nextYaw * Math.PI) / 180;
            node.rotation.x = (nextPitch * Math.PI) / 180;
          }
        });
      }
    }
  }
}
