import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

Given('the demo app is running', async () => {
  // No-op: Playwright's `webServer` config already started and health-checked it.
});

When('I open the home page', async ({ page }) => {
  await page.goto('/');
});

Then('the page title is not empty', async ({ page }) => {
  await expect(page).toHaveTitle(/.+/);
});
