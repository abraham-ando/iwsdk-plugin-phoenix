/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Playwright half of the in-scene bridge (TS-C1).
 *
 * `features/README.md` splits steps into two kinds: DOM steps, ordinary
 * Playwright against page chrome, and in-scene steps — anything that lives
 * inside the WebXR canvas, which is one opaque element to Playwright and
 * cannot be driven with `page.click()`. `apps/demo/src/test-bridge.ts` is the
 * application half: it installs `window.__IWSDK_TEST_BRIDGE__` (dev builds
 * only — see that file's module docs) and this module is the Node-side
 * client for it, exposed to `.steps.ts` files as the `scene` fixture.
 *
 * Contract this file must keep, per
 * `backlog/technical-story/TS-C1.pont-steps-in-scene-bdd.md`:
 *
 *   - `scene.clickEntity(name): Promise<void>`
 *   - `scene.readComponent(name, component): Promise<Record<string, unknown> | null>`
 *   - `scene.waitFor(entityName, componentName, predicate, options?): Promise<Record<string, unknown> | null>`
 *
 * A simulated click never raycasts. Playwright can only click DOM pixels; it
 * has no way to aim a WebXR ray at a mesh through a canvas. The application
 * side reproduces the ECS tags a real ray hit already leaves behind
 * (`Hovered` then `Pressed`, `InputSystem`'s own pointerdown/pointerup
 * sequence) instead, so every system that reacts to those tags is exercised
 * faithfully without this bridge inventing a second, test-only notion of
 * "clicked". See `test-bridge.ts` for the full rationale.
 *
 * `waitFor` polls from Node, not `page.waitForFunction`: the latter would
 * require serializing `predicate` into the browser, which breaks the moment
 * a caller closes over anything non-trivial. Polling `readComponent` in a
 * plain Node loop keeps `predicate` an ordinary Node function.
 */
import type { Page } from '@playwright/test';
import { test as base } from 'playwright-bdd';

// Type-only import: no runtime edge, no bundling cost, but it means the two
// bridge halves cannot silently drift apart the way a hand-duplicated
// interface could — `tsc` fails here the moment `test-bridge.ts`'s shape
// changes, instead of the mismatch only surfacing inside a running scenario.
import type { IwsdkTestBridge } from '../../apps/demo/src/test-bridge.js';

declare global {
  interface Window {
    __IWSDK_TEST_BRIDGE__?: IwsdkTestBridge;
  }
}

const BRIDGE_MISSING_MESSAGE =
  "le pont de test IWSDK n'est pas installé — la démo tourne-t-elle en mode dev ?";

/** Options for {@link SceneBridge.waitFor}. */
export interface WaitForOptions {
  /** Give up and throw after this many milliseconds. @defaultValue 5000 */
  timeoutMs?: number;
  /** Delay between polls, in milliseconds. @defaultValue 100 */
  intervalMs?: number;
}

/** Node-side client for the in-scene test bridge, one instance per test page. */
export class SceneBridge {
  constructor(private readonly page: Page) {}

  /**
   * Simulate a ray click on the named entity.
   *
   * Throws (in Node, via the rejected `page.evaluate` promise) when the
   * bridge is not installed on `window`, or when the bridge itself doesn't
   * know an entity by that name — see `test-bridge.ts`'s `clickEntity`.
   */
  async clickEntity(name: string): Promise<void> {
    await this.page.evaluate(
      ({ name, message }) => {
        const bridge = window.__IWSDK_TEST_BRIDGE__;
        if (!bridge) throw new Error(message);
        bridge.clickEntity(name);
      },
      { name, message: BRIDGE_MISSING_MESSAGE },
    );
  }

  /**
   * Read one component off the named entity, serialized to a plain object.
   *
   * Resolves `null` when the entity or the component doesn't exist (a
   * genuine "not present" outcome distinct from the bridge being missing,
   * which throws instead — see {@link clickEntity}).
   */
  async readComponent(
    name: string,
    component: string,
  ): Promise<Record<string, unknown> | null> {
    return this.page.evaluate(
      ({ name, component, message }) => {
        const bridge = window.__IWSDK_TEST_BRIDGE__;
        if (!bridge) throw new Error(message);
        return bridge.readComponent(name, component);
      },
      { name, component, message: BRIDGE_MISSING_MESSAGE },
    );
  }

  /**
   * Poll `readComponent(entityName, componentName)` from Node until
   * `predicate` accepts the value, then resolve with that value. Throws a
   * timeout error — including the last observed value, for a useful failure
   * message — after `options.timeoutMs` (default 5000ms) with no match.
   */
  async waitFor(
    entityName: string,
    componentName: string,
    predicate: (value: Record<string, unknown> | null) => boolean,
    options: WaitForOptions = {},
  ): Promise<Record<string, unknown> | null> {
    const timeoutMs = options.timeoutMs ?? 5000;
    const intervalMs = options.intervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const value = await this.readComponent(entityName, componentName);
      if (predicate(value)) return value;
      if (Date.now() >= deadline) {
        throw new Error(
          `[in-scene] waitFor("${entityName}", "${componentName}") timed out after ` +
            `${timeoutMs}ms — last value: ${JSON.stringify(value)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/**
 * Playwright `test`, extended with the in-scene fixtures. Import this
 * instead of `@playwright/test`'s `test` from any `.steps.ts` that uses
 * `scene` — and pass it to `createBdd()` so `Given`/`When`/`Then` see the
 * same fixtures.
 */
export const test = base.extend<{
  /** Node-side client for `window.__IWSDK_TEST_BRIDGE__` on this test's page. */
  scene: SceneBridge;
  /**
   * A fresh, mutable bag per test for steps to pass results between each
   * other (a When reads a component and stashes it, a Then asserts on it),
   * without falling back to module-level variables shared across scenarios.
   */
  sceneState: Record<string, unknown>;
}>({
  scene: async ({ page }, use) => {
    await use(new SceneBridge(page));
  },
  sceneState: async ({}, use) => {
    await use({});
  },
});
