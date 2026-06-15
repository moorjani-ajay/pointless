import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hashPassword } from './auth.js';
import * as store from './db.js';
import { DESIGN_GUIDE } from './designguide.js';
import type { Presentation } from '@pointless/shared';

export const MAX_HTML_BYTES = 2 * 1024 * 1024;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [
    { type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
  ],
});

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

function info(p: Presentation, baseUrl: string) {
  return {
    presentation_id: p.id,
    title: p.title,
    html_bytes: p.htmlSize,
    published: p.published,
    password_protected: p.protected,
    preview_url: `${baseUrl}/deck/${p.id}`,
    share_url: p.published ? `${baseUrl}/d/${p.shareToken}` : null,
  };
}

export function buildMcpServer(baseUrl: string): McpServer {
  const server = new McpServer(
    { name: 'pointless', version: '0.2.0' },
    {
      instructions:
        'Pointless hosts presentations that are full, self-contained interactive HTML documents ' +
        '(not slide templates). ALWAYS call get_design_guide before writing one — it defines the ' +
        'requirements and the craft bar. Flow: create_presentation → set_html (complete document) → ' +
        'publish, then ALWAYS give the user the share_url — that link is the deliverable. Offer to ' +
        'protect it with a password (publish accepts one).',
    }
  );

  server.registerTool(
    'get_design_guide',
    {
      title: 'Get the presentation design guide',
      description:
        'Returns the authoring contract and craft guidance: self-containment rules, sandbox constraints, house light/dark palettes, interaction patterns. Call this before writing any presentation HTML.',
      inputSchema: {},
    },
    async () => ok(DESIGN_GUIDE)
  );

  server.registerTool(
    'create_presentation',
    {
      title: 'Create a new presentation',
      description:
        'Creates an empty presentation and returns its id. Then send the full HTML document with set_html.',
      inputSchema: { title: z.string().min(1).max(200).describe('Human-readable title') },
    },
    async ({ title }) => {
      const p = store.createPresentation(title);
      return ok({
        ...info(p, baseUrl),
        next: 'Write the complete HTML document and call set_html. Call get_design_guide first if you have not.',
      });
    }
  );

  server.registerTool(
    'set_html',
    {
      title: 'Set the presentation HTML',
      description:
        'Replaces the presentation with a complete, self-contained HTML document (<!doctype html> … </html>). Used for both first write and edits — always send the full document. Optionally update the title.',
      inputSchema: {
        presentation_id: z.string(),
        html: z.string().min(1).describe('The complete HTML document'),
        title: z.string().min(1).max(200).optional().describe('New title, if it changed'),
      },
    },
    async ({ presentation_id, html, title }) => {
      if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        return fail('Document exceeds 2MB. Trim embedded data URIs or split the content.');
      }
      if (!/<html[\s>]/i.test(html)) {
        return fail(
          'Send a complete HTML document including <html>, <head> and <body> — see get_design_guide.'
        );
      }
      if (!store.setHtml(presentation_id, html, title)) {
        return fail(`No presentation with id ${presentation_id}`);
      }
      const p = store.getPresentation(presentation_id)!;
      return ok({
        ...info(p, baseUrl),
        next: p.published
          ? 'The share link already shows the new version.'
          : 'Call publish to get the share link.',
      });
    }
  );

  server.registerTool(
    'get_presentation',
    {
      title: 'Get a presentation',
      description:
        'Returns metadata and the current HTML document. Use it to read state before editing.',
      inputSchema: { presentation_id: z.string() },
    },
    async ({ presentation_id }) => {
      const p = store.getPresentation(presentation_id);
      if (!p) return fail(`No presentation with id ${presentation_id}`);
      return ok({ ...info(p, baseUrl), html: p.html });
    }
  );

  server.registerTool(
    'list_presentations',
    {
      title: 'List presentations',
      description: 'Lists all presentations on this server with ids, titles and share status.',
      inputSchema: {},
    },
    async () =>
      ok(
        store.listPresentations().map((p) => ({
          presentation_id: p.id,
          title: p.title,
          published: p.published,
          password_protected: p.protected,
          updated_at: p.updatedAt,
        }))
      )
  );

  server.registerTool(
    'publish',
    {
      title: 'Publish the presentation',
      description:
        'Makes the presentation viewable at its share link and returns that link — give it to the user. Re-publishing after edits keeps the same link. ' +
        'Pass `password` to require a password for viewing; pass an empty string to remove an existing password; omit it to leave protection unchanged.',
      inputSchema: {
        presentation_id: z.string(),
        password: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Optional view password. Empty string removes protection; omit to keep current setting.'
          ),
      },
    },
    async ({ presentation_id, password }) => {
      const existing = store.getPresentation(presentation_id);
      if (!existing) return fail(`No presentation with id ${presentation_id}`);
      if (existing.htmlSize === 0)
        return fail('This presentation has no content yet — call set_html first.');
      const passwordHash =
        password === undefined ? undefined : password === '' ? null : hashPassword(password);
      const p = store.publishPresentation(presentation_id, passwordHash)!;
      return ok({
        share_url: `${baseUrl}/d/${p.shareToken}`,
        password_protected: p.protected,
        note: p.protected
          ? 'Viewers will be asked for the password. Share it alongside the link.'
          : 'Anyone with the link can view this presentation.',
      });
    }
  );

  return server;
}
