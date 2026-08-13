/**
 * Headless stand-in for `@iwsdk/core`, aliased in at test time only.
 *
 * `@iwsdk/core` pulls in Three.js, Havok WASM and `@pmndrs/uikit`, and its
 * `World` wants a renderer and a DOM container. None of that is needed to
 * exercise replication logic — but the *ECS* absolutely is, so this shim
 * re-exports the genuine `elics` runtime that IWSDK itself is built on rather
 * than faking it. Tests therefore run against real component storage, real
 * queries and real system scheduling.
 *
 * Note this aliasing applies to `vitest` only. `tsc` still typechecks `src`
 * against the real `@iwsdk/core`, so an API drift is still caught.
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

/**
 * Mirror of IWSDK's built-in `Transform` component.
 *
 * The field names, types and order are copied from
 * `@iwsdk/core/dist/transform/transform.d.ts`; if IWSDK changes them, the
 * `tsc` pass over `src` against the real package is what will catch it.
 */
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
