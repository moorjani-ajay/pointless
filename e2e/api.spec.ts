import { expect, test } from '@playwright/test';

// Engine-independent HTTP checks: they hit the server's JSON/MCP endpoints
// directly (no browser), so the `api` project in playwright.config.ts runs
// them once rather than once per browser engine.

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
