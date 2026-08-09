import { expect, test } from '@playwright/test';

// Engine-independent HTTP checks: these drive the server over `request`, not a
// browser, so they're identical across rendering engines. The config runs them
// once under the dedicated `api` project rather than 4× across the matrix.

test('REST API is served and healthy', async ({ request }) => {
  const res = await request.get('/api/decks');
  expect(res.ok()).toBe(true);
  expect(Array.isArray(await res.json())).toBe(true);
});

test('GET /api/decks/:id 404s an unknown deck with an error body', async ({ request }) => {
  const res = await request.get('/api/decks/does-not-exist');
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toBeTruthy();
});

test('MCP endpoint is wired and rejects GET', async ({ request }) => {
  const res = await request.get('/mcp');
  expect(res.status()).toBe(405);
  expect((await res.json()).error.code).toBe(-32000);
});
