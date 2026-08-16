import { createSystem } from '@iwsdk/core';
import { WaterSurface } from './components';
import { SkyModel } from '../atmosphere/components';

/** Au-delà, on considère que l'image a sauté plutôt que ralenti. */
const MAX_DELTA = 0.1;

/**
 * Anime la nappe (spec §7).
 *
 * Le seul travail par image est d'avancer une uniforme de temps et d'accorder
 * la couleur réfléchie au ciel du moment : une eau qui reste bleu ciel à
 * minuit trahit toute la scène. La géométrie, elle, est construite une fois.
 */
export class WaterSystem extends createSystem({
  surfaces: { required: [WaterSurface] },
  sky: { required: [SkyModel] },
}) {
  public elapsed = 0;

  public override update(delta: number, _time: number): void {
    // Un onglet réveillé après une minute enverrait un delta géant, et l'eau
    // sauterait d'un coup au lieu de couler.
    this.elapsed += Math.min(delta, MAX_DELTA);

    let skyTint = 1;
    for (const entity of this.queries.sky.entities) {
      skyTint = entity.getValue(SkyModel, 'exposure') ?? 1;
      break;
    }

    for (const entity of this.queries.surfaces.entities) {
      const object = (entity as unknown as { object3D?: { material?: unknown } }).object3D;
      const material = object?.material as
        | { uniforms?: Record<string, { value: unknown }> }
        | undefined;
      const uniforms = material?.uniforms;
      if (uniforms === undefined) continue;

      const time = uniforms.uTime;
      if (time !== undefined) time.value = this.elapsed;

      // La couleur du ciel réfléchi suit l'exposition : au crépuscule, l'eau
      // s'assombrit avec le reste du monde.
      const sky = uniforms.uSkyColor?.value as
        | { setRGB: (r: number, g: number, b: number) => void }
        | undefined;
      if (sky !== undefined) sky.setRGB(0.53 * skyTint, 0.71 * skyTint, 0.87 * skyTint);
    }
  }
}
