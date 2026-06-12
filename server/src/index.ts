import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { buildMcpServer } from './mcp.js';
import { PdfUnavailableError, renderDeckPdf } from './pdf.js';
import { renderPrintHtml } from './print.js';
import { getThemeCss, isTheme } from './themes.js';

const PORT = Number(process.env.PORT ?? 3000);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

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
  res.json(store.listDecks());
});

app.get('/api/decks/:id', (req, res) => {
  const deck = store.getDeck(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  res.json(deck);
});

app.delete('/api/decks/:id', (req, res) => {
  if (!store.deleteDeck(req.params.id)) return res.status(404).json({ error: 'Deck not found' });
  res.status(204).end();
});

app.get('/api/shared/:token', (req, res) => {
  const deck = store.getDeckByToken(req.params.token);
  if (!deck || !deck.published) return res.status(404).json({ error: 'Deck not found' });
  res.json(deck);
});

// ---------- Themes, print view, PDF ----------

app.get('/themes/:name.css', (req, res) => {
  const name = req.params.name;
  if (!isTheme(name)) return res.status(404).end();
  res.type('text/css').send(getThemeCss(name));
});

app.get('/print/:token', (req, res) => {
  const deck = store.getDeckByToken(req.params.token);
  if (!deck || !deck.published) return res.status(404).send('Not found');
  res.type('html').send(renderPrintHtml(deck));
});

app.get('/d/:token.pdf', async (req, res) => {
  const deck = store.getDeckByToken(req.params.token);
  if (!deck || !deck.published) return res.status(404).send('Not found');
  try {
    const pdf = await renderDeckPdf(`http://127.0.0.1:${PORT}/print/${deck.shareToken}`);
    const filename = deck.title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'deck';
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
      .send('Pointless server is running, but the web UI is not built. Run: pnpm --filter @pointless/web build');
  });
}

app.listen(PORT, () => {
  console.log(`Pointless listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`);
});
