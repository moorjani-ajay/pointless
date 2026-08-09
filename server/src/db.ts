import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Presentation, PresentationSummary } from '@pointless/shared';

let _pool: Pool | null = null;

// The pool is created lazily on first use so that DATABASE_URL can be set just
// before the store is exercised (the server sets it from the environment; tests
// point it at a throwaway Postgres). endPool() resets it so it re-opens later.
function pool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is required (e.g. postgres://user:pass@host:5432/pointless). ' +
          'Run a Postgres container (see docker-compose.yml) or point at a hosted instance.'
      );
    }
    const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    _pool = new Pool({ connectionString, ssl });
  }
  return _pool;
}

/** Create the schema if it does not exist. Call once on startup before serving. */
export async function init(): Promise<void> {
  await pool().query(`
    CREATE TABLE IF NOT EXISTS decks (
      id            text PRIMARY KEY,
      title         text NOT NULL,
      html          text NOT NULL DEFAULT '',
      share_token   text NOT NULL UNIQUE,
      published     boolean NOT NULL DEFAULT false,
      password_hash text,
      owner         text,
      created_at    text NOT NULL,
      updated_at    text NOT NULL
    );

    -- SSO/OIDC users. Identity is keyed by (issuer, subject); email/name are
    -- refreshed on each login. Role is NOT stored — it is derived at request
    -- time from OIDC_ADMIN_EMAILS (see config.ts), so changing admins needs no
    -- migration.
    CREATE TABLE IF NOT EXISTS users (
      id          text PRIMARY KEY,
      idp_iss     text NOT NULL,
      idp_sub     text NOT NULL,
      email       text,
      name        text,
      created_at  text NOT NULL,
      UNIQUE (idp_iss, idp_sub)
    );

    -- Short-lived handoff state for an in-flight upstream-IdP login (the
    -- "Layer B" PKCE round-trip). Shared by UI login (intent='ui') and the MCP
    -- authorization-server flow (intent='mcp', which also stashes the MCP
    -- client's original request so /auth/callback can resume it).
    CREATE TABLE IF NOT EXISTS oauth_login_state (
      state          text PRIMARY KEY,
      intent         text NOT NULL,
      pkce_verifier  text NOT NULL,
      mcp_client_id  text,
      redirect_uri   text,
      code_challenge text,
      scopes         text,
      client_state   text,
      resource       text,
      created_at     text NOT NULL
    );

    -- Dynamically-registered MCP OAuth clients (RFC 7591). The full client
    -- information document is stored as JSON.
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id  text PRIMARY KEY,
      metadata   jsonb NOT NULL,
      created_at text NOT NULL
    );

    -- Authorization codes we issue to MCP clients after the user authenticates
    -- upstream. One-time use, ~60s TTL. code_challenge is the "Layer A" PKCE
    -- challenge the SDK verifies at the token endpoint.
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code           text PRIMARY KEY,
      client_id      text NOT NULL,
      user_id        text NOT NULL,
      redirect_uri   text NOT NULL,
      code_challenge text NOT NULL,
      scopes         text NOT NULL,
      resource       text,
      expires_at     bigint NOT NULL
    );

    -- Access/refresh tokens we mint for the MCP endpoint. Stored as SHA-256
    -- hashes only (never the raw token), bound to a user and to the MCP
    -- resource (audience).
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash   text PRIMARY KEY,
      kind         text NOT NULL,
      client_id    text NOT NULL,
      user_id      text NOT NULL,
      scopes       text NOT NULL,
      audience     text NOT NULL,
      refresh_hash text,
      expires_at   bigint NOT NULL
    );

    CREATE INDEX IF NOT EXISTS decks_owner_idx ON decks (owner);
    CREATE INDEX IF NOT EXISTS oauth_tokens_refresh_idx ON oauth_tokens (refresh_hash);
  `);
}

