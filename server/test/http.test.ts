import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, DOC_CSP } from '../src/app';
import * as store from '../src/db';
import { hashPassword, viewKey } from '../src/auth';

const app = createApp();
const DOC = '<!doctype html><html><body>Hello</body></html>';

beforeEach(() => {
  for (const p of store.listPresentations()) store.deletePresentation(p.id);
});

/** Seed a published, password-protected deck and return the pieces a viewer needs. */
function seedProtectedDeck(password = 'open-sesame') {
  const p = store.createPresentation('Protected');
  store.setHtml(p.id, DOC);
  store.publishPresentation(p.id, hashPassword(password));
  const hash = store.getPasswordHash(p.shareToken)!;
  return { ...p, password, key: viewKey(hash, p.shareToken) };
}

describe('hardening', () => {
  it('does not advertise Express via x-powered-by', async () => {
    const res = await request(app).get('/api/decks');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects non-POST on /mcp with a JSON-RPC 405', async () => {
    const res = await request(app).get('/mcp');
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe(-32000);
  });
});

describe('REST: decks', () => {
  it('lists decks (empty to start)', async () => {
    const res = await request(app).get('/api/decks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns deck metadata without the html body', async () => {
    const p = store.createPresentation('Meta');
    store.setHtml(p.id, DOC);
    const res = await request(app).get(`/api/decks/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(p.id);
    expect(res.body.html).toBeUndefined();
    expect(res.body.htmlSize).toBe(Buffer.byteLength(DOC, 'utf8'));
  });

  it('404s an unknown deck', async () => {
    const res = await request(app).get('/api/decks/nope');
    expect(res.status).toBe(404);
  });

  it('deletes a deck (204) and 404s a second delete', async () => {
    const p = store.createPresentation('Doomed');
    expect((await request(app).delete(`/api/decks/${p.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/decks/${p.id}`)).status).toBe(404);
  });
});

describe('raw documents are always CSP-sandboxed', () => {
  it('serves /raw/deck/:id with the sandbox CSP header', async () => {
    const p = store.createPresentation('Raw');
    store.setHtml(p.id, DOC);
    const res = await request(app).get(`/raw/deck/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(DOC_CSP);
    expect(res.text).toBe(DOC);
  });

  it('404s a raw deck that does not exist', async () => {
    expect((await request(app).get('/raw/deck/missing')).status).toBe(404);
  });
});

describe('password gate for shared decks', () => {
  it('blocks the metadata endpoint without a valid key', async () => {
    const deck = seedProtectedDeck();
    const res = await request(app).get(`/api/shared/${deck.shareToken}`);
    expect(res.status).toBe(401);
    expect(res.body.protected).toBe(true);
  });

  it('rejects a wrong password at unlock', async () => {
    const deck = seedProtectedDeck();
    const res = await request(app)
      .post(`/api/shared/${deck.shareToken}/unlock`)
      .send({ password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('hands back a view key for the right password, which then unlocks the deck', async () => {
    const deck = seedProtectedDeck();
    const unlock = await request(app)
      .post(`/api/shared/${deck.shareToken}/unlock`)
      .send({ password: deck.password });
    expect(unlock.status).toBe(200);
    expect(unlock.body.key).toBe(deck.key);

    const view = await request(app).get(`/api/shared/${deck.shareToken}?k=${unlock.body.key}`);
    expect(view.status).toBe(200);
    expect(view.body.shareToken).toBe(deck.shareToken);

    const raw = await request(app).get(`/raw/${deck.shareToken}?k=${unlock.body.key}`);
    expect(raw.status).toBe(200);
    expect(raw.headers['content-security-policy']).toBe(DOC_CSP);
  });

  it('rejects the raw document with a forged/absent key', async () => {
    const deck = seedProtectedDeck();
    expect((await request(app).get(`/raw/${deck.shareToken}`)).status).toBe(401);
    expect((await request(app).get(`/raw/${deck.shareToken}?k=forged`)).status).toBe(401);
  });

  it('404s shared access to an unpublished or unknown deck', async () => {
    const draft = store.createPresentation('Draft');
    store.setHtml(draft.id, DOC); // created but never published
    expect((await request(app).get(`/api/shared/${draft.shareToken}`)).status).toBe(404);
    expect((await request(app).get('/api/shared/unknown-token')).status).toBe(404);
  });
});

describe('unprotected published decks', () => {
  it('unlock returns a null key and the deck is viewable directly', async () => {
    const p = store.createPresentation('Open');
    store.setHtml(p.id, DOC);
    store.publishPresentation(p.id, null);

    const unlock = await request(app).post(`/api/shared/${p.shareToken}/unlock`).send({});
    expect(unlock.status).toBe(200);
    expect(unlock.body.key).toBeNull();

    const view = await request(app).get(`/api/shared/${p.shareToken}`);
    expect(view.status).toBe(200);
  });
});
