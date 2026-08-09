import { type APIRequestContext, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Helpers for driving the server the way a real MCP client (Claude) does:
// JSON-RPC over the Streamable-HTTP endpoint. The server runs the transport in
// stateless mode (a fresh server per POST), so there is no initialize handshake
// or session id to carry — each call is a self-contained POST. The Accept header
// must offer both JSON and SSE or the transport rejects the request.
const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

export interface McpResult<T> {
  /** The tool's text payload parsed as JSON, or undefined if it wasn't JSON. */
  data: T;
  /** The raw concatenated text content (useful for error-message assertions). */
  text: string;
  isError: boolean;
}

/** Call an MCP tool and unwrap its single text content block. */
export async function mcpCall<T = unknown>(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {}
): Promise<McpResult<T>> {
  const res = await request.post('/mcp', {
    headers: MCP_HEADERS,
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(res.ok(), `MCP ${name} returned HTTP ${res.status()}`).toBeTruthy();
  const result = (await res.json()).result;
  const text: string = (result?.content ?? []).map((c: { text: string }) => c.text).join('');
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = undefined as T;
  }
  return { data, text, isError: result?.isError === true };
}

/** Names of the tools the MCP server advertises. */
export async function mcpListTools(request: APIRequestContext): Promise<string[]> {
  const res = await request.post('/mcp', {
    headers: MCP_HEADERS,
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(res.ok(), `tools/list returned HTTP ${res.status()}`).toBeTruthy();
  const tools = (await res.json()).result.tools as { name: string }[];
  return tools.map((t) => t.name);
}

export interface SeededDeck {
  id: string;
  title: string;
  /** Id of an element embedded in the document, so renders can be asserted. */
  marker: string;
  /** Present only when `publish` was requested. */
  shareToken?: string;
}

/**
 * Author a deck through the real MCP flow (create → set_html → optionally
 * publish) and return its handles. Every deck gets a unique title and an
 * embedded #marker element so parallel tests never collide and renders can be
 * asserted unambiguously.
 */
export async function seedDeck(
  request: APIRequestContext,
  opts: { publish?: boolean; password?: string } = {}
): Promise<SeededDeck> {
  const tag = randomUUID().slice(0, 8);
  const title = `E2E Deck ${tag}`;
  const marker = `marker-${tag}`;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<title>${title}</title><style>html,body{margin:0}</style></head>` +
    `<body><main id="${marker}"><h1>${title}</h1><p>Rendered deck body.</p></main></body></html>`;

  const created = await mcpCall<{ presentation_id: string }>(request, 'create_presentation', {
    title,
  });
  expect(created.isError, created.text).toBeFalsy();
  const id = created.data.presentation_id;

  const set = await mcpCall(request, 'set_html', { presentation_id: id, html });
  expect(set.isError, set.text).toBeFalsy();

  const deck: SeededDeck = { id, title, marker };
  if (opts.publish) {
    const pub = await mcpCall<{ share_url: string }>(request, 'publish', {
      presentation_id: id,
      ...(opts.password !== undefined ? { password: opts.password } : {}),
    });
    expect(pub.isError, pub.text).toBeFalsy();
    deck.shareToken = pub.data.share_url.split('/').pop();
  }
  return deck;
}
