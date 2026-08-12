import * as client from 'openid-client';
import { canonicalBaseUrl, oidcRedirectUri, oidcSettings } from '../config.js';

/**
 * Upstream OIDC federation via openid-client v6 (functional API).
 *
 * This is the single place we talk to the configured IdP (Google, Entra, Okta,
 * Keycloak, …). It is intent-agnostic: both the UI login (`/auth/login`) and the
 * MCP authorization-server `authorize()` (Phase 2) call `startFederation()` to
 * bounce the human to the IdP, then `completeFederation()` on the shared
 * `/auth/callback`. What differs is only the state row each persists.
 *
 * PKCE here (verifier/challenge) is "Layer B" — between Pointless-as-OIDC-client
 * and the upstream IdP. It is entirely separate from the "Layer A" PKCE an MCP
 * client runs against Pointless-as-authorization-server.
 */

// Discovery is a network round-trip; memoize the Configuration per issuer so we
// pay it once. Keyed by issuer URL so a test that points at a different mock IdP
// gets its own config rather than a stale one.
const configs = new Map<string, Promise<client.Configuration>>();

export async function oidcConfig(): Promise<client.Configuration> {
  const { issuer, clientId, clientSecret } = oidcSettings();
  let cfg = configs.get(issuer);
  if (!cfg) {
    // Production issuers are HTTPS. For http:// issuers (a local Keycloak in
    // dev, or the mock IdP in tests) openid-client requires opt-in: enable it
    // both for the discovery request and on the resolved config so the
    // token/userinfo calls are allowed too.
    const insecure = !issuer.startsWith('https:');
    cfg = (async () => {
      try {
        // String client secret ⇒ client_secret_post token-endpoint auth.
        const c = await client.discovery(
          new URL(issuer),
          clientId,
          clientSecret,
          undefined,
          insecure ? { execute: [client.allowInsecureRequests] } : undefined
        );
        if (insecure) client.allowInsecureRequests(c);
        return c;
      } catch (err) {
        // Don't cache a rejected promise — a transient IdP/network failure would
        // otherwise permanently break SSO until restart. Evict so the next call
        // retries discovery.
        configs.delete(issuer);
        throw err;
      }
    })();
    configs.set(issuer, cfg);
  }
  return cfg;
}

/** Clear the discovery cache (tests that swap issuers between apps). */
export function resetOidcConfigCache(): void {
  configs.clear();
}

export interface FederationStart {
  url: URL;
  state: string;
  verifier: string;
}

/**
 * Begin a federation: returns the IdP authorization URL plus the `state` and
 * PKCE `verifier` the caller must persist (keyed by `state`) before redirecting.
 *
 * `prompt` (e.g. 'select_account') is forwarded to the IdP when set — used
 * after a logout so an IdP with a live session (or Google, which has no logout
 * endpoint at all) shows its account picker instead of silently signing the
 * previous account straight back in.
 */
export async function startFederation(opts?: { prompt?: string }): Promise<FederationStart> {
  const cfg = await oidcConfig();
  const { scopes } = oidcSettings();
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const url = client.buildAuthorizationUrl(cfg, {
    redirect_uri: oidcRedirectUri(),
    scope: scopes,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    ...(opts?.prompt ? { prompt: opts.prompt } : {}),
  });
  return { url, state, verifier };
}

/**
 * RP-initiated logout (OIDC Session Management): the IdP URL to send the
 * browser to after clearing the local session, or null when the IdP does not
 * advertise an `end_session_endpoint` (Google doesn't — local logout plus the
 * post-logout `prompt=select_account` is all there is). `client_id` lets IdPs
 * that accept it (Auth0, Entra, Keycloak) validate `post_logout_redirect_uri`
 * without an `id_token_hint`, which the stateless session never retains.
 * Disable with OIDC_RP_LOGOUT=false to fall back to local-only logout.
 */
export async function endSessionUrl(): Promise<URL | null> {
  if (process.env.OIDC_RP_LOGOUT === 'false') return null;
  const cfg = await oidcConfig();
  if (!cfg.serverMetadata().end_session_endpoint) return null;
  return client.buildEndSessionUrl(cfg, {
    client_id: oidcSettings().clientId,
    post_logout_redirect_uri: canonicalBaseUrl(),
  });
}

export interface FederatedIdentity {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
}

/**
 * Complete a federation on the callback. `currentUrl` is the full incoming
 * request URL (including the `code` and `state` query params); `verifier` and
 * `expectedState` come from the persisted state row.
 */
export async function completeFederation(
  currentUrl: URL,
  verifier: string,
  expectedState: string
): Promise<FederatedIdentity> {
  const cfg = await oidcConfig();
  const tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
    pkceCodeVerifier: verifier,
    expectedState,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error('OIDC token response carried no ID token claims');

  let email = typeof claims.email === 'string' ? claims.email : undefined;
  let name = typeof claims.name === 'string' ? claims.name : undefined;

  // Some IdPs keep profile/email out of the ID token; fall back to userinfo.
  if (!email || !name) {
    try {
      const info = await client.fetchUserInfo(cfg, tokens.access_token, claims.sub);
      email = email ?? (typeof info.email === 'string' ? info.email : undefined);
      name = name ?? (typeof info.name === 'string' ? info.name : undefined);
    } catch {
      // userinfo is best-effort; the ID token claims are authoritative.
    }
  }

  return { iss: claims.iss, sub: claims.sub, email, name };
}
