import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hashPassword } from './auth.js';
import * as store from './db.js';
import { sanitizeSlideHtml } from './sanitize.js';
import { STYLE_GUIDE } from './styleguide.js';
import { DEFAULT_THEME, THEMES, isTheme } from './themes.js';
import type { Deck } from '@pointless/shared';

const themeSchema = z
  .enum(Object.keys(THEMES) as [string, ...string[]])
  .describe('Theme name. Call get_style_guide to see what each looks like.');

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

function deckInfo(deck: Deck, baseUrl: string) {
  return {
    deck_id: deck.id,
    title: deck.title,
    theme: deck.theme,
    slide_count: deck.slideCount,
    published: deck.published,
    preview_url: `${baseUrl}/deck/${deck.id}`,
    share_url: deck.published ? `${baseUrl}/d/${deck.shareToken}` : null,
  };
}

export function buildMcpServer(baseUrl: string): McpServer {
  const server = new McpServer(
    { name: 'pointless', version: '0.1.0' },
    {
      instructions:
        'Pointless builds shareable presentations from HTML slides. ' +
        'ALWAYS call get_style_guide before writing or editing slides — it defines the ' +
        'canvas, the design-system classes, and authoring rules. Build decks with ' +
        'create_deck + add_slide and iterate with update_slide/reorder_slides. ' +
        'When the deck is ready (and after any later edits), ALWAYS call publish and give ' +
        'the user the share_url — that link is the deliverable. Offer to protect the link ' +
        'with a password (publish accepts an optional password).',
    }
  );

  server.registerTool(
    'get_style_guide',
    {
      title: 'Get the slide authoring style guide',
      description:
        'Returns the authoring contract: slide canvas, available design-system classes, themes, and HTML recipes. Call this before writing any slide HTML.',
      inputSchema: {},
    },
    async () => ok(STYLE_GUIDE)
  );

  server.registerTool(
    'create_deck',
    {
      title: 'Create a new deck',
      description: 'Creates an empty presentation. Returns the deck_id used by all other tools.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Human-readable deck title'),
        theme: themeSchema.optional(),
      },
    },
    async ({ title, theme }) => {
      const deck = store.createDeck(title, theme && isTheme(theme) ? theme : DEFAULT_THEME);
      return ok({
        ...deckInfo(deck, baseUrl),
        next: 'Add slides with add_slide. Call get_style_guide first if you have not.',
      });
    }
  );

  server.registerTool(
    'get_deck',
    {
      title: 'Get a deck and all its slides',
      description:
        'Returns deck metadata plus every slide (id, position, html, notes). Use it to read current state before editing.',
      inputSchema: { deck_id: z.string() },
    },
    async ({ deck_id }) => {
      const deck = store.getDeck(deck_id);
      if (!deck) return fail(`No deck with id ${deck_id}`);
      return ok({ ...deckInfo(deck, baseUrl), slides: deck.slides });
    }
  );

  server.registerTool(
    'add_slide',
    {
      title: 'Add a slide',
      description:
        'Appends a slide (or inserts at `position`, 1-based). `html` is a fragment per the style guide — no <html>/<body>/.slide wrapper. Optional speaker `notes`.',
      inputSchema: {
        deck_id: z.string(),
        html: z.string().min(1).describe('Slide HTML fragment using design-system classes'),
        notes: z.string().optional().describe('Speaker notes (plain text)'),
        position: z.number().int().min(1).optional().describe('1-based insert position; omit to append'),
      },
    },
    async ({ deck_id, html, notes, position }) => {
      if (!store.getDeck(deck_id)) return fail(`No deck with id ${deck_id}`);
      const clean = sanitizeSlideHtml(html);
      if ('error' in clean) return fail(clean.error);
      const slide = store.addSlide(deck_id, clean.html, notes ?? null, position);
      return ok({ slide_id: slide.id, position: slide.position });
    }
  );

  server.registerTool(
    'update_slide',
    {
      title: 'Update a slide',
      description: 'Replaces a slide\'s html and/or notes. Omitted fields are left unchanged.',
      inputSchema: {
        slide_id: z.string(),
        html: z.string().min(1).optional(),
        notes: z.string().nullable().optional().describe('New notes; pass null to clear'),
      },
    },
    async ({ slide_id, html, notes }) => {
      let cleanHtml: string | undefined;
      if (html !== undefined) {
        const clean = sanitizeSlideHtml(html);
        if ('error' in clean) return fail(clean.error);
        cleanHtml = clean.html;
      }
      if (!store.updateSlide(slide_id, cleanHtml, notes)) {
        return fail(`No slide with id ${slide_id}`);
      }
      return ok({ updated: slide_id });
    }
  );

  server.registerTool(
    'delete_slide',
    {
      title: 'Delete a slide',
      description: 'Removes a slide; later slides shift up.',
      inputSchema: { slide_id: z.string() },
    },
    async ({ slide_id }) => {
      if (!store.deleteSlide(slide_id)) return fail(`No slide with id ${slide_id}`);
      return ok({ deleted: slide_id });
    }
  );

  server.registerTool(
    'reorder_slides',
    {
      title: 'Reorder slides',
      description:
        'Sets the full slide order. `slide_ids` must list every slide id in the deck exactly once, in the new order.',
      inputSchema: {
        deck_id: z.string(),
        slide_ids: z.array(z.string()).min(1),
      },
    },
    async ({ deck_id, slide_ids }) => {
      if (!store.getDeck(deck_id)) return fail(`No deck with id ${deck_id}`);
      const err = store.reorderSlides(deck_id, slide_ids);
      return err ? fail(err) : ok({ reordered: deck_id });
    }
  );

  server.registerTool(
    'set_theme',
    {
      title: 'Set the deck theme',
      description: 'Switches the deck to a different theme. Slides are restyled automatically.',
      inputSchema: { deck_id: z.string(), theme: themeSchema },
    },
    async ({ deck_id, theme }) => {
      if (!isTheme(theme)) return fail(`Unknown theme ${theme}`);
      if (!store.setTheme(deck_id, theme)) return fail(`No deck with id ${deck_id}`);
      return ok({ deck_id, theme });
    }
  );

  server.registerTool(
    'publish',
    {
      title: 'Publish the deck',
      description:
        'Makes the deck viewable at its share link and returns that link. Re-publishing after edits keeps the same link (it always shows the latest version). Give this link to the user. ' +
        'Pass `password` to require a password for viewing; pass an empty string to remove an existing password; omit it to leave protection unchanged.',
      inputSchema: {
        deck_id: z.string(),
        password: z
          .string()
          .max(200)
          .optional()
          .describe('Optional view password. Empty string removes protection; omit to keep current setting.'),
      },
    },
    async ({ deck_id, password }) => {
      const passwordHash =
        password === undefined ? undefined : password === '' ? null : hashPassword(password);
      const deck = store.publishDeck(deck_id, passwordHash);
      if (!deck) return fail(`No deck with id ${deck_id}`);
      return ok({
        share_url: `${baseUrl}/d/${deck.shareToken}`,
        pdf_url: `${baseUrl}/d/${deck.shareToken}.pdf`,
        slide_count: deck.slideCount,
        password_protected: deck.protected,
        note: deck.protected
          ? 'Viewers will be asked for the password. Share it alongside the link.'
          : 'Anyone with the link can view this deck.',
      });
    }
  );

  return server;
}
