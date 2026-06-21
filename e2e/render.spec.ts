import { expect, test } from '@playwright/test';
import { seedDeck } from './helpers';

// The deck viewer is the one rich surface humans actually look at, so it runs
// across every engine and viewport. Documents render inside a sandboxed iframe;
// Playwright reaches into it over the browser protocol, which the sandbox does
// not block. Each test seeds its own deck (unique title + #marker) so the
// parallel matrix never collides.

test('a published deck renders its document in the operator preview and the share link', async ({
  page,
  request,
}) => {
  const deck = await seedDeck(request, { publish: true });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Operator preview by id.
  await page.goto(`/deck/${deck.id}`);
  await expect(page).toHaveTitle(deck.title); // Viewer sets document.title from the deck meta.
  await expect(page.frameLocator('iframe.doc-frame').locator(`#${deck.marker}`)).toBeVisible();
  // Not the "no content" / "not found" fallbacks.
  await expect(page.locator('.viewer-message')).toHaveCount(0);

  // The public share link renders the same document.
  await page.goto(`/d/${deck.shareToken}`);
  await expect(page.frameLocator('iframe.doc-frame').locator(`#${deck.marker}`)).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('the landing lists a freshly authored deck', async ({ page, request }) => {
  const deck = await seedDeck(request);
  await page.goto('/');
  await expect(page.getByRole('link', { name: `Open ${deck.title}` })).toBeVisible();
});