/** Close the pool. Tests call this for clean teardown; it re-opens lazily. */
export async function endPool(): Promise<void> {
  if (_pool) {
    const p = _pool;
    _pool = null;
    await p.end();
  }
}

const newId = () => randomBytes(6).toString('base64url');
const newShareToken = () => randomBytes(16).toString('base64url');
const now = () => new Date().toISOString();

interface DeckRow {
  id: string;
  title: string;
  html: string;
  share_token: string;
  published: boolean;
  password_hash: string | null;
  owner: string | null;
  created_at: string;
  updated_at: string;
}

function toSummary(row: DeckRow): PresentationSummary {
  return {
    id: row.id,
    title: row.title,
    published: row.published,
    protected: row.password_hash != null,
    shareToken: row.share_token,
    htmlSize: Buffer.byteLength(row.html, 'utf8'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const toFull = (row: DeckRow): Presentation => ({ ...toSummary(row), html: row.html });

export async function createPresentation(
  title: string,
  owner?: string | null
): Promise<Presentation> {
  const id = newId();
  const ts = now();
  await pool().query(
    'INSERT INTO decks (id, title, share_token, published, owner, created_at, updated_at) VALUES ($1, $2, $3, false, $4, $5, $6)',
    [id, title, newShareToken(), owner ?? null, ts, ts]
  );
  return (await getPresentation(id))!;
}

export async function getPresentation(id: string): Promise<Presentation | null> {
  const { rows } = await pool().query<DeckRow>('SELECT * FROM decks WHERE id = $1', [id]);
  return rows[0] ? toFull(rows[0]) : null;
}

export async function getPresentationByToken(token: string): Promise<Presentation | null> {
  const { rows } = await pool().query<DeckRow>('SELECT * FROM decks WHERE share_token = $1', [
    token,
  ]);
  return rows[0] ? toFull(rows[0]) : null;
}

/**
 * List presentations. With `owner`, scope to that owner's decks (per-user
 * ownership when auth is on); without it, list everything (open mode and the
 * admin/operator view).
 */
export async function listPresentations(owner?: string): Promise<PresentationSummary[]> {
  const { rows } = owner
    ? await pool().query<DeckRow>('SELECT * FROM decks WHERE owner = $1 ORDER BY updated_at DESC', [
        owner,
      ])
    : await pool().query<DeckRow>('SELECT * FROM decks ORDER BY updated_at DESC');
  return rows.map(toSummary);
}

/**
 * Owner of a deck: a user id, `null` for an unowned (legacy/open-mode) deck, or
 * `undefined` when no such deck exists. Used to enforce per-user ownership
 * without leaking deck contents.
 */
export async function getDeckOwner(id: string): Promise<string | null | undefined> {
  const { rows } = await pool().query<{ owner: string | null }>(
    'SELECT owner FROM decks WHERE id = $1',
    [id]
  );
  return rows.length ? rows[0].owner : undefined;
}

export async function setHtml(id: string, html: string, title?: string): Promise<boolean> {
  const { rows } = await pool().query<{ title: string }>('SELECT title FROM decks WHERE id = $1', [
    id,
  ]);
  if (!rows[0]) return false;
  await pool().query('UPDATE decks SET html = $1, title = $2, updated_at = $3 WHERE id = $4', [
    html,
    title ?? rows[0].title,
    now(),
    id,
  ]);
  return true;
}

export async function deletePresentation(id: string): Promise<boolean> {
  const res = await pool().query('DELETE FROM decks WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Publish a presentation. `passwordHash` semantics: undefined = leave
 * protection unchanged, null = remove protection, string = set it.
 */
export async function publishPresentation(
  id: string,
  passwordHash?: string | null
): Promise<Presentation | null> {
  if (passwordHash === undefined) {
    await pool().query('UPDATE decks SET published = true, updated_at = $1 WHERE id = $2', [
      now(),
      id,
    ]);
  } else {
    await pool().query(
      'UPDATE decks SET published = true, password_hash = $1, updated_at = $2 WHERE id = $3',
      [passwordHash, now(), id]
    );
  }
  return getPresentation(id);
}

export async function getPasswordHash(shareToken: string): Promise<string | null> {
  const { rows } = await pool().query<{ password_hash: string | null }>(
    'SELECT password_hash FROM decks WHERE share_token = $1',
    [shareToken]
  );
  return rows[0]?.password_hash ?? null;
}

// ---------- Users (SSO/OIDC) ----------

export interface AppUser {
  id: string;
  iss: string;
  sub: string;
  email: string | null;
  name: string | null;
}

interface UserRow {
  id: string;
  idp_iss: string;
  idp_sub: string;
  email: string | null;
  name: string | null;
  created_at: string;
}

const toUser = (row: UserRow): AppUser => ({
  id: row.id,
  iss: row.idp_iss,
  sub: row.idp_sub,
  email: row.email,
  name: row.name,
});

/**
 * Upsert a federated identity to a stable local user. Keyed by (issuer,
 * subject) — email can change and is never the key. Returns the existing row's
 * id on conflict (the generated id is only used on first sight).
 */
export async function upsertUser(idp: {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
}): Promise<AppUser> {
  const { rows } = await pool().query<UserRow>(
    `INSERT INTO users (id, idp_iss, idp_sub, email, name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (idp_iss, idp_sub)
       DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
     RETURNING *`,
    [randomUUID(), idp.iss, idp.sub, idp.email ?? null, idp.name ?? null, now()]
  );
  return toUser(rows[0]);
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const { rows } = await pool().query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

// ---------- OIDC login handoff state ----------

export interface LoginStateInput {
  state: string;
  intent: 'ui' | 'mcp';
  pkceVerifier: string;
  mcpClientId?: string | null;
  redirectUri?: string | null;
  codeChallenge?: string | null;
  scopes?: string | null;
  clientState?: string | null;
  resource?: string | null;
}

export interface LoginStateRow {
  state: string;
  intent: string;
  pkce_verifier: string;
  mcp_client_id: string | null;
  redirect_uri: string | null;
  code_challenge: string | null;
  scopes: string | null;
  client_state: string | null;
  resource: string | null;
  created_at: string;
}

export async function insertLoginState(s: LoginStateInput): Promise<void> {
  await pool().query(
    `INSERT INTO oauth_login_state
       (state, intent, pkce_verifier, mcp_client_id, redirect_uri, code_challenge, scopes, client_state, resource, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      s.state,
      s.intent,
      s.pkceVerifier,
      s.mcpClientId ?? null,
      s.redirectUri ?? null,
      s.codeChallenge ?? null,
      s.scopes ?? null,
      s.clientState ?? null,
      s.resource ?? null,
      now(),
    ]
  );
}

/** Atomically fetch-and-delete a login-state row (one-time use). */
export async function takeLoginState(state: string): Promise<LoginStateRow | null> {
  const { rows } = await pool().query<LoginStateRow>(
    'DELETE FROM oauth_login_state WHERE state = $1 RETURNING *',
    [state]
  );
  return rows[0] ?? null;
}

// ---------- OAuth: registered clients (DCR) ----------

/** Persist a dynamically-registered client. `metadata` is the full client info doc. */
export async function insertOAuthClient(clientId: string, metadata: unknown): Promise<void> {
  await pool().query(
    'INSERT INTO oauth_clients (client_id, metadata, created_at) VALUES ($1, $2, $3)',
    [clientId, JSON.stringify(metadata), now()]
  );
}

/** Returns the stored client info document (parsed JSON), or null. */
export async function getOAuthClient(clientId: string): Promise<unknown | null> {
  const { rows } = await pool().query<{ metadata: unknown }>(
    'SELECT metadata FROM oauth_clients WHERE client_id = $1',
    [clientId]
  );
  return rows[0]?.metadata ?? null;
}

/** Number of registered clients — used to cap open dynamic registration. */
export async function countOAuthClients(): Promise<number> {
  const { rows } = await pool().query<{ n: string }>(
    'SELECT COUNT(*)::int AS n FROM oauth_clients'
  );
  return Number(rows[0]?.n ?? 0);
}

// ---------- OAuth: authorization codes ----------

export interface OAuthCodeInput {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string;
  resource?: string | null;
  expiresAt: number;
}

export interface OAuthCodeRow {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string;
  resource: string | null;
  expires_at: string; // pg returns bigint as string
}

export async function insertOAuthCode(c: OAuthCodeInput): Promise<void> {
  await pool().query(
    `INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, scopes, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      c.code,
      c.clientId,
      c.userId,
      c.redirectUri,
      c.codeChallenge,
      c.scopes,
      c.resource ?? null,
      c.expiresAt,
    ]
  );
}

/** Read a code without consuming it (used to fetch the PKCE challenge). */
export async function getOAuthCode(code: string): Promise<OAuthCodeRow | null> {
  const { rows } = await pool().query<OAuthCodeRow>('SELECT * FROM oauth_codes WHERE code = $1', [
    code,
  ]);
  return rows[0] ?? null;
}

/**
 * Atomically fetch-and-delete an authorization code (one-time use). The DELETE …
 * RETURNING is a single statement, so concurrent `/token` requests with the same
 * code can never both succeed — only one gets the row.
 */
export async function takeOAuthCode(code: string): Promise<OAuthCodeRow | null> {
  const { rows } = await pool().query<OAuthCodeRow>(
    'DELETE FROM oauth_codes WHERE code = $1 RETURNING *',
    [code]
  );
  return rows[0] ?? null;
}

// ---------- OAuth: access/refresh tokens (stored hashed) ----------

export interface OAuthTokenInput {
  tokenHash: string;
  kind: 'access' | 'refresh';
  clientId: string;
  userId: string;
  scopes: string;
  audience: string;
  refreshHash?: string | null;
  expiresAt: number;
}

export interface OAuthTokenRow {
  token_hash: string;
  kind: 'access' | 'refresh';
  client_id: string;
  user_id: string;
  scopes: string;
  audience: string;
  refresh_hash: string | null;
  expires_at: string; // pg returns bigint as string
}

export async function insertOAuthToken(t: OAuthTokenInput): Promise<void> {
  await pool().query(
    `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scopes, audience, refresh_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      t.tokenHash,
      t.kind,
      t.clientId,
      t.userId,
      t.scopes,
      t.audience,
      t.refreshHash ?? null,
      t.expiresAt,
    ]
  );
}

export async function getOAuthToken(tokenHash: string): Promise<OAuthTokenRow | null> {
  const { rows } = await pool().query<OAuthTokenRow>(
    'SELECT * FROM oauth_tokens WHERE token_hash = $1',
    [tokenHash]
  );
  return rows[0] ?? null;
}

/**
 * Atomically fetch-and-delete a token of a given kind (one-time use). Used for
 * refresh-token rotation so two concurrent refreshes can't both mint a pair from
 * the same token — only the request that wins the DELETE gets the row.
 */
export async function takeOAuthToken(
  tokenHash: string,
  kind: 'access' | 'refresh'
): Promise<OAuthTokenRow | null> {
  const { rows } = await pool().query<OAuthTokenRow>(
    'DELETE FROM oauth_tokens WHERE token_hash = $1 AND kind = $2 RETURNING *',
    [tokenHash, kind]
  );
  return rows[0] ?? null;
}

export async function deleteOAuthToken(tokenHash: string): Promise<void> {
  await pool().query('DELETE FROM oauth_tokens WHERE token_hash = $1', [tokenHash]);
}

/** Drop the access tokens minted alongside a given refresh token (rotation/revoke). */
export async function deleteAccessTokensForRefresh(refreshHash: string): Promise<void> {
  await pool().query('DELETE FROM oauth_tokens WHERE refresh_hash = $1', [refreshHash]);
}
