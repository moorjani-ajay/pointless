import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import * as store from '../src/db';
import {
  OIDC_TXN_COOKIE,
  SESSION_COOKIE,
  signOidcTxn,
  signSession,
  verifySession,
} from '../src/auth/session';
import { resetOidcConfigCache } from '../src/auth/federation';
import { startMockOidc, type MockOidc } from './helpers/mockOidc';

const DOC = '<!doctype html><html><body>Hi</body></html>';

let idp: MockOidc;
const savedEnv: Record<string, string | undefined> = {};

// Run the whole file in oidc mode against the mock IdP. Env is set for the file
// and restored in afterAll so it never leaks into other (open-mode) suites.
beforeAll(async () => {
  idp = await startMockOidc();
  const env: Record<string, string> = {
    AUTH_MODE: 'oidc',
    BASE_URL: 'http://localhost:3000',
    SESSION_SECRET: 'test-session-secret-please-change',
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: idp.clientId,
    OIDC_CLIENT_SECRET: idp.clientSecret,
  };
  for (const [k, v] of Object.entries(env)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  resetOidcConfigCache();
});

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await idp.close();
});

// Isolate decks between cases (users accrue but are keyed by iss/sub, and tests
// use distinct subjects, so they don't collide).
beforeEach(async () => {
  for (const p of await store.listPresentations()) await store.deletePresentation(p.id);
});

/** Build a Cookie header carrying a signed session for `userId`. */
const cookieFor = (userId: string) => `${SESSION_COOKIE}=${signSession(userId)}`;

/** Collapse a response's Set-Cookie header(s) into a Cookie request header value. */
const cookiesFrom = (res: { headers: Record<string, unknown> }): string =>
  ((res.headers['set-cookie'] as string[] | undefined) ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');

describe('session token', () => {
  it('round-trips a signed session', () => {
    const token = signSession('user-xyz');
    expect(verifySession(token)).toBe('user-xyz');
  });

  it('rejects a tampered payload', () => {
    const token = signSession('user-xyz');
    const [v, , sig] = token.split('.'); // keep the original signature, swap the payload
    const forged = Buffer.from(JSON.stringify({ uid: 'attacker', exp: 9999999999 })).toString(
      'base64url'
    );
    expect(verifySession(`${v}.${forged}.${sig}`)).toBeNull();
  });

  it('rejects an expired session', () => {
    expect(verifySession(signSession('user-xyz', -1))).toBeNull();
  });

  it('rejects junk', () => {
    expect(verifySession('not-a-token')).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });
});

describe('config: allowlist + roles', () => {
  afterEach(() => {
    delete process.env.OIDC_ALLOWED_DOMAINS;
    delete process.env.OIDC_ADMIN_EMAILS;
  });

  it('allows any email when no domain allowlist is set', async () => {
    const { isEmailAllowed } = await import('../src/config');
    expect(isEmailAllowed('anyone@anywhere.test')).toBe(true);
  });

  it('enforces the domain allowlist when set', async () => {
    process.env.OIDC_ALLOWED_DOMAINS = 'example.com, corp.test';
    const { isEmailAllowed } = await import('../src/config');
    expect(isEmailAllowed('a@example.com')).toBe(true);
    expect(isEmailAllowed('b@corp.test')).toBe(true);
    expect(isEmailAllowed('c@evil.test')).toBe(false);
    expect(isEmailAllowed(undefined)).toBe(false);
  });

  it('derives the admin role from OIDC_ADMIN_EMAILS', async () => {
    process.env.OIDC_ADMIN_EMAILS = 'Boss@Example.com';
    const { roleForEmail } = await import('../src/config');
    expect(roleForEmail('boss@example.com')).toBe('admin'); // case-insensitive
    expect(roleForEmail('peon@example.com')).toBe('user');
    expect(roleForEmail(undefined)).toBe('user');
  });
});

describe('operator surface (oidc)', () => {
  it('401s the dashboard without a session', async () => {
    expect((await request(createApp()).get('/api/decks')).status).toBe(401);
  });

  it('scopes the deck list to the signed-in user', async () => {
    const a = await store.upsertUser({ iss: idp.issuer, sub: 'op-a', email: 'a@example.com' });
    const b = await store.upsertUser({ iss: idp.issuer, sub: 'op-b', email: 'b@example.com' });
    await store.createPresentation('A deck', a.id);
    await store.createPresentation('B deck', b.id);
    const app = createApp();

    const listA = await request(app).get('/api/decks').set('Cookie', cookieFor(a.id));
    expect(listA.status).toBe(200);
    expect(listA.body.map((d: { title: string }) => d.title)).toEqual(['A deck']);

    const listB = await request(app).get('/api/decks').set('Cookie', cookieFor(b.id));
    expect(listB.body.map((d: { title: string }) => d.title)).toEqual(['B deck']);
  });

  it("forbids access to another user's deck (404, no existence leak)", async () => {
    const a = await store.upsertUser({ iss: idp.issuer, sub: 'own-a', email: 'a@example.com' });
    const b = await store.upsertUser({ iss: idp.issuer, sub: 'own-b', email: 'b@example.com' });
    const deck = await store.createPresentation('A secret', a.id);
    await store.setHtml(deck.id, DOC);
    const app = createApp();

    expect(
      (await request(app).get(`/api/decks/${deck.id}`).set('Cookie', cookieFor(b.id))).status
    ).toBe(404);
    expect(
      (await request(app).get(`/raw/deck/${deck.id}`).set('Cookie', cookieFor(b.id))).status
    ).toBe(404);
    expect(
      (await request(app).delete(`/api/decks/${deck.id}`).set('Cookie', cookieFor(b.id))).status
    ).toBe(404);
    // owner still has access
    expect(
      (await request(app).get(`/api/decks/${deck.id}`).set('Cookie', cookieFor(a.id))).status
    ).toBe(200);
  });

  it('lets an admin see and manage every deck', async () => {
    process.env.OIDC_ADMIN_EMAILS = 'admin@example.com';
    try {
      const a = await store.upsertUser({ iss: idp.issuer, sub: 'adm-a', email: 'a@example.com' });
      const admin = await store.upsertUser({
        iss: idp.issuer,
        sub: 'adm-x',
        email: 'admin@example.com',
      });
      const deck = await store.createPresentation('A deck', a.id);
      const app = createApp();

      const list = await request(app).get('/api/decks').set('Cookie', cookieFor(admin.id));
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(
        (await request(app).get(`/api/decks/${deck.id}`).set('Cookie', cookieFor(admin.id))).status
      ).toBe(200);
    } finally {
      delete process.env.OIDC_ADMIN_EMAILS;
    }
  });

  it('honours ADMIN_TOKEN as a break-glass admin path', async () => {
    process.env.ADMIN_TOKEN = 'break-glass';
    try {
      const a = await store.upsertUser({ iss: idp.issuer, sub: 'bg-a', email: 'a@example.com' });
      await store.createPresentation('A deck', a.id);
      const app = createApp();
      const res = await request(app).get('/api/decks').set('Authorization', 'Bearer break-glass');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1); // sees all decks
    } finally {
      delete process.env.ADMIN_TOKEN;
    }
  });

  it('fails fast when oidc mode is misconfigured', () => {
    const saved = process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_ID;
    try {
      expect(() => createApp()).toThrow(/OIDC_CLIENT_ID/);
    } finally {
      process.env.OIDC_CLIENT_ID = saved;
    }
  });
});

