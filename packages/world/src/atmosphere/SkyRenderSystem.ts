import { Types, createSystem, DomeGradient, IBLGradient } from '@iwsdk/core';
import { CelestialTime, SkyModel, WEATHER_KINDS } from './components';
import { skyAppearance } from './skyColors';

/** Sun elevation change (degrees) required to justify a new IBL bake. */
export const IBL_REFRESH_ELEVATION_DEG = 1;

/**
 * Applies the sky model to IWSDK's native environment primitives (spec §4):
 * DomeGradient for the background dome, IBLGradient for image-based lighting.
 *
 * IBL regeneration produces a PMREM and is expensive — it is throttled to
 * meaningful sun movement. The dome is nearly free and follows continuously;
 * the eye never notices the difference.
 */
export class SkyRenderSystem extends createSystem(
  {
    skies: { required: [SkyModel, DomeGradient] },
  },
  {
    quality: { type: Types.String, default: 'low' },
  },
) {
  public iblRefreshCount = 0;
  private lastIblElevation = Number.NEGATIVE_INFINITY;

  public override update(_delta: number, _time: number): void {
    for (const entity of this.queries.skies.entities) {
      if (entity.getValue(SkyModel, '_needsUpdate') !== true) continue;

      const elevation = entity.getValue(SkyModel, 'sunElevationDeg') ?? 0;
      const turbidity = entity.getValue(SkyModel, 'turbidity') ?? 2.5;
      const weatherIndex = entity.hasComponent(CelestialTime)
        ? (entity.getValue(CelestialTime, 'weather') ?? 0)
        : 0;
      const weather = WEATHER_KINDS[weatherIndex] ?? 'clear';

      const appearance = skyAppearance(elevation, { turbidity, weather });

      const dome = entity.getVectorView(DomeGradient, 'sky');
      dome[0] = appearance.sky[0];
      dome[1] = appearance.sky[1];
      dome[2] = appearance.sky[2];
      const domeEquator = entity.getVectorView(DomeGradient, 'equator');
      domeEquator[0] = appearance.equator[0];
      domeEquator[1] = appearance.equator[1];
      domeEquator[2] = appearance.equator[2];
      const domeGround = entity.getVectorView(DomeGradient, 'ground');
      domeGround[0] = appearance.ground[0];
      domeGround[1] = appearance.ground[1];
      domeGround[2] = appearance.ground[2];
      entity.setValue(DomeGradient, 'intensity', appearance.domeIntensity);
      entity.setValue(DomeGradient, '_needsUpdate', true);

      entity.setValue(SkyModel, 'exposure', appearance.exposure);

      // Expensive: only rebake the environment when the sun really moved.
      if (
        entity.hasComponent(IBLGradient) &&
        Math.abs(elevation - this.lastIblElevation) >= IBL_REFRESH_ELEVATION_DEG
      ) {
        this.lastIblElevation = elevation;
        this.iblRefreshCount++;
        const iblSky = entity.getVectorView(IBLGradient, 'sky');
        iblSky[0] = appearance.sky[0];
        iblSky[1] = appearance.sky[1];
        iblSky[2] = appearance.sky[2];
        const iblEquator = entity.getVectorView(IBLGradient, 'equator');
        iblEquator[0] = appearance.equator[0];
        iblEquator[1] = appearance.equator[1];
        iblEquator[2] = appearance.equator[2];
        const iblGround = entity.getVectorView(IBLGradient, 'ground');
        iblGround[0] = appearance.ground[0];
        iblGround[1] = appearance.ground[1];
        iblGround[2] = appearance.ground[2];
        entity.setValue(IBLGradient, 'intensity', appearance.ambientIntensity);
        entity.setValue(IBLGradient, '_needsUpdate', true);
      }

      entity.setValue(SkyModel, '_needsUpdate', false);
    }
  }
}
