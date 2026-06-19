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

test('REST API is served and healthy', async ({ request }) => {
  const res = await request.get('/api/decks');
  expect(res.ok()).toBe(true);
  expect(Array.isArray(await res.json())).toBe(true);
});

test('MCP endpoint is wired and rejects GET', async ({ request }) => {
  const res = await request.get('/mcp');
  expect(res.status()).toBe(405);
  expect((await res.json()).error.code).toBe(-32000);
});
