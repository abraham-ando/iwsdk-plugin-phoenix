/**
 * Headless stand-in for `@iwsdk/core`, aliased in at test time only.
 * Re-exports genuine `elics` ECS runtime.
 */
export {
  ComponentRegistry,
  Types,
  World,
  createComponent,
  createSystem,
  eq,
  ge,
  gt,
  isin,
  le,
  lt,
  ne,
  nin,
} from 'elics';
export type { AnyComponent, Entity } from 'elics';

import { Types, createComponent } from 'elics';

export const Transform = createComponent(
  'Transform',
  {
    position: { type: Types.Vec3, default: [0, 0, 0] },
    orientation: { type: Types.Vec4, default: [0, 0, 0, 1] },
    scale: { type: Types.Vec3, default: [1, 1, 1] },
    parent: { type: Types.Entity, default: null },
  },
  'Local transform',
);
