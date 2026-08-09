import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { isEmailAllowed, mcpResource } from '../config.js';
import * as store from '../db.js';
import { startFederation } from './federation.js';
import { setOidcTxnCookie } from './session.js';
import { mintOpaque, sha256 } from './tokens.js';

/**
 * Pointless as its own OAuth 2.1 Authorization Server, federating the human
 * login to the configured upstream IdP.
 *
 * The SDK's `mcpAuthRouter` mounts the standard endpoints (/authorize, /token,
 * /register, /revoke, and the metadata documents) and drives this provider.
 * Our job is the storage and the federation handoff:
 *   - `authorize()` does NOT log the user in directly; it redirects to the IdP
 *     (Layer-B PKCE) and stashes the MCP client's request. The shared
 *     `/auth/callback` (see routes.ts) resumes it, mints our authorization code,
 *     and bounces back to the MCP client.
 *   - `exchangeAuthorizationCode()` mints our own opaque access/refresh tokens,
 *     bound to the resolved user and to the MCP resource (audience, RFC 8707).
 *   - `verifyAccessToken()` validates those tokens for the bearer middleware.
 *
 * `skipLocalPkceValidation` is left false: we hold the Layer-A challenge, so the
 * SDK performs the standard PKCE check at the token endpoint.
 *
 * Codes and tokens are stored only as SHA-256 hashes; consumption is atomic
 * (DELETE … RETURNING) so a code or refresh token can be redeemed at most once.
 */

const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CLIENTS = 500; // cap open dynamic registration

/** Canonical RFC 8707 audience all our MCP tokens are bound to. */
function audience(): string {
  return resourceUrlFromServerUrl(mcpResource()).toString();
}

/** Permit only https redirect URIs, plus http loopback for native/dev clients (RFC 8252). */
function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  return (
    u.protocol === 'http:' &&
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1')
  );
}

class PgClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const meta = await store.getOAuthClient(clientId);
    return (meta as OAuthClientInformationFull | null) ?? undefined;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    // Dynamic registration is open (RFC 7591), so constrain what it can register:
    // every redirect URI must be https or http-loopback (blocks the classic
    // "register attacker redirect_uri → intercept the code" phishing), and the
    // total client count is bounded to stop unbounded row growth.
    const uris = client.redirect_uris ?? [];
    if (uris.length === 0) {
      throw new InvalidClientMetadataError('at least one redirect_uri is required');
    }
    for (const uri of uris) {
      if (!isAllowedRedirectUri(uri)) {
        throw new InvalidClientMetadataError(
          `redirect_uri must be https or an http loopback address: ${uri}`
        );
      }
    }
    if ((await store.countOAuthClients()) >= MAX_CLIENTS) {
      throw new InvalidClientMetadataError('client registration limit reached on this server');
    }
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    await store.insertOAuthClient(full.client_id, full);
    return full;
  }
}

