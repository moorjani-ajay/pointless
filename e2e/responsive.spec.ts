import { expect, test } from '@playwright/test';

// Runs against every project in playwright.config.ts — Chromium, Firefox and
// WebKit on desktop, plus a mobile WebKit viewport. These assert the landing
// renders cleanly across engines and screen sizes, catching the failure modes
// a single desktop-Chrome smoke misses: horizontal overflow on small screens,
// blank/failed mounts, and engine-specific JS errors.

/** Document content width must not exceed the viewport (allow 1px rounding). */
async function horizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

test('landing renders with no errors, overflow, or blank content', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/', { waitUntil: 'networkidle' });

  // Mounted and titled.
  await expect(page).toHaveTitle(/Pointless/);
  await expect(page.locator('#root')).not.toBeEmpty();

  // Actually painted real content (not a blank or broken render).
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length, 'landing rendered no visible text').toBeGreaterThan(50);

  // The most common responsive bug: content wider than the screen.
  const { scrollWidth, innerWidth } = await horizontalOverflow(page);
  expect(
    scrollWidth,
    `horizontal overflow: content ${scrollWidth}px > viewport ${innerWidth}px`
  ).toBeLessThanOrEqual(innerWidth + 1);

  // No uncaught exceptions during load (engine-specific breakage surfaces here).
  expect(pageErrors, pageErrors.join('\n')).toHaveLength(0);
});

test('client-side deep link renders the SPA shell without overflow', async ({ page }) => {
  await page.goto('/deck/does-not-exist', { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle(/Pointless/);
  const { scrollWidth, innerWidth } = await horizontalOverflow(page);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
});
