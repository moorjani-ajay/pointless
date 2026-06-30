import type express from 'express';
import { canonicalBaseUrl, isEmailAllowed, roleForEmail } from '../config.js';
import * as store from '../db.js';
import { completeFederation, startFederation } from './federation.js';
import { clearSessionCookie, currentUserId, setSessionCookie } from './session.js';
import { mintOpaque, sha256 } from './tokens.js';

const MCP_CODE_TTL_MS = 60 * 1000;

/**
 * UI-facing authentication routes, mounted only when AUTH_MODE=oidc.
 *
 * `/auth/callback` is shared infrastructure: the same upstream IdP redirect URI
 * serves both the UI login (intent='ui') and — in Phase 2 — the MCP
 * authorization flow (intent='mcp'). The persisted login-state row carries the
 * intent, so this one handler resolves the identity and then branches.
 */
export function mountAuthRoutes(app: express.Express): void {
  // Kick off an interactive login: bounce the browser to the IdP.
  app.get('/auth/login', (req, res, next) => {
    void (async () => {
      const { url, state, verifier } = await startFederation();
      await store.insertLoginState({ state, intent: 'ui', pkceVerifier: verifier });
      res.redirect(url.href);
    })().catch(next);
  });

  // Shared upstream-IdP callback (UI today; MCP intent added in Phase 2).
  app.get('/auth/callback', (req, res, next) => {
    void (async () => {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!state) return res.status(400).send('Missing state');

      const row = await store.takeLoginState(state); // one-time use
      if (!row) return res.status(400).send('Unknown or expired login state');

      const incoming = new URL(req.originalUrl, canonicalBaseUrl());
      const identity = await completeFederation(incoming, row.pkce_verifier, state);

      if (!isEmailAllowed(identity.email)) {
        return res
          .status(403)
          .send('This account is not permitted to sign in to this Pointless instance.');
      }

      const user = await store.upsertUser(identity);

      if (row.intent === 'ui') {
        setSessionCookie(res, user.id);
        return res.redirect('/');
      }

      // intent === 'mcp': the user authenticated upstream on behalf of an MCP
      // client. Mint our authorization code (bound to this user) and hand control
      // back to the client's registered redirect_uri; the SDK's /token endpoint
      // then exchanges it via the provider.
      if (!row.mcp_client_id || !row.redirect_uri || !row.code_challenge) {
        return res.status(400).send('Malformed MCP login state');
      }
      const rawCode = mintOpaque('pt_code_');
      await store.insertOAuthCode({
        code: sha256(rawCode), // store only the hash; the raw code is handed to the client
        clientId: row.mcp_client_id,
        userId: user.id,
        redirectUri: row.redirect_uri,
        codeChallenge: row.code_challenge,
        scopes: row.scopes ?? '',
        resource: row.resource,
        expiresAt: Date.now() + MCP_CODE_TTL_MS,
      });
      const back = new URL(row.redirect_uri);
      back.searchParams.set('code', rawCode);
      if (row.client_state) back.searchParams.set('state', row.client_state);
      return res.redirect(back.href);
    })().catch(next);
  });

  // Who am I — consumed by the SPA to gate the dashboard.
  app.get('/auth/me', (req, res, next) => {
    void (async () => {
      const uid = currentUserId(req);
      if (!uid) return res.json(null);
      const user = await store.getUserById(uid);
      if (!user) {
        clearSessionCookie(res); // stale session (user removed) — drop it
        return res.json(null);
      }
      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: roleForEmail(user.email ?? undefined),
      });
    })().catch(next);
  });

  app.post('/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });
}
