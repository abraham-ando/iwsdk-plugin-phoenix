import { createSystem } from '@iwsdk/core';
import { SkyModel, StarField } from './components';
import { skyAppearance } from './skyColors';

/** Star opacity follows the sun below the horizon. */
export class StarFieldSystem extends createSystem({
  fields: { required: [StarField, SkyModel] },
}) {
  public override update(_delta: number, _time: number): void {
    for (const entity of this.queries.fields.entities) {
      const elevation = entity.getValue(SkyModel, 'sunElevationDeg') ?? 0;
      const { starOpacity } = skyAppearance(elevation);
      entity.setValue(StarField, 'opacity', starOpacity);
    }
  }
}
