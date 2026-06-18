import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPassword, viewKey } from './auth.js';
import * as store from './db.js';
import { buildMcpServer } from './mcp.js';
import { PdfUnavailableError, renderDeckPdf } from './pdf.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Presentations are untrusted HTML with scripts enabled. They are only ever
 * served with a CSP sandbox (and embedded via <iframe sandbox>), which gives
 * them an opaque origin: no cookies, no same-origin API access, no parent.
 */
export const DOC_CSP = "sandbox allow-scripts allow-popups; frame-ancestors 'self'";

export interface AppOptions {
  /** Loopback port the PDF renderer fetches the document from. Defaults to PORT/3000. */
  port?: number;
}

/**
 * Build the Pointless Express app without binding a port. `index.ts` wraps
 * this in `listen`; tests drive it directly with Supertest.
 */
export function createApp(options: AppOptions = {}): express.Express {
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  // A general ceiling on every route except /mcp (which the authoring agent
  // drives and which carries no credentials), plus a strict gate on password
  // attempts so protected share links can't be brute-forced.
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/mcp',
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

  app.get('/api/decks', (_req, res) => {
    res.json(store.listPresentations());
  });

  app.get('/api/decks/:id', (req, res) => {
    const p = store.getPresentation(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const { html, ...meta } = p;
    res.json(meta);
  });

  app.delete('/api/decks/:id', (req, res) => {
    if (!store.deletePresentation(req.params.id))
      return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  /**
   * Password gate for published presentations: protected ones require the `k`
   * proof from the unlock endpoint. Returns the presentation, or null after
   * having written the error response.
   */
  function sharedOrReject(req: express.Request, res: express.Response) {
    const p = store.getPresentationByToken(req.params.token);
    if (!p || !p.published) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    const hash = store.getPasswordHash(p.shareToken);
    if (hash && req.query.k !== viewKey(hash, p.shareToken)) {
      res.status(401).json({ error: 'Password required', protected: true });
      return null;
    }
    return p;
  }

  app.get('/api/shared/:token', (req, res) => {
    const p = sharedOrReject(req, res);
    if (!p) return;
    const { html, ...meta } = p;
    res.json(meta);
  });

  app.post('/api/shared/:token/unlock', unlockLimiter, (req, res) => {
    const p = store.getPresentationByToken(req.params.token);
    if (!p || !p.published) return res.status(404).json({ error: 'Not found' });
    const hash = store.getPasswordHash(p.shareToken);
    if (!hash) return res.json({ key: null });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyPassword(password, hash)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    res.json({ key: viewKey(hash, p.shareToken) });
  });

  // ---------- Raw documents (always CSP-sandboxed) ----------

  app.get('/raw/deck/:id', (req, res) => {
    const p = store.getPresentation(req.params.id);
    if (!p) return res.status(404).send('Not found');
    res.setHeader('Content-Security-Policy', DOC_CSP).type('html').send(p.html);
  });

  app.get('/raw/:token', (req, res) => {
    const p = sharedOrReject(req, res);
    if (!p) return;
    res.setHeader('Content-Security-Policy', DOC_CSP).type('html').send(p.html);
  });

  // Best-effort PDF: a print capture of the document's initial view.
  app.get('/d/:token.pdf', async (req, res) => {
    const p = sharedOrReject(req, res);
    if (!p) return;
    try {
      const k = typeof req.query.k === 'string' ? `?k=${encodeURIComponent(req.query.k)}` : '';
      const pdf = await renderDeckPdf(`http://127.0.0.1:${port}/raw/${p.shareToken}${k}`);
      const filename = p.title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'presentation';
      res
        .type('application/pdf')
        .setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`)
        .send(pdf);
    } catch (err) {
      if (err instanceof PdfUnavailableError) return res.status(501).send(err.message);
      console.error('PDF render failed:', err);
      res.status(500).send('PDF render failed');
    }
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
