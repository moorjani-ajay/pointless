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

/** Build a signed session token for `userId`, valid for `ttlSeconds`. */
export function signSession(userId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64url(JSON.stringify({ uid: userId, exp }));
  return `v1.${payload}.${sign(payload)}`;
}

/** Verify a session token; returns the user id or null if absent/forged/expired. */
export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, payload, sig] = parts;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof uid !== 'string' || typeof exp !== 'number') return null;
    if (Math.floor(Date.now() / 1000) >= exp) return null;
    return uid;
  } catch {
    return null;
  }
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

export function setSessionCookie(res: express.Response, userId: string): void {
  res.cookie(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: canonicalBaseUrl().startsWith('https'),
    path: '/',
    maxAge: DEFAULT_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: express.Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: canonicalBaseUrl().startsWith('https'),
    path: '/',
  });
}
