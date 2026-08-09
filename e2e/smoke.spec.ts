import { expect, test } from '@playwright/test';

test('landing app boots and renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Pointless/);
  // The SPA mounts into #root — once hydrated it is no longer empty.
  await expect(page.locator('#root')).not.toBeEmpty();
});

test('client-side routes fall back to the SPA shell', async ({ page }) => {
  const res = await page.goto('/deck/does-not-exist');
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/Pointless/);
});
