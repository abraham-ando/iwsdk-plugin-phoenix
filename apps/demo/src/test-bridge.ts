/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The application half of the in-scene Playwright bridge (TS-C1).
 *
 * `features/README.md` splits Playwright steps into two kinds: DOM steps,
 * ordinary Playwright against page chrome, and in-scene steps — anything
 * that lives inside the WebXR canvas, which Playwright otherwise sees as one
 * opaque element it cannot click into. This module is the application side
 * of the bridge that makes in-scene steps possible: it installs
 * `window.__IWSDK_TEST_BRIDGE__`, a tiny surface that
 * `features/support/in-scene.ts` drives from Node via `page.evaluate`.
 *
 * A simulated click manipulates the ECS directly — adding `Hovered`, then
 * `Pressed`, then removing `Pressed` — the exact tag sequence `InputSystem`
 * applies to a real ray hit on pointerdown/pointerup. That is deliberate:
 * Playwright can click DOM pixels, not aim a WebXR ray through a canvas at a
 * mesh, so there is no way to *produce* a real hit from a test. Reproducing
 * the tags a real hit already leaves behind exercises every system that
 * reacts to `Hovered`/`Pressed` faithfully, without teaching those systems a
 * second, test-only notion of "clicked".
 *
 * Dev-only by construction, not by convention: `index.ts` calls
 * `installTestBridge` behind `if (import.meta.env.DEV)`, a condition Vite
 * resolves at build time, so a production build dead-code-eliminates this
 * entire module rather than merely leaving it unused.
 */
import {
  BoxGeometry,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  Pressed,
  RayInteractable,
  Transform,
  type AnyComponent,
  type Entity,
  type World,
} from '@iwsdk/core';

/** Name of the synthetic entity `installTestBridge` seeds for scenarios to click. */
const SHARED_PLANT_NAME = 'plante partagée';

/**
 * Component classes `readComponent` knows how to serialize by name.
 *
 * Extend this map — never add a bespoke branch in `readComponent` — when a
 * future scenario needs to read a component this bridge does not carry yet.
 * `Transform` has real schema fields; `RayInteractable`/`Hovered`/`Pressed`
 * are tags (empty schema), handled by the same generic loop since an empty
 * schema simply produces `{}`.
 */
const COMPONENT_REGISTRY: Record<string, AnyComponent> = {
  Transform,
  RayInteractable,
  Hovered,
  Pressed,
};

/** The vector-valued elics field types, which must be read via `getVectorView`. */
const VECTOR_TYPES = new Set(['Vec2', 'Vec3', 'Vec4', 'Color']);

/**
 * `elics`'s `Types.Entity` field type. `entity.getValue` resolves it to a
 * live `Entity | null` — a class instance, not a plain value, and not
 * something `page.evaluate()` can serialize back to Node. `readComponent`
 * must never return one raw; see its `Types.Entity` branch below.
 */
const ENTITY_TYPE = 'Entity';

/** One synthetic bridge entity's recorded interactions, oldest first. */
interface InteractionEvent {
  type: string;
  at: number;
}

/**
 * State a bridge instance owns. Held in a closure rather than module-level
 * variables so a page that reinstalls the bridge (unlikely today, but this
 * keeps the door open for hot-reload / multi-world tests) does not leak the
 * previous instance's entities into the new one.
 */
interface BridgeState {
  /** Named entities scenarios can address — the shared plant today, more later. */
  entities: Map<string, Entity>;
  /** Interaction log per entity name, independent of the ECS — see module docs. */
  interactions: Map<string, InteractionEvent[]>;
}

/** The bridge surface installed on `window`. See `features/support/in-scene.ts`. */
export interface IwsdkTestBridge {
  clickEntity(name: string): void;
  readComponent(name: string, componentName: string): Record<string, unknown> | null;
}

declare global {
  interface Window {
    __IWSDK_TEST_BRIDGE__?: IwsdkTestBridge;
  }
}

/**
 * Create the synthetic "plante partagée" test entity and register it under
 * its name.
 *
 * Synthetic on purpose: the real shared plant
 * (`apps/demo/src/multiplayer.ts`'s `SHARED_PLANT_ID`) is scene-authored and,
 * today, not actually present in `public/scenes/main.iwsdk.scene.json` — see
 * this task's brief. This entity is unrelated to that multiplayer feature; it
 * exists only so in-scene scenarios have something named and clickable to
 * assert against. Geometry is a small primitive box: nothing here is ever
 * raycast for real (see module docs), so there is no reason to pay for a
 * heavier mesh.
 */