export class PgFederatedOAuthProvider implements OAuthServerProvider {
  private readonly _clients = new PgClientsStore();

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clients;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    // The SDK's authorize handler has already validated params.redirectUri
    // against the client's registered redirect_uris (with RFC 8252 loopback
    // port relaxation), so we do NOT re-check it here — an exact-match check
    // would wrongly reject loopback clients that use an ephemeral port.
    const { url, state, verifier } = await startFederation();
    await store.insertLoginState({
      state,
      intent: 'mcp',
      pkceVerifier: verifier,
      mcpClientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: (params.scopes ?? []).join(' '),
      clientState: params.state ?? null,
      resource: params.resource?.toString() ?? null,
    });
    setOidcTxnCookie(res, state); // bind this authorize flow to the initiating browser
    res.redirect(url.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const row = await store.getOAuthCode(sha256(authorizationCode));
    if (!row || row.client_id !== client.client_id) {
      throw new InvalidGrantError('invalid authorization code');
    }
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string, // PKCE already verified by the SDK against our challenge
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    // Atomic one-time redemption: only one concurrent /token call wins the row.
    const row = await store.takeOAuthCode(sha256(authorizationCode));
    if (!row || row.client_id !== client.client_id) {
      throw new InvalidGrantError('invalid authorization code');
    }
    if (Date.now() > Number(row.expires_at)) {
      throw new InvalidGrantError('authorization code expired');
    }
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    if (resource && row.resource && resource.toString() !== row.resource) {
      throw new InvalidGrantError('resource does not match the authorization request');
    }
    return this.mint(client.client_id, row.user_id, row.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const refreshHash = sha256(refreshToken);
    // Validate against a non-consuming read first (so a benign client error
    // doesn't destroy a still-valid session)…
    const row = await store.getOAuthToken(refreshHash);
    if (!row || row.kind !== 'refresh' || row.client_id !== client.client_id) {
      throw new InvalidGrantError('invalid refresh token');
    }
    if (Date.now() > Number(row.expires_at)) {
      throw new InvalidGrantError('refresh token expired');
    }
    if (row.audience !== audience()) {
      throw new InvalidGrantError('token audience mismatch');
    }
    if (resource && resource.toString() !== row.audience) {
      throw new InvalidGrantError('resource does not match the original grant');
    }
    // Re-check the allowlist so an offboarded user can't keep minting tokens for
    // the remaining ~30-day refresh window.
    const user = await store.getUserById(row.user_id);
    if (!user || !isEmailAllowed(user.email ?? undefined)) {
      throw new InvalidGrantError('account is no longer permitted');
    }
    const granted = row.scopes ? row.scopes.split(' ').filter(Boolean) : [];
    if (scopes && scopes.some((s) => !granted.includes(s))) {
      throw new InvalidGrantError('requested scopes exceed the original grant');
    }
    const nextScopes = scopes && scopes.length ? scopes.join(' ') : row.scopes;
    // …then atomically consume. If a concurrent refresh already rotated it, the
    // DELETE returns nothing and we abort — preventing two live pairs (H1).
    const consumed = await store.takeOAuthToken(refreshHash, 'refresh');
    if (!consumed) {
      throw new InvalidGrantError('refresh token already used');
    }
    await store.deleteAccessTokensForRefresh(refreshHash); // drop the old pair's access tokens
    return this.mint(client.client_id, row.user_id, nextScopes);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await store.getOAuthToken(sha256(token));
    if (!row || row.kind !== 'access') throw new InvalidTokenError('invalid access token');
    if (Date.now() > Number(row.expires_at)) throw new InvalidTokenError('access token expired');
    if (row.audience !== audience()) throw new InvalidTokenError('token audience mismatch');
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes ? row.scopes.split(' ').filter(Boolean) : [],
      expiresAt: Math.floor(Number(row.expires_at) / 1000), // AuthInfo.expiresAt is in SECONDS
      resource: new URL(row.audience),
      extra: { userId: row.user_id },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const hash = sha256(request.token);
    const row = await store.getOAuthToken(hash);
    // RFC 7009: a client may only revoke its own tokens; silently succeed on an
    // unknown or foreign token rather than deleting it.
    if (!row || row.client_id !== client.client_id) return;
    await store.deleteAccessTokensForRefresh(hash); // if a refresh, cascade its access tokens
    await store.deleteOAuthToken(hash);
  }

  private async mint(clientId: string, userId: string, scopes: string): Promise<OAuthTokens> {
    const access = mintOpaque('pt_at_');
    const refresh = mintOpaque('pt_rt_');
    const aud = audience();
    const at = Date.now();
    await store.insertOAuthToken({
      tokenHash: sha256(refresh),
      kind: 'refresh',
      clientId,
      userId,
      scopes,
      audience: aud,
      refreshHash: null,
      expiresAt: at + REFRESH_TTL_MS,
    });
    await store.insertOAuthToken({
      tokenHash: sha256(access),
      kind: 'access',
      clientId,
      userId,
      scopes,
      audience: aud,
      refreshHash: sha256(refresh),
      expiresAt: at + ACCESS_TTL_MS,
    });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'bearer',
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      scope: scopes || undefined,
    };
  }
}
