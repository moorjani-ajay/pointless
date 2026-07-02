import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { buildMcpServer } from '../src/mcp';
import * as store from '../src/db';
import { PgFederatedOAuthProvider } from '../src/auth/provider';
import { resetOidcConfigCache } from '../src/auth/federation';
import { sha256 } from '../src/auth/tokens';
import { startMockOidc, type MockOidc } from './helpers/mockOidc';

const DOC = '<!doctype html><html><head></head><body>Hi</body></html>';
const REDIRECT = 'http://localhost:9999/callback';
const BASE = 'http://localhost:3000';
const AUDIENCE = `${BASE}/mcp`;

let idp: MockOidc;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  idp = await startMockOidc();
  const env: Record<string, string> = {
    AUTH_MODE: 'oidc',
    MCP_REQUIRE_AUTH: 'true',
    BASE_URL: BASE,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
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

beforeEach(async () => {
  for (const p of await store.listPresentations()) await store.deletePresentation(p.id);
});

// ---------- MCP tool ownership (in-process) ----------

/** Drive the MCP tools in-process as `actor`, returning a tiny call helper. */
async function connectAs(actor?: string) {
  const server = buildMcpServer(BASE, actor);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = res.content.map((c) => c.text).join('');
    let json: Record<string, unknown> | undefined;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { text, json, isError: res.isError === true };
  };
  return { server, client, call };
}

describe('MCP tool ownership', () => {
  it('stamps the deck owner with the authenticated actor', async () => {
    const a = await store.upsertUser({ iss: idp.issuer, sub: 'tool-a', email: 'a@example.com' });
    const { call, client, server } = await connectAs(a.id);
    const created = await call('create_presentation', { title: 'Owned' });
    const id = created.json!.presentation_id as string;
    expect(await store.getDeckOwner(id)).toBe(a.id);
    await client.close();
    await server.close();
  });

  it('scopes list_presentations and hides other owners’ decks', async () => {
    const a = await store.upsertUser({ iss: idp.issuer, sub: 'tool-a2', email: 'a@example.com' });
    const b = await store.upsertUser({ iss: idp.issuer, sub: 'tool-b2', email: 'b@example.com' });
    const aDeck = await store.createPresentation('A deck', a.id);
    await store.createPresentation('B deck', b.id);

    const conn = await connectAs(b.id);
    const list = await conn.call('list_presentations');
    expect((list.json as unknown as { title: string }[]).map((d) => d.title)).toEqual(['B deck']);

    // B cannot read, edit, or publish A's deck — indistinguishable from absent.
    expect((await conn.call('get_presentation', { presentation_id: aDeck.id })).isError).toBe(true);
    const set = await conn.call('set_html', { presentation_id: aDeck.id, html: DOC });
    expect(set.isError).toBe(true);
    expect(set.text).toMatch(/No presentation/);
    await conn.client.close();
    await conn.server.close();
  });

  it('open mode (no actor) is unscoped', async () => {
    const a = await store.upsertUser({ iss: idp.issuer, sub: 'tool-a3', email: 'a@example.com' });
    await store.createPresentation('Owned', a.id);
    const conn = await connectAs(undefined);
    const list = await conn.call('list_presentations');
    expect((list.json as unknown as unknown[]).length).toBe(1);
    await conn.client.close();
    await conn.server.close();
  });
});

// ---------- OAuth provider unit tests ----------

