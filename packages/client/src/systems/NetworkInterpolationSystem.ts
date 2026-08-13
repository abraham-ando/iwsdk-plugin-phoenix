/**
 * Smooths 20-30 Hz network samples into 90 Hz headset motion.
 *
 * ## Why render in the past
 *
 * The naive approach — lerp toward the newest sample — is always extrapolating,
 * because the newest sample *is* the present. Any jitter in arrival time then
 * shows up directly as jitter in motion.
 *
 * Instead we render at `now - interpolationDelayMs`. That places the render
 * time *between* two samples we already hold, so playback is genuine
 * interpolation and network jitter is absorbed by the delay buffer rather than
 * being displayed. The cost is a fixed, predictable presentation lag, which at
 * ~100 ms is well below what a viewer notices on someone else's avatar and far
 * less objectionable than stutter.
 *
 * ## Dead reckoning
 *
 * When a packet is late the render time runs past the newest sample. Rather
 * than freeze, the entity continues along its last known velocity — the
 * `P = P_last + V * dt` extrapolation from the spec. This is capped by
 * `maxExtrapolationMs`, because unbounded extrapolation sends avatars sliding
 * through walls; past the cap the entity holds still and waits.
 */
import { Transform, createSystem } from '@iwsdk/core';
import { Networked, NetworkedTransform } from '../components/index.js';
import { clamp, lerpVec3, slerpQuat } from '../math/interpolation.js';

export class NetworkInterpolationSystem extends createSystem(
  {
    remote: { required: [Networked, NetworkedTransform, Transform] },
  },
  {},
) {
  override update(_delta: number, _time: number): void {
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    for (const entity of this.queries.remote.entities) {
      // The owner is authoritative over its own entity; never interpolate it,
      // or client-side prediction would be fighting the network buffer.
      if (entity.getValue(Networked, 'isLocalOwner')) continue;
      if (!entity.getValue(NetworkedTransform, 'hasSnapshot')) continue;

      const previousTime = entity.getValue(NetworkedTransform, 'previousTime') ?? 0;
      const targetTime = entity.getValue(NetworkedTransform, 'targetTime') ?? 0;
      const delay = entity.getValue(NetworkedTransform, 'interpolationDelayMs') ?? 100;

      const position = entity.getVectorView(Transform, 'position');
      const orientation = entity.getVectorView(Transform, 'orientation');
      const previousPosition = entity.getVectorView(
        NetworkedTransform,
        'previousPosition',
      );
      const targetPosition = entity.getVectorView(NetworkedTransform, 'targetPosition');
      const previousOrientation = entity.getVectorView(
        NetworkedTransform,
        'previousOrientation',
      );
      const targetOrientation = entity.getVectorView(
        NetworkedTransform,
        'targetOrientation',
      );

      const renderTime = now - delay;
      const span = targetTime - previousTime;

      if (renderTime <= targetTime) {
        // Interpolating between two known samples: the healthy case.
        const alpha = span > 0 ? clamp((renderTime - previousTime) / span, 0, 1) : 1;
        lerpVec3(position, previousPosition, targetPosition, alpha);
        slerpQuat(orientation, previousOrientation, targetOrientation, alpha);
        continue;
      }

      // Starved: extrapolate along the last known velocity, up to the cap.
      const maxExtrapolation =
        entity.getValue(NetworkedTransform, 'maxExtrapolationMs') ?? 250;
      const overshootMs = clamp(renderTime - targetTime, 0, maxExtrapolation);
      const overshootSeconds = overshootMs / 1000;
      const velocity = entity.getVectorView(NetworkedTransform, 'velocity');

      position[0] = (targetPosition[0] as number) + (velocity[0] as number) * overshootSeconds;
      position[1] = (targetPosition[1] as number) + (velocity[1] as number) * overshootSeconds;
      position[2] = (targetPosition[2] as number) + (velocity[2] as number) * overshootSeconds;

      // Rotation is held rather than extrapolated. Angular dead reckoning
      // amplifies error quickly and a slightly stale head orientation reads far
      // better than one that keeps spinning past where the player stopped.
      orientation[0] = targetOrientation[0] as number;
      orientation[1] = targetOrientation[1] as number;
      orientation[2] = targetOrientation[2] as number;
      orientation[3] = targetOrientation[3] as number;
    }
  }
}
