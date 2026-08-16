import { Types, createComponent } from '@iwsdk/core';

/**
 * Declares which library material an entity wears (spec §5). Making this a
 * component is the whole point of the ECS move: material choice becomes
 * queryable and authorable instead of buried in imperative mesh code.
 */
export const ProceduralMaterial = createComponent(
  'ProceduralMaterial',
  {
    materialId: { type: Types.String, default: 'rock' },
    tiling: { type: Types.Float32, default: 1 },
    _needsUpdate: { type: Types.Boolean, default: true },
  },
  'Procedural PBR material selected from the shared MaterialLibrary',
);