describe('/auth/me', () => {
  it('returns null without a session', async () => {
    const res = await request(createApp()).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('returns the user (and derived role) with a valid session', async () => {
    process.env.OIDC_ADMIN_EMAILS = 'a@example.com';
    try {
      const a = await store.upsertUser({
        iss: idp.issuer,
        sub: 'me-a',
        email: 'a@example.com',
        name: 'Ada',
      });
      const res = await request(createApp()).get('/auth/me').set('Cookie', cookieFor(a.id));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ email: 'a@example.com', name: 'Ada', role: 'admin' });
    } finally {
      delete process.env.OIDC_ADMIN_EMAILS;
    }
  });
});

describe('federation (mock IdP)', () => {
  it('redirects /auth/login to the IdP with PKCE + state', async () => {
    const res = await request(createApp()).get('/auth/login');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(`${loc.origin}${loc.pathname}`).toBe(`${idp.issuer}/authorize`);
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
  });

  it('completes the callback, mints a session, and resolves the user', async () => {
    idp.setUser({ sub: 'fed-1', email: 'fed@example.com', name: 'Fed User' });
    const app = createApp();

    const login = await request(app).get('/auth/login');
    const state = new URL(login.headers.location).searchParams.get('state')!;

    const cb = await request(app)
      .get(`/auth/callback?code=mock-code&state=${state}`)
      .set('Cookie', cookiesFrom(login)); // carry the txn cookie back, as a browser would
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/');
    const setCookie = cb.headers['set-cookie'] as unknown as string[];
    expect(setCookie.join(';')).toContain(SESSION_COOKIE);

    const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    const me = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('fed@example.com');
  });

  it('rejects an unknown/replayed state', async () => {
    // Present a validly-bound txn cookie so we get past the browser-binding
    // check and exercise the unknown-login-state path itself.
    const res = await request(createApp())
      .get('/auth/callback?code=x&state=never-issued')
      .set('Cookie', `${OIDC_TXN_COOKIE}=${signOidcTxn('never-issued')}`);
    expect(res.status).toBe(400);
  });

  it('rejects a callback not bound to this browser (login CSRF / code injection)', async () => {
    idp.setUser({ sub: 'csrf-1', email: 'csrf@example.com', name: 'CSRF' });
    const app = createApp();
    const login = await request(app).get('/auth/login');
    const state = new URL(login.headers.location).searchParams.get('state')!;
    // A different browser completes the flow — no txn cookie forwarded.
    const cb = await request(app).get(`/auth/callback?code=mock-code&state=${state}`);
    expect(cb.status).toBe(400);
    // A forged txn cookie for the same state is rejected too (HMAC-signed).
    const forged = await request(app)
      .get(`/auth/callback?code=mock-code&state=${state}`)
      .set(
        'Cookie',
        `${OIDC_TXN_COOKIE}=v1.${Buffer.from(JSON.stringify({ st: state, exp: 9999999999 })).toString('base64url')}.deadbeef`
      );
    expect(forged.status).toBe(400);
  });

  it('refuses a disallowed email domain', async () => {
    process.env.OIDC_ALLOWED_DOMAINS = 'example.com';
    try {
      idp.setUser({ sub: 'fed-2', email: 'intruder@evil.test', name: 'Intruder' });
      const app = createApp();
      const login = await request(app).get('/auth/login');
      const state = new URL(login.headers.location).searchParams.get('state')!;
      const cb = await request(app)
        .get(`/auth/callback?code=mock-code&state=${state}`)
        .set('Cookie', cookiesFrom(login));
      expect(cb.status).toBe(403);
    } finally {
      delete process.env.OIDC_ALLOWED_DOMAINS;
    }
  });
});
