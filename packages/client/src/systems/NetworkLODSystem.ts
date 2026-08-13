/**
 * Distance-based send-rate throttling for entities this client owns.
 *
 * ## Scope, honestly stated
 *
 * True level-of-detail is a *per-viewer* decision: how often peer A needs
 * updates about entity E depends on the distance between them, which only the
 * server knows. That filtering lives in `IwsdkPhoenix.SpatialGrid` /
 * `IwsdkPhoenix.AoI` on the Elixir side, where the position of every observer
 * is available.
 *
 * What the client *can* decide is how often it is worth publishing its own
 * objects at all. For a prop the local player has carried far away from the
 * action, or in a relayed room where the local player is a good proxy for where
 * attention is, dropping from 30 Hz to 5 Hz costs nothing perceptible and saves
 * real bandwidth. That, and only that, is what this system does.
 *
 * The local player's own avatar is deliberately exempt: it is by definition at
 * distance zero from the local camera, and other peers care about it most.
 */
import { Transform, Types, createSystem } from '@iwsdk/core';
import { Networked } from '../components/index.js';
import { distanceSquared } from '../math/interpolation.js';

export class NetworkLODSystem extends createSystem(
  {
    owned: { required: [Networked, Transform] },
  },
  {
    /** Publish rate inside {@link nearDistance}. */
    nearRateHz: { type: Types.Float32, default: 30 },
    /** Publish rate between {@link nearDistance} and {@link farDistance}. */
    midRateHz: { type: Types.Float32, default: 15 },
    /** Publish rate beyond {@link farDistance}. */
    farRateHz: { type: Types.Float32, default: 5 },
    /** Metres below which {@link nearRateHz} applies. */
    nearDistance: { type: Types.Float32, default: 10 },
    /** Metres beyond which {@link farRateHz} applies. */
    farDistance: { type: Types.Float32, default: 30 },
    /** Reference point for distance, updated from the camera each tick. */
    viewerPosition: { type: Types.Vec3, default: [0, 0, 0] },
  },
) {
  /** Scratch viewer position, avoids allocating per tick. */
  private readonly viewer = new Float32Array(3);

  override update(_delta: number, _time: number): void {
    this.readViewerPosition();

    const nearSquared = this.config.nearDistance.value ** 2;
    const farSquared = this.config.farDistance.value ** 2;

    for (const entity of this.queries.owned.entities) {
      if (!entity.getValue(Networked, 'isLocalOwner')) continue;

      const position = entity.getVectorView(Transform, 'position');
      const distance = distanceSquared(position, this.viewer);

      const rate =
        distance <= nearSquared
          ? this.config.nearRateHz.value
          : distance <= farSquared
            ? this.config.midRateHz.value
            : this.config.farRateHz.value;

      entity.setValue(Networked, 'sendRateHz', rate);
    }
  }

  /**
   * Track the local camera when one exists, otherwise fall back to the
   * configured reference point so the system stays usable headless.
   */
  private readViewerPosition(): void {
    const camera = (this.world as { camera?: { position?: { x: number; y: number; z: number } } })
      .camera;

    if (camera?.position) {
      this.viewer[0] = camera.position.x;
      this.viewer[1] = camera.position.y;
      this.viewer[2] = camera.position.z;
      return;
    }

    const configured = this.config.viewerPosition.value as [number, number, number];
    this.viewer[0] = configured[0];
    this.viewer[1] = configured[1];
    this.viewer[2] = configured[2];
  }
}
