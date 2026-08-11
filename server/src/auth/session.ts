import { createHmac, timingSafeEqual } from 'node:crypto';
import type express from 'express';
import { canonicalBaseUrl, sessionSecret } from '../config.js';

/**
 * UI sessions are a signed, stateless cookie — no session table. The cookie
 * carries the user id and an expiry, authenticated by an HMAC over the payload
 * with SESSION_SECRET. This matches the project's existing "derive a proof with
 * a server-side secret" approach (see `viewKey` in auth.ts) and avoids a store.
 *
 * Trade-off: there is no server-side revocation list — logout clears the cookie,
 * and rotating SESSION_SECRET invalidates every outstanding session at once.
 */

export const SESSION_COOKIE = 'pointless_session';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Short-lived cookie that binds an in-flight OIDC login to the browser that
 * started it. It is set when we redirect to the IdP (both the UI login and the
 * MCP `authorize()`), and the returned `state` at /auth/callback must match it.
 * Without this binding an attacker who initiates a flow could relay the callback
 * to a victim (login CSRF / authorization-code injection).
 */
export const OIDC_TXN_COOKIE = 'pointless_oidc_txn';
const OIDC_TXN_TTL_SECONDS = 10 * 60; // 10 minutes — one IdP round-trip

/**
 * Short-lived marker set at logout. The next /auth/login from this browser
 * sends `prompt=select_account` to the IdP so a still-live IdP session (Google
 * has no logout endpoint; others may simply not have been ended) yields the
 * account picker rather than a silent re-login as the previous account.
 */
export const POST_LOGOUT_COOKIE = 'pointless_post_logout';
const POST_LOGOUT_TTL_SECONDS = 5 * 60; // one "sign back in" window

/** Per-request operator identity, populated by `requireOperator` in app.ts. */
export interface Operator {
  /** Our user id, or null for the ADMIN_TOKEN break-glass path. */
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operator?: Operator;
    }
  }
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

/**
 * Sign an arbitrary claims object into a `v1.<payload>.<hmac>` token with an
 * embedded expiry. Shared by the session cookie and the OIDC-transaction cookie.
 */
function signToken(claims: Record<string, unknown>, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64url(JSON.stringify({ ...claims, exp }));
  return `v1.${payload}.${sign(payload)}`;
}

/** Verify a `v1.<payload>.<hmac>` token; returns the claims or null if forged/expired. */
function verifyToken(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, payload, sig] = parts;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims.exp !== 'number' || Math.floor(Date.now() / 1000) >= claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Build a signed session token for `userId`, valid for `ttlSeconds`. */
export function signSession(userId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  return signToken({ uid: userId }, ttlSeconds);
}

/** Verify a session token; returns the user id or null if absent/forged/expired. */
export function verifySession(token: string | undefined): string | null {
  const claims = verifyToken(token);
  return claims && typeof claims.uid === 'string' ? claims.uid : null;
}

/** Sign a token binding the upstream OIDC `state` to this browser. */
export function signOidcTxn(state: string, ttlSeconds = OIDC_TXN_TTL_SECONDS): string {
  return signToken({ st: state }, ttlSeconds);
}

/** Verify an OIDC-transaction token; returns the bound `state` or null. */
export function verifyOidcTxn(token: string | undefined): string | null {
  const claims = verifyToken(token);
  return claims && typeof claims.st === 'string' ? claims.st : null;
}

/** Read a single cookie from the request without depending on cookie-parser. */
function readCookie(req: express.Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined; // malformed percent-encoding ⇒ treat as no cookie (clean 401, not 500)
      }
    }
  }
  return undefined;
}

export function currentUserId(req: express.Request): string | null {
  return verifySession(readCookie(req, SESSION_COOKIE));
}

/**
 * Shared attributes for every auth cookie. `clearCookie` only deletes a cookie
 * whose attributes match how it was set, so set/clear must read from one place —
 * keep them in lockstep here.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: canonicalBaseUrl().startsWith('https'),
    path: '/',
  };
}

export function setSessionCookie(res: express.Response, userId: string): void {
  res.cookie(SESSION_COOKIE, signSession(userId), {
    ...cookieOptions(),
    maxAge: DEFAULT_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: express.Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** The upstream `state` this browser has an in-flight OIDC login for, or null. */
export function currentOidcTxn(req: express.Request): string | null {
  return verifyOidcTxn(readCookie(req, OIDC_TXN_COOKIE));
}

/** Bind an in-flight OIDC login (`state`) to this browser. */
export function setOidcTxnCookie(res: express.Response, state: string): void {
  res.cookie(OIDC_TXN_COOKIE, signOidcTxn(state), {
    ...cookieOptions(),
    maxAge: OIDC_TXN_TTL_SECONDS * 1000,
  });
}

export function clearOidcTxnCookie(res: express.Response): void {
  res.clearCookie(OIDC_TXN_COOKIE, cookieOptions());
}

/** Mark this browser as freshly logged out (see POST_LOGOUT_COOKIE). */
export function setPostLogoutCookie(res: express.Response): void {
  res.cookie(POST_LOGOUT_COOKIE, signToken({ plo: true }, POST_LOGOUT_TTL_SECONDS), {
    ...cookieOptions(),
    maxAge: POST_LOGOUT_TTL_SECONDS * 1000,
  });
}

/** Did this browser just log out? (forged/expired markers read as no) */
export function hasPostLogoutCookie(req: express.Request): boolean {
  const claims = verifyToken(readCookie(req, POST_LOGOUT_COOKIE));
  return claims?.plo === true;
}

export function clearPostLogoutCookie(res: express.Response): void {
  res.clearCookie(POST_LOGOUT_COOKIE, cookieOptions());
}
