import { expect, test } from '@playwright/test';
import { mcpCall, mcpListTools, seedDeck } from './helpers';

// Authoring is the product's primary surface: decks are created by an LLM over
// MCP, not the web UI. These drive the *live* Streamable-HTTP endpoint (the unit
// tests use an in-memory transport), so they also cover the Express ↔ transport
// wiring and the REST views that the resulting deck must show up in.
test.describe('MCP authoring over HTTP', () => {
  test('exposes the documented tool surface', async ({ request }) => {
    const names = (await mcpListTools(request)).sort();
    expect(names).toEqual(
      [
        'create_presentation',
        'get_design_guide',
        'get_presentation',
        'list_presentations',
        'publish',
        'set_html',
      ].sort()
    );
  });

  test('create → set_html → publish round-trips into a share link and the REST API', async ({
    request,
  }) => {
    const deck = await seedDeck(request, { publish: true });
    expect(deck.shareToken, 'publish returned no share token').toBeTruthy();

    // The authored deck surfaces through the operator listing...
    const list = await request.get('/api/decks');
    expect(list.ok()).toBeTruthy();
    const ids = (await list.json()).map((d: { id: string }) => d.id);
    expect(ids).toContain(deck.id);

    // ...and its metadata comes back without the (large, untrusted) html body.
    const meta = await request.get(`/api/decks/${deck.id}`);
    expect(meta.ok()).toBeTruthy();
    const body = await meta.json();
    expect(body.title).toBe(deck.title);
    expect(body.published).toBe(true);
    expect(body.html).toBeUndefined();
    expect(body.htmlSize).toBeGreaterThan(0);

    // The stored document is served — always under the sandbox CSP.
    const raw = await request.get(`/raw/deck/${deck.id}`);
    expect(raw.ok()).toBeTruthy();
    expect(raw.headers()['content-security-policy']).toContain('sandbox');
    expect(await raw.text()).toContain(deck.marker);
  });

  test('set_html rejects content that is not a full HTML document', async ({ request }) => {
    const created = await mcpCall<{ presentation_id: string }>(request, 'create_presentation', {
      title: 'Fragment',
    });
    const id = created.data.presentation_id;
    const set = await mcpCall(request, 'set_html', {
      presentation_id: id,
      html: '<div>just a fragment</div>',
    });
    expect(set.isError).toBe(true);
    expect(set.text).toMatch(/complete HTML document/i);
  });
});
