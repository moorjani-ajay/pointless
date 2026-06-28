import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeEqual, verifyPassword, viewKey } from './auth.js';
import * as store from './db.js';
import { buildMcpServer } from './mcp.js';
import { COMMIT, VERSION } from './version.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Presentations are untrusted HTML with scripts enabled. They are only ever
 * served with a CSP sandbox (and embedded via <iframe sandbox>), which gives
 * them an opaque origin: no cookies, no same-origin API access, no parent.
 */
export const DOC_CSP = "sandbox allow-scripts allow-popups; frame-ancestors 'self'";

/**
 * Build the Pointless Express app without binding a port. `index.ts` wraps
 * this in `listen`; tests drive it directly with Supertest.
 */
export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  // A general ceiling on every route except /mcp (which the authoring agent
  // drives and which carries no credentials) and /version (an unauthenticated
  // identity/liveness probe that health checks may poll frequently), plus a
  // strict gate on password attempts so protected share links can't be
  // brute-forced.
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/mcp' || req.path === '/version',
  });
  const unlockLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many unlock attempts. Try again later.' },
  });
  app.use(generalLimiter);

  function baseUrl(req: express.Request): string {
    return process.env.BASE_URL?.replace(/\/$/, '') ?? `${req.protocol}://${req.get('host')}`;
  }

  // The operator surface — deck management and preview-by-id — carries no
  // per-deck credential, unlike share links (which are gated by token +
  // optional password). Guard it: when ADMIN_TOKEN is set it is required (as a
  // Bearer header, or `?admin=` for contexts like <iframe> that can't send
  // headers); when unset, these routes are reachable only from loopback so a
  // local operator needs no configuration.
  const adminToken = process.env.ADMIN_TOKEN;

  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (adminToken) {
      const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '');
      const provided = bearer ?? (typeof req.query.admin === 'string' ? req.query.admin : '');
      if (provided && safeEqual(provided, adminToken)) return next();
      return res.status(401).json({ error: 'Admin authentication required' });
    }
    const ip = req.socket.remoteAddress ?? '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    return res
      .status(403)
      .json({ error: 'Admin API is loopback-only; set ADMIN_TOKEN to allow remote access' });
  }

  // ---------- Health / identity ----------

  // Unauthenticated identity probe: reports the running version + commit so a
  // deployment can be checked at a glance. Doubles as a lightweight liveness
  // check — the app has no other health endpoint.
  app.get('/version', (_req, res) => {
    res.json({ version: VERSION, commit: COMMIT });
  });

  // ---------- MCP (Streamable HTTP, stateless: fresh server+transport per request) ----------

  app.post('/mcp', async (req, res) => {
    const server = buildMcpServer(baseUrl(req));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Stateless mode: no SSE stream to resume, no session to delete.
  app.all('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. POST JSON-RPC messages to /mcp.' },
      id: null,
    });
  });

  // ---------- REST API (used by the web UI) ----------

  app.get('/api/decks', requireAdmin, async (_req, res) => {
    res.json(await store.listPresentations());
  });

  app.get('/api/decks/:id', requireAdmin, async (req, res) => {
    const p = await store.getPresentation(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const { html, ...meta } = p;
    res.json(meta);
  });

  app.delete('/api/decks/:id', requireAdmin, async (req, res) => {
    if (!(await store.deletePresentation(req.params.id)))
      return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  /**
   * Password gate for published presentations: protected ones require the `k`
   * proof from the unlock endpoint. Returns the presentation, or null after
   * having written the error response.
   */
  async function sharedOrReject(req: express.Request, res: express.Response) {
    const p = await store.getPresentationByToken(req.params.token);
    if (!p || !p.published) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    const hash = await store.getPasswordHash(p.shareToken);
    const k = typeof req.query.k === 'string' ? req.query.k : '';
    if (hash && !safeEqual(k, viewKey(hash, p.shareToken))) {
      res.status(401).json({ error: 'Password required', protected: true });
      return null;
    }
    return p;
  }

  app.get('/api/shared/:token', async (req, res) => {
    const p = await sharedOrReject(req, res);
    if (!p) return;
    const { html, ...meta } = p;
    res.json(meta);
  });

  app.post('/api/shared/:token/unlock', unlockLimiter, async (req, res) => {
    const p = await store.getPresentationByToken(req.params.token);
    if (!p || !p.published) return res.status(404).json({ error: 'Not found' });
    const hash = await store.getPasswordHash(p.shareToken);
    if (!hash) return res.json({ key: null });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyPassword(password, hash)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    res.json({ key: viewKey(hash, p.shareToken) });
  });

  // ---------- Raw documents (always CSP-sandboxed) ----------

  app.get('/raw/deck/:id', requireAdmin, async (req, res) => {
    const p = await store.getPresentation(req.params.id);
    if (!p) return res.status(404).send('Not found');
    res.setHeader('Content-Security-Policy', DOC_CSP).type('html').send(p.html);
  });

  app.get('/raw/:token', async (req, res) => {
    const p = await sharedOrReject(req, res);
    if (!p) return;
    res.setHeader('Content-Security-Policy', DOC_CSP).type('html').send(p.html);
  });

  // ---------- Web UI (built SPA) ----------

  const webDist = [path.resolve(HERE, '../public'), path.resolve(HERE, '../../web/dist')].find(
    (p) => fs.existsSync(path.join(p, 'index.html'))
  );

  if (webDist) {
    app.use(express.static(webDist));
    app.get(['/', '/deck/:id', '/d/:token'], (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain')
        .send(
          'Pointless server is running, but the web UI is not built. Run: pnpm --filter @pointless/web build'
        );
    });
  }

  return app;
}
