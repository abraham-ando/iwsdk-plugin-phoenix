import { Types, createSystem } from '@iwsdk/core';
import { ProceduralMaterial } from './components';
import { MATERIAL_DEFINITIONS, type MaterialId } from './definitions';
import type { MaterialLibrary } from './MaterialLibrary';

/** Applies shared library materials to entities that ask for one. */
export class MaterialSystem extends createSystem(
  {
    surfaces: { required: [ProceduralMaterial] },
  },
  {
    library: { type: Types.Object, default: null },
  },
) {
  public appliedCount = 0;

  public override update(_delta: number, _time: number): void {
    const library = this.config.library.value as MaterialLibrary | null;
    if (library === null) return;

    for (const entity of this.queries.surfaces.entities) {
      if (entity.getValue(ProceduralMaterial, '_needsUpdate') !== true) continue;
      entity.setValue(ProceduralMaterial, '_needsUpdate', false);

      const id = entity.getValue(ProceduralMaterial, 'materialId') as MaterialId | undefined;
      // An unknown id is a content mistake, not a crash: leave the mesh alone.
      if (id === undefined || !(id in MATERIAL_DEFINITIONS)) continue;

      const target = (entity as unknown as { object3D?: { material?: unknown } }).object3D;
      if (target === undefined) continue;
      target.material = library.get(id);
      this.appliedCount++;
    }
  }
}
