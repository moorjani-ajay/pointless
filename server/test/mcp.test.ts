import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer, MAX_HTML_BYTES } from '../src/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const BASE = 'https://decks.example';
const DOC = '<!doctype html><html><head></head><body>Hi</body></html>';

let client: Client;
let server: McpServer;

beforeEach(async () => {
  server = buildMcpServer(BASE);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
});

/** Call a tool and return { text, json, isError }. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content.map((c) => c.text).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { text, json: json as Record<string, unknown> | undefined, isError: res.isError === true };
}

describe('tool surface', () => {
  it('exposes the documented tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'create_presentation',
        'get_design_guide',
        'get_presentation',
        'list_presentations',
        'publish',
        'set_html',
      ].sort()
    );
  });

  it('get_design_guide returns non-empty guidance', async () => {
    const { text, isError } = await call('get_design_guide');
    expect(isError).toBe(false);
    expect(text.length).toBeGreaterThan(50);
  });
});

describe('create → set_html → publish flow', () => {
  it('creates an unpublished presentation with a preview url', async () => {
    const { json, isError } = await call('create_presentation', { title: 'Q3 Review' });
    expect(isError).toBe(false);
    expect(json?.title).toBe('Q3 Review');
    expect(json?.published).toBe(false);
    expect(String(json?.preview_url)).toContain(BASE);
    expect(json?.share_url).toBeNull();
  });

  it('walks a full deck to a share url', async () => {
    const created = await call('create_presentation', { title: 'Deck' });
    const id = created.json!.presentation_id as string;

    const set = await call('set_html', { presentation_id: id, html: DOC });
    expect(set.isError).toBe(false);
    expect(set.json?.html_bytes).toBe(Buffer.byteLength(DOC, 'utf8'));

    const pub = await call('publish', { presentation_id: id });
    expect(pub.isError).toBe(false);
    expect(String(pub.json?.share_url)).toMatch(new RegExp(`^${BASE}/d/`));
    expect(pub.json?.password_protected).toBe(false);
  });

  it('publishing with a password marks the deck protected', async () => {
    const created = await call('create_presentation', { title: 'Secret' });
    const id = created.json!.presentation_id as string;
    await call('set_html', { presentation_id: id, html: DOC });
    const pub = await call('publish', { presentation_id: id, password: 'hunter2' });
    expect(pub.json?.password_protected).toBe(true);
  });
});

describe('set_html validation', () => {
  it('rejects content that is not a full HTML document', async () => {
    const created = await call('create_presentation', { title: 'Fragment' });
    const id = created.json!.presentation_id as string;
    const set = await call('set_html', { presentation_id: id, html: '<div>just a fragment</div>' });
    expect(set.isError).toBe(true);
    expect(set.text).toMatch(/complete HTML document/i);
  });

  it('rejects documents larger than the 2MB cap', async () => {
    const created = await call('create_presentation', { title: 'Huge' });
    const id = created.json!.presentation_id as string;
    const oversized = '<html>' + 'x'.repeat(MAX_HTML_BYTES) + '</html>';
    const set = await call('set_html', { presentation_id: id, html: oversized });
    expect(set.isError).toBe(true);
    expect(set.text).toMatch(/2MB/);
  });

  it('errors on an unknown presentation id', async () => {
    const set = await call('set_html', { presentation_id: 'ghost', html: DOC });
    expect(set.isError).toBe(true);
    expect(set.text).toMatch(/No presentation/);
  });
});

describe('publish guards', () => {
  it('refuses to publish a deck with no content yet', async () => {
    const created = await call('create_presentation', { title: 'Empty' });
    const id = created.json!.presentation_id as string;
    const pub = await call('publish', { presentation_id: id });
    expect(pub.isError).toBe(true);
    expect(pub.text).toMatch(/no content yet/i);
  });
});

describe('server identity', () => {
  // Guards against the drift that prompted this work: the MCP server must
  // advertise the version from the single source of truth (root package.json),
  // never a hardcoded literal.
  it('advertises the version from the single source of truth', () => {
    const root = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ) as { version: string };
    expect(client.getServerVersion()?.name).toBe('pointless');
    expect(client.getServerVersion()?.version).toBe(root.version);
  });
});