describe('OAuth provider', () => {
  const provider = new PgFederatedOAuthProvider();

  async function registerAndCode(userId: string, scopes = 'mcp:tools') {
    const client = await provider.clientsStore.registerClient!({
      redirect_uris: [REDIRECT],
    } as never);
    const code = `pt_code_${randomBytes(8).toString('base64url')}`;
    await store.insertOAuthCode({
      code: sha256(code), // codes are stored hashed; the raw value is what the client presents
      clientId: client.client_id,
      userId,
      redirectUri: REDIRECT,
      codeChallenge: 'unused-here',
      scopes,
      expiresAt: Date.now() + 60_000,
    });
    return { client, code };
  }

  it('registers and retrieves a client (DCR)', async () => {
    const client = await provider.clientsStore.registerClient!({
      redirect_uris: [REDIRECT],
      client_name: 'My MCP',
    } as never);
    expect(client.client_id).toBeTruthy();
    const fetched = await provider.clientsStore.getClient(client.client_id);
    expect(fetched?.client_name).toBe('My MCP');
  });

  it('exchanges a code for tokens bound to the user and audience', async () => {
    const u = await store.upsertUser({ iss: idp.issuer, sub: 'prov-1', email: 'p@example.com' });
    const { client, code } = await registerAndCode(u.id);
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    expect(tokens.token_type).toBe('bearer');
    expect(tokens.access_token).toMatch(/^pt_at_/);

    const auth = await provider.verifyAccessToken(tokens.access_token);
    expect(auth.extra?.userId).toBe(u.id);
    expect(auth.resource?.toString()).toBe(AUDIENCE);
    // the code is single-use
    await expect(
      provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)
    ).rejects.toThrow();
  });

  it('rejects a token minted for a different audience', async () => {
    const u = await store.upsertUser({ iss: idp.issuer, sub: 'prov-2', email: 'p@example.com' });
    const raw = `pt_at_${randomBytes(8).toString('base64url')}`;
    await store.insertOAuthToken({
      tokenHash: sha256(raw),
      kind: 'access',
      clientId: 'c',
      userId: u.id,
      scopes: 'mcp:tools',
      audience: 'http://evil.example/mcp',
      expiresAt: Date.now() + 60_000,
    });
    await expect(provider.verifyAccessToken(raw)).rejects.toThrow(/audience/);
  });

  it('rejects an expired access token', async () => {
    const raw = `pt_at_${randomBytes(8).toString('base64url')}`;
    await store.insertOAuthToken({
      tokenHash: sha256(raw),
      kind: 'access',
      clientId: 'c',
      userId: 'u',
      scopes: '',
      audience: AUDIENCE,
      expiresAt: Date.now() - 1000,
    });
    await expect(provider.verifyAccessToken(raw)).rejects.toThrow(/expired/);
  });

  it('rotates refresh tokens and invalidates the old one', async () => {
    const u = await store.upsertUser({ iss: idp.issuer, sub: 'prov-3', email: 'p@example.com' });
    const { client, code } = await registerAndCode(u.id);
    const first = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);

    const rotated = await provider.exchangeRefreshToken(client, first.refresh_token!);
    expect(rotated.access_token).not.toBe(first.access_token);
    // old refresh + old access are now dead
    await expect(provider.exchangeRefreshToken(client, first.refresh_token!)).rejects.toThrow();
    await expect(provider.verifyAccessToken(first.access_token)).rejects.toThrow();
    // new access works
    expect((await provider.verifyAccessToken(rotated.access_token)).extra?.userId).toBe(u.id);
  });

  it('revokes a token', async () => {
    const u = await store.upsertUser({ iss: idp.issuer, sub: 'prov-4', email: 'p@example.com' });
    const { client, code } = await registerAndCode(u.id);
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    await provider.revokeToken(client, { token: tokens.access_token });
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow();
  });

  it('rejects DCR with a non-loopback http redirect_uri (H2)', async () => {
    await expect(
      provider.clientsStore.registerClient!({ redirect_uris: ['http://evil.example/cb'] } as never)
    ).rejects.toThrow();
    await expect(
      provider.clientsStore.registerClient!({
        redirect_uris: ['http://localhost:5173/cb'],
      } as never)
    ).resolves.toBeTruthy();
  });

  it("a client cannot revoke another client's token (M1, RFC 7009)", async () => {
    const u = await store.upsertUser({ iss: idp.issuer, sub: 'rev-x', email: 'p@example.com' });
    const { client: a, code } = await registerAndCode(u.id);
    const tokens = await provider.exchangeAuthorizationCode(a, code, undefined, REDIRECT);
    const b = await provider.clientsStore.registerClient!({ redirect_uris: [REDIRECT] } as never);
    await provider.revokeToken(b, { token: tokens.access_token }); // foreign client → no-op
    expect((await provider.verifyAccessToken(tokens.access_token)).extra?.userId).toBe(u.id);
  });

  it('rejects a refresh token bound to a different audience (L4)', async () => {
    const u = await store.upsertUser({ iss: idp.issuer, sub: 'aud-x', email: 'p@example.com' });
    const client = await provider.clientsStore.registerClient!({
      redirect_uris: [REDIRECT],
    } as never);
    const refresh = `pt_rt_${randomBytes(8).toString('base64url')}`;
    await store.insertOAuthToken({
      tokenHash: sha256(refresh),
      kind: 'refresh',
      clientId: client.client_id,
      userId: u.id,
      scopes: '',
      audience: 'http://old.example/mcp',
      expiresAt: Date.now() + 1_000_000,
    });
    await expect(provider.exchangeRefreshToken(client, refresh)).rejects.toThrow(/audience/);
  });

  it('rejects refresh for an offboarded (disallowed) user (L5)', async () => {
    process.env.OIDC_ALLOWED_DOMAINS = 'example.com';
    try {
      const u = await store.upsertUser({ iss: idp.issuer, sub: 'off-x', email: 'gone@other.test' });
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [REDIRECT],
      } as never);
      const refresh = `pt_rt_${randomBytes(8).toString('base64url')}`;
      await store.insertOAuthToken({
        tokenHash: sha256(refresh),
        kind: 'refresh',
        clientId: client.client_id,
        userId: u.id,
        scopes: '',
        audience: AUDIENCE,
        expiresAt: Date.now() + 1_000_000,
      });
      await expect(provider.exchangeRefreshToken(client, refresh)).rejects.toThrow(/permitted/);
    } finally {
      delete process.env.OIDC_ALLOWED_DOMAINS;
    }
  });

  it('two concurrent refreshes mint exactly one new pair (H1, atomic rotation)', async () => {
    const u = await store.upsertUser({ iss: idp.issuer, sub: 'race-x', email: 'p@example.com' });
    const { client, code } = await registerAndCode(u.id);
    const first = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    const results = await Promise.allSettled([
      provider.exchangeRefreshToken(client, first.refresh_token!),
      provider.exchangeRefreshToken(client, first.refresh_token!),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

// ---------- HTTP: discovery, challenge, end-to-end token flow ----------

describe('MCP OAuth over HTTP', () => {
  it('serves authorization-server metadata with PKCE S256', async () => {
    const res = await request(createApp()).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(String(res.body.issuer).replace(/\/$/, '')).toBe(BASE);
    expect(res.body.code_challenge_methods_supported).toContain('S256');
  });

  it('serves protected-resource metadata pointing at the AS', async () => {
    const res = await request(createApp()).get('/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    expect((res.body.authorization_servers as string[]).map((s) => s.replace(/\/$/, ''))).toContain(
      BASE
    );
    expect(String(res.body.resource)).toContain('/mcp');
  });

  it('challenges an unauthenticated /mcp with 401 + resource_metadata', async () => {
    const res = await request(createApp())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/);
  });

  it('runs register → authorize → callback → token → authenticated /mcp', async () => {
    const app = createApp();
    idp.setUser({ sub: 'e2e-1', email: 'e2e@example.com', name: 'E2E' });

    // 1) Dynamic client registration (public client, PKCE only).
    const reg = await request(app)
      .post('/register')
      .send({
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_name: 'E2E MCP',
      });
    expect(reg.status).toBe(201);
    const clientId = reg.body.client_id as string;

    // 2) Authorize (Layer-A PKCE) → redirect to the IdP.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authz = await request(app).get('/authorize').query({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'client-state',
      resource: AUDIENCE,
    });
    expect(authz.status).toBe(302);
    const upstreamState = new URL(authz.headers.location).searchParams.get('state')!;
    // authorize() bound this flow to the browser via a txn cookie; carry it back.
    const txnCookie = (authz.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');

    // 3) IdP callback → mint our code → redirect back to the MCP client.
    const cb = await request(app)
      .get(`/auth/callback?code=x&state=${upstreamState}`)
      .set('Cookie', txnCookie);
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.location);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('client-state');
    const code = back.searchParams.get('code')!;

    // 4) Exchange the code for tokens.
    const tok = await request(app).post('/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    });
    expect(tok.status).toBe(200);
    const accessToken = tok.body.access_token as string;
    expect(accessToken).toMatch(/^pt_at_/);

    // 5) The token authenticates /mcp (no 401); the wrong/no token does not.
    const ok = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '1' },
        },
      });
    expect(ok.status).not.toBe(401);

    // The minted token resolves to the federated user.
    const auth = await new PgFederatedOAuthProvider().verifyAccessToken(accessToken);
    expect(auth.extra?.userId).toBeTruthy();
    const user = await store.getUserById(auth.extra!.userId as string);
    expect(user?.email).toBe('e2e@example.com');
  });

  it('leaves /mcp open when MCP_REQUIRE_AUTH is false', async () => {
    process.env.MCP_REQUIRE_AUTH = 'false';
    try {
      const res = await request(createApp())
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 't', version: '1' },
          },
        });
      expect(res.status).not.toBe(401);
    } finally {
      process.env.MCP_REQUIRE_AUTH = 'true';
    }
  });
});

describe('config validation (hardening)', () => {
  it('rejects a non-https OIDC_ISSUER outside localhost (M2)', () => {
    const saved = process.env.OIDC_ISSUER;
    process.env.OIDC_ISSUER = 'http://keycloak.internal/realms/x';
    try {
      expect(() => createApp()).toThrow(/https/);
    } finally {
      process.env.OIDC_ISSUER = saved;
    }
  });

  it('rejects a short SESSION_SECRET (L11)', () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'too-short';
    try {
      expect(() => createApp()).toThrow(/SESSION_SECRET/);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });

  it('rejects a non-canonical MCP_REQUIRE_AUTH value (L12)', () => {
    const saved = process.env.MCP_REQUIRE_AUTH;
    process.env.MCP_REQUIRE_AUTH = '1';
    try {
      expect(() => createApp()).toThrow(/MCP_REQUIRE_AUTH/);
    } finally {
      process.env.MCP_REQUIRE_AUTH = saved;
    }
  });
});
