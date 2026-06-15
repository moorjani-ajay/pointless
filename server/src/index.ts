import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPassword, viewKey } from './auth.js';
import * as store from './db.js';
import { buildMcpServer } from './mcp.js';

const PORT = Number(process.env.PORT ?? 3000);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Presentations are untrusted HTML with scripts enabled. They are only ever
 * served with a CSP sandbox (and embedded via <iframe sandbox>), which gives
 * them an opaque origin: no cookies, no same-origin API access, no parent.
 */
const DOC_CSP = 'sandbox allow-scripts allow-popups; frame-ancestors \'self\'';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

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
  if (!store.deletePresentation(req.params.id)) return res.status(404).json({ error: 'Not found' });
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

app.post('/api/shared/:token/unlock', (req, res) => {
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
      .send('Pointless server is running, but the web UI is not built. Run: pnpm --filter @pointless/web build');
  });
}

app.listen(PORT, () => {
  console.log(`Pointless listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`);
});
