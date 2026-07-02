/**
 * Central auth configuration, read from the environment.
 *
 * Pointless is open by default. Everything here is opt-in: with no env set,
 * `authMode()` is `'off'` and the server behaves exactly as it always has.
 * Two switches gate the two surfaces:
 *   - AUTH_MODE=oidc      → UI login + the OAuth authorization-server routes
 *   - MCP_REQUIRE_AUTH    → whether /mcp requires a bearer token. Under oidc this
 *                           defaults to ON: per-user isolation is meaningless
 *                           with an open, unscoped data plane, so gating the
 *                           dashboard gates /mcp too. Set MCP_REQUIRE_AUTH=false
 *                           to deliberately leave /mcp open (e.g. a single-user
 *                           instance). When AUTH_MODE is unset it is always off.
 *
 * Values are read lazily (at call time, not import time) so tests can construct
 * apps with different env — mirroring how `db.ts` reads DATABASE_URL and
 * `app.ts` reads ADMIN_TOKEN.
 */

export type AuthMode = 'off' | 'oidc';

export function authMode(): AuthMode {
  return process.env.AUTH_MODE === 'oidc' ? 'oidc' : 'off';
}

export function mcpRequireAuth(): boolean {
  const raw = process.env.MCP_REQUIRE_AUTH;
  // Default-secure under oidc: an unset (or empty) value gates /mcp so the data
  // plane isn't left open and unscoped by default. Requires an explicit
  // `false` to opt out. In 'off' mode there is no authorization server to
  // verify bearer tokens, so it stays false (validateAuthConfig also rejects an
  // explicit MCP_REQUIRE_AUTH=true without oidc).
  if (raw === undefined || raw === '') return authMode() === 'oidc';
  return raw === 'true';
}

/**
 * Canonical origin of this instance — the OAuth issuer and the base for the
 * MCP resource (audience). Distinct from `app.ts`'s per-request `baseUrl(req)`:
 * OAuth identifiers must be stable, so they come from BASE_URL only.
 */
export function canonicalBaseUrl(): string {
  return (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** The redirect URI registered with the upstream IdP (single, shared by UI + MCP intents). */
export function oidcRedirectUri(): string {
  return `${canonicalBaseUrl()}/auth/callback`;
}

/** The RFC 8707 resource identifier (audience) MCP tokens are bound to. */
export function mcpResource(): string {
  return `${canonicalBaseUrl()}/mcp`;
}

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

export function oidcSettings(): OidcSettings {
  return {
    issuer: process.env.OIDC_ISSUER ?? '',
    clientId: process.env.OIDC_CLIENT_ID ?? '',
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    scopes: process.env.OIDC_SCOPES ?? 'openid email profile',
  };
}

export function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? '';
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Email domains permitted to sign in. Empty ⇒ any IdP-authenticated user is allowed. */
export function allowedDomains(): string[] {
  return csv(process.env.OIDC_ALLOWED_DOMAINS);
}

/** Emails granted the admin (operator) role — they see and manage every deck. */
export function adminEmails(): Set<string> {
  return new Set(csv(process.env.OIDC_ADMIN_EMAILS));
}

export function isEmailAllowed(email: string | undefined): boolean {
  const domains = allowedDomains();
  if (domains.length === 0) return true; // no allowlist ⇒ open to any authenticated user
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}

export type Role = 'admin' | 'user';

export function roleForEmail(email: string | undefined): Role {
  return email && adminEmails().has(email.toLowerCase()) ? 'admin' : 'user';
}

/**
 * Validate that an `AUTH_MODE=oidc` instance is fully configured. Called once at
 * startup (and surfaced as a clear error) so the server fails fast rather than
 * 500ing on the first login attempt.
 */
/** True only for `localhost`/loopback hosts, where http (no TLS) is acceptable. */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function validateAuthConfig(): void {
  // Reject a set-but-unrecognized MCP_REQUIRE_AUTH (e.g. "1", "yes", "TRUE") so a
  // typo can't silently leave /mcp open while the dashboard looks gated.
  const rawMcp = process.env.MCP_REQUIRE_AUTH;
  if (rawMcp !== undefined && rawMcp !== 'true' && rawMcp !== 'false' && rawMcp !== '') {
    throw new Error(`MCP_REQUIRE_AUTH must be exactly "true" or "false" (got: "${rawMcp}").`);
  }
  if (mcpRequireAuth() && authMode() !== 'oidc') {
    throw new Error(
      'MCP_REQUIRE_AUTH=true requires AUTH_MODE=oidc — gating the MCP endpoint ' +
        'needs the OAuth authorization server that oidc mode mounts.'
    );
  }
  if (authMode() !== 'oidc') return;
  const missing: string[] = [];
  const s = oidcSettings();
  if (!s.issuer) missing.push('OIDC_ISSUER');
  if (!s.clientId) missing.push('OIDC_CLIENT_ID');
  if (!s.clientSecret) missing.push('OIDC_CLIENT_SECRET');
  if (!sessionSecret()) missing.push('SESSION_SECRET');
  if (!process.env.BASE_URL) missing.push('BASE_URL');
  if (missing.length) {
    throw new Error(
      `AUTH_MODE=oidc requires: ${missing.join(', ')}. ` +
        'Set them (see the SSO section of the README) or unset AUTH_MODE to run open.'
    );
  }

  // The IdP issuer must be https outside localhost — otherwise the client secret
  // and upstream tokens would travel in cleartext (openid-client only allows
  // http for non-https issuers, see federation.ts).
  let issuerHost: string;
  try {
    issuerHost = new URL(s.issuer).hostname;
  } catch {
    throw new Error(`OIDC_ISSUER is not a valid URL: ${s.issuer}`);
  }
  if (!s.issuer.startsWith('https:') && !isLoopbackHost(issuerHost)) {
    throw new Error(`OIDC_ISSUER must use https:// outside localhost — got: ${s.issuer}`);
  }

  // A short SESSION_SECRET makes the cookie HMAC brute-forceable.
  if (sessionSecret().length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters (e.g. `openssl rand -hex 32`).');
  }
}
