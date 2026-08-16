import { createSystem } from '@iwsdk/core';
import { SkyModel } from './components';

/**
 * Ties renderer exposure to the sky (spec §5). This is what makes dusk
 * darken the WHOLE scene coherently instead of only tinting the dome.
 */
export class ExposureSystem extends createSystem({
  skies: { required: [SkyModel] },
}) {
  public lastExposure = 1;

  public override update(_delta: number, _time: number): void {
    const renderer = (this.world as unknown as { renderer?: { toneMappingExposure?: number } })
      .renderer;
    for (const entity of this.queries.skies.entities) {
      const exposure = entity.getValue(SkyModel, 'exposure') ?? 1;
      this.lastExposure = exposure;
      if (renderer !== undefined) renderer.toneMappingExposure = exposure;
    }
  }
}
