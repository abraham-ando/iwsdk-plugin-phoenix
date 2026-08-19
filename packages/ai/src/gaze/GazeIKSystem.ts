import { Types, createSystem, type Entity } from '@iwsdk/core';
import { NPCGazeTracker } from '../components/NPCGazeTracker';

export interface PlayerHeadPose {
  x: number;
  y: number;
  z: number;
}

/** Normalizes an angle in degrees to the [-180, 180] range. */
function normalizeAngleDeg(angleDeg: number): number {
  let normalized = angleDeg % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
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

      // Calculate desired target angle towards player pose.
      //
      // Angle convention: yaw is measured with `Math.atan2(dx, dz)` on the
      // NPC->player vector (dx/dz in world space), which is 0 when the
      // player is straight ahead of "north" (+z) and grows towards the
      // "east" (+x) — i.e. a compass-style bearing, not the three.js
      // right-handed math convention. The NPC's own facing is `object3D
      // .rotation.y` in radians, expressed in the same bearing convention
      // (0 = facing north). The relative yaw the neck must turn is the
      // player bearing minus the NPC's body yaw, normalized to [-180, 180].
      // Pitch is derived from `atan2(dy, horizontalDistance)`.
      const object3D = (entity as any).object3D;
      let baseYaw = 0;
      let basePitch = 0;
      if (object3D && object3D.position) {
        const dx = this.playerPose.x - object3D.position.x;
        const dy = this.playerPose.y - object3D.position.y;
        const dz = this.playerPose.z - object3D.position.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);
        const bodyYawDeg = ((object3D.rotation?.y ?? 0) * 180) / Math.PI;
        const bearingDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
        baseYaw = normalizeAngleDeg(bearingDeg - bodyYawDeg);
        basePitch = (Math.atan2(dy, horizontalDist) * 180) / Math.PI;
      }

      // Saccades are superimposed on top of the base gaze direction, and
      // the combined total is what's clamped to the neck's turn limits —
      // otherwise jitter could push an already-clamped gaze past the limit.
      const targetYaw = Math.max(-maxTurn, Math.min(maxTurn, baseYaw + saccadeYaw));
      const targetPitch = Math.max(
        -maxTurn * 0.5,
        Math.min(maxTurn * 0.5, basePitch + saccadePitch),
      );

      const currentYaw = entity.getValue(NPCGazeTracker, 'currentYaw') ?? 0;
      const currentPitch = entity.getValue(NPCGazeTracker, 'currentPitch') ?? 0;

      // Smooth exponential/lerp convergence
      const lerpFactor = Math.min(1.0, turnSpeed * delta);
      const nextYaw = currentYaw + (targetYaw - currentYaw) * lerpFactor;
      const nextPitch = currentPitch + (targetPitch - currentPitch) * lerpFactor;

      entity.setValue(NPCGazeTracker, 'currentYaw', nextYaw);
      entity.setValue(NPCGazeTracker, 'currentPitch', nextPitch);

      // Apply rotation to Three.js Object3D head/neck bone if present
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
