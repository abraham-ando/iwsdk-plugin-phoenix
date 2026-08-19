/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Steps for `in-scene-bridge.feature` (TS-C1), proving the in-scene bridge
 * (`apps/demo/src/test-bridge.ts` + `features/support/in-scene.ts`) end to
 * end: reading a component off a named entity, and simulating a ray click.
 *
 * Imports `test` from `../support/in-scene.js` — not `@playwright/test` — so
 * `createBdd` sees the `scene`/`sceneState` fixtures. The one DOM step in
 * this file (`Given`) is legitimate: waiting for the page and the async
 * world/bridge to be ready is page chrome, not an in-scene action.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { test } from '../support/in-scene.js';

const { Given, When, Then } = createBdd(test);

Given('la démo chargée et le monde initialisé', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__IWSDK_TEST_BRIDGE__);
});

When(
  "je lis le composant {string} de l'entité {string}",
  async ({ scene, sceneState }, composant: string, entite: string) => {
    sceneState.lastRead = await scene.readComponent(entite, composant);
  },
);

Then(
  'la lecture renvoie une position à trois composantes finies',
  async ({ sceneState }) => {
    const value = sceneState.lastRead as Record<string, unknown> | null;
    expect(value).not.toBeNull();

    const position = value?.['position'];
    expect(Array.isArray(position)).toBe(true);
    expect((position as unknown[]).length).toBe(3);
    for (const component of position as unknown[]) {
      expect(typeof component).toBe('number');
      expect(Number.isFinite(component as number)).toBe(true);
    }
  },
);

When(
  "je clique l'entité {string} au rayon simulé",
  async ({ scene, sceneState }, entite: string) => {
    await scene.clickEntity(entite);
    sceneState.clickedEntity = entite;
  },
);

Then(
  "un événement d'interaction est enregistré sur cette entité",
  async ({ scene, sceneState }) => {
    const entite = sceneState.clickedEntity as string;

    const value = await scene.waitFor(
      entite,
      'InteractionLog',
      (value) =>
        Array.isArray((value as { events?: unknown[] } | null)?.events) &&
        ((value as { events: unknown[] }).events.length > 0),
    );

    const events = (value as { events: Array<{ type: string; at: number }> }).events;
    expect(events.some((event) => event.type === 'click')).toBe(true);
  },
);
