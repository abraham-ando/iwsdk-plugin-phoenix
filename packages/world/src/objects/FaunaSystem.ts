import { createSystem } from '@iwsdk/core';
import { AnimalVisual } from './components';

/**
 * Projette dans la scène toute vue d'animal exposée par le moteur (spec §8).
 *
 * Ce système ne connaît AUCUNE espèce, et c'est délibéré : la spec borne son
 * périmètre à l'interface de projection. Les troupeaux que l'écologie
 * fournira s'afficheront sans qu'une ligne change ici.
 */
interface Placeable {
  position?: { set: (x: number, y: number, z: number) => void };
  rotation?: { set: (x: number, y: number, z: number) => void };
}

export class FaunaSystem extends createSystem({
  animals: { required: [AnimalVisual] },
}) {
  public projectedCount = 0;

  public override update(_delta: number, _time: number): void {
    this.projectedCount = 0;
    for (const entity of this.queries.animals.entities) {
      const object = (entity as unknown as { object3D?: Placeable }).object3D;
      if (object === undefined) continue;

      object.position?.set(
        entity.getValue(AnimalVisual, 'x') ?? 0,
        entity.getValue(AnimalVisual, 'y') ?? 0,
        entity.getValue(AnimalVisual, 'z') ?? 0,
      );
      object.rotation?.set(0, entity.getValue(AnimalVisual, 'heading') ?? 0, 0);
      this.projectedCount++;
    }
  }
}
