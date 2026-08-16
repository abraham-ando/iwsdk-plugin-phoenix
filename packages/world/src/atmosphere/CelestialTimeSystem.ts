import { createSystem } from '@iwsdk/core';
import { CelestialTime, SkyModel } from './components';
import { solarPosition, declinationForDayOfYear } from './solar';

/**
 * Astronomy only: turns the simulation's clock into a sun position.
 * No Three.js here — that is what makes the sun's arc unit-testable.
 */
export class CelestialTimeSystem extends createSystem({
  clocks: { required: [CelestialTime, SkyModel] },
}) {
  public override update(_delta: number, _time: number): void {
    for (const entity of this.queries.clocks.entities) {
      const hour = entity.getValue(CelestialTime, 'hour') ?? 12;
      const latitude = entity.getValue(CelestialTime, 'latitudeDeg') ?? 45;
      const dayOfYear = entity.getValue(CelestialTime, 'dayOfYear') ?? 172;

      const { elevationDeg, azimuthDeg } = solarPosition(
        hour,
        latitude,
        declinationForDayOfYear(dayOfYear),
      );

      const previousElevation = entity.getValue(SkyModel, 'sunElevationDeg') ?? 0;
      const previousAzimuth = entity.getValue(SkyModel, 'sunAzimuthDeg') ?? 0;
      if (
        Math.abs(previousElevation - elevationDeg) > 1e-4 ||
        Math.abs(previousAzimuth - azimuthDeg) > 1e-4
      ) {
        entity.setValue(SkyModel, 'sunElevationDeg', elevationDeg);
        entity.setValue(SkyModel, 'sunAzimuthDeg', azimuthDeg);
        entity.setValue(SkyModel, '_needsUpdate', true);
      }
    }
  }
}
