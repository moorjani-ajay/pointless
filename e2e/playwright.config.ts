import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end smoke against the *built* artifact: builds every package, boots
 * the real server (which serves the built SPA), and drives it over HTTP.
 * Deck authoring happens over MCP (via Claude), not the web UI, so these cover
 * the surfaces a human actually touches — across three engines (Chromium,
 * Firefox, WebKit) and a mobile viewport, so responsive and engine-specific
 * rendering breakage is caught, not just desktop Chrome.
 */
export default defineConfig({
  testDir: HERE,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    // Engine-independent HTTP checks (api.spec.ts) run once, with no browser.
    { name: 'api', testMatch: /api\.spec\.ts/ },
    // Browser-rendering specs run across every engine and viewport; they skip
    // the HTTP-only spec so it isn't re-run per engine.
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] }, testIgnore: /api\.spec\.ts/ },
    {
      name: 'Desktop Firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /api\.spec\.ts/,
    },
    { name: 'Desktop Safari', use: { ...devices['Desktop Safari'] }, testIgnore: /api\.spec\.ts/ },
    { name: 'Mobile Safari', use: { ...devices['iPhone 13'] }, testIgnore: /api\.spec\.ts/ },
  ],
  webServer: {
    command: 'pnpm -w build && pnpm -w start',
    cwd: path.resolve(HERE, '..'),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://pointless:pointless@127.0.0.1:5432/pointless',
    },
  },
});
