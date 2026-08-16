import { createSystem } from '@iwsdk/core';
import { SmartObjectVisual } from './components';

/**
 * Applique l'état visible d'un smart object (spec §9).
 *
 * Ce système ne construit AUCUNE géométrie : il montre les enfants nommés
 * `from<N>` dont l'étape est atteinte, met `fill` et `flame` à l'échelle. La
 * convention de nommage est le contrat avec le constructeur de scène — c'est
 * ce qui permet de faire évoluer l'un sans toucher l'autre.
 */
interface SceneChild {
  name?: string;
  visible?: boolean;
  scale?: { set: (x: number, y: number, z: number) => void };
}

export class SmartObjectVisualSystem extends createSystem({
  visuals: { required: [SmartObjectVisual] },
}) {
  public appliedCount = 0;

  public override update(_delta: number, _time: number): void {
    this.appliedCount = 0;
    for (const entity of this.queries.visuals.entities) {
      const object = (
        entity as unknown as { object3D?: { traverse?: (fn: (o: SceneChild) => void) => void } }
      ).object3D;
      if (object?.traverse === undefined) continue;

      const stage = Math.round(entity.getValue(SmartObjectVisual, 'stage') ?? 0);
      const fill = entity.getValue(SmartObjectVisual, 'fill') ?? 1;
      const flame = entity.getValue(SmartObjectVisual, 'flame') ?? 0;
      const lit = entity.getValue(SmartObjectVisual, 'lit') === true;

      object.traverse((child: SceneChild) => {
        const name = child.name;
        if (name === undefined || name === '') return;

        // `from<N>` : apparaît à l'étape N et ne disparaît plus. Une
        // construction est cumulative — les perches restent quand le toit
        // arrive.
        if (name.startsWith('from')) {
          const threshold = Number.parseInt(name.slice(4), 10);
          child.visible = Number.isFinite(threshold) && stage >= threshold;
          return;
        }
        if (name === 'fill') {
          child.visible = fill > 0.001;
          child.scale?.set(1, Math.max(0.001, fill), 1);
          return;
        }
        if (name === 'flame') {
          child.visible = lit && flame > 0.001;
          child.scale?.set(1, Math.max(0.001, flame), 1);
        }
      });

      this.appliedCount++;
    }
  }
}