function createSharedPlantEntity(world: World, state: BridgeState): void {
  const object3D = new Mesh(
    new BoxGeometry(0.3, 0.3, 0.3),
    new MeshBasicMaterial({ color: 0x2f8f4f }),
  );
  const entity = world.createTransformEntity(object3D);

  // Finite, non-zero, and off the player spawn point (the origin, unless the
  // scene authors `player.transform` — see apps/demo/CLAUDE.md) so the entity
  // never overlaps the player on load.
  const position = entity.getVectorView(Transform, 'position');
  position[0] = 3;
  position[1] = 1;
  position[2] = -3;

  // Semantically a ray-clickable object, even though `clickEntity` below
  // never raycasts against it — see module docs for why.
  entity.addComponent(RayInteractable);

  state.entities.set(SHARED_PLANT_NAME, entity);
}

/** Append one interaction event to `name`'s log, creating it on first use. */
function recordInteraction(state: BridgeState, name: string, type: string): void {
  const events = state.interactions.get(name);
  if (events) {
    events.push({ type, at: performance.now() });
  } else {
    state.interactions.set(name, [{ type, at: performance.now() }]);
  }
}

function findEntity(state: BridgeState, name: string): Entity {
  const entity = state.entities.get(name);
  if (!entity) {
    const known = [...state.entities.keys()].join(', ') || '(none)';
    throw new Error(
      `[test-bridge] no entity named "${name}" — known entities: ${known}`,
    );
  }
  return entity;
}

/**
 * Simulate a ray click on the named entity.
 *
 * Reproduces `InputSystem`'s `down()` then `up()`: add `Hovered` if absent,
 * add `Pressed` if absent, log the click, then remove `Pressed`. `Hovered` is
 * left on, matching a real pointer that is still logically over the target
 * after release.
 */
function clickEntity(state: BridgeState, name: string): void {
  const entity = findEntity(state, name);
  if (!entity.hasComponent(Hovered)) entity.addComponent(Hovered);
  if (!entity.hasComponent(Pressed)) entity.addComponent(Pressed);
  recordInteraction(state, name, 'click');
  entity.removeComponent(Pressed);
}

/**
 * Serialize one component on the named entity to a plain object, or `null`
 * when the entity, the component name, or the entity-component pairing
 * doesn't exist.
 *
 * `componentName === 'InteractionLog'` is a special case: it does not name an
 * ECS component at all, it names this bridge's in-memory interaction journal
 * (see module docs on why that journal is not an ECS component). Every other
 * name is looked up in {@link COMPONENT_REGISTRY} and walked generically —
 * vector fields (`Vec2`/`Vec3`/`Vec4`/`Color`) via `getVectorView`, everything
 * else via `getValue` — so adding a new readable component never means
 * writing a new branch here.
 */
function readComponent(
  state: BridgeState,
  name: string,
  componentName: string,
): Record<string, unknown> | null {
  const entity = state.entities.get(name);
  if (!entity) return null;

  if (componentName === 'InteractionLog') {
    return { events: state.interactions.get(name) ?? [] };
  }

  const ComponentClass = COMPONENT_REGISTRY[componentName];
  if (!ComponentClass) return null;
  if (!entity.hasComponent(ComponentClass)) return null;

  const result: Record<string, unknown> = {};
  for (const field of Object.keys(ComponentClass.schema)) {
    const fieldType = ComponentClass.schema[field]!.type as string;
    if (VECTOR_TYPES.has(fieldType)) {
      // `field` is only known to be `keyof schema` at runtime, not narrowed to
      // elics's `VectorKeys<C>` — this loop is exactly the case that generic
      // constraint can't express statically.
      result[field] = Array.from(
        entity.getVectorView(ComponentClass, field as never),
      );
    } else if (fieldType === ENTITY_TYPE) {
      // Never hand a raw `Entity` instance back — `page.evaluate()` cannot
      // structured-clone it (class instance, back-references into the
      // World), and would fail with an opaque serialization error instead of
      // a useful one. Resolve to the referenced entity's bridge-registered
      // name when we know it, `null` otherwise (present but anonymous to
      // this bridge) — still enough for a scenario to assert "linked" vs
      // "not linked" without ever crossing a live entity over the wire.
      const referenced = entity.getValue(ComponentClass, field as never) as
        | Entity
        | null;
      result[field] = referenced ? nameOfEntity(state, referenced) : null;
    } else {
      result[field] = entity.getValue(ComponentClass, field as never);
    }
  }
  return result;
}

/** Reverse lookup: the bridge-registered name for `entity`, or `null` if none. */
function nameOfEntity(state: BridgeState, entity: Entity): string | null {
  for (const [name, candidate] of state.entities) {
    if (candidate === entity) return name;
  }
  return null;
}

/**
 * Install the in-scene test bridge on `window`. Call once, from `index.ts`,
 * guarded by `if (import.meta.env.DEV)` — see module docs.
 */
export function installTestBridge(world: World): void {
  const state: BridgeState = {
    entities: new Map(),
    interactions: new Map(),
  };

  createSharedPlantEntity(world, state);

  window.__IWSDK_TEST_BRIDGE__ = {
    clickEntity: (name) => clickEntity(state, name),
    readComponent: (name, componentName) => readComponent(state, name, componentName),
  };
}
