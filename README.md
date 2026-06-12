# pointless.

**Presentations, minus the Power.**

Pointless is a self-hosted presentation tool you talk to instead of click at.
Deploy it once, connect any LLM tool (Claude, or anything that speaks
[MCP](https://modelcontextprotocol.io)) to its endpoint, and ask for a deck in
plain language. Publishing returns a share link anyone in your org can open.
No accounts, no drag-and-drop, no 40-minute fights with a text box.

```
You: "Make me a 5-slide deck about the Q3 results, numbers attached."
LLM: …calls create_deck / add_slide / publish…
LLM: "Here you go: https://pointless.yourcompany.com/d/J7i3g6Ftg…"
```

## How it works

- **One server, one Docker image.** Express + SQLite + a built-in web viewer.
- **MCP endpoint at `/mcp`** (Streamable HTTP). Tools: `create_deck`,
  `add_slide`, `update_slide`, `delete_slide`, `reorder_slides`, `set_theme`,
  `get_deck`, `get_style_guide`, `publish`.
- **Slides are HTML fragments** on a fixed 1280×720 canvas. A design-system
  stylesheet (themes: `boardroom` light, `midnight` dark) does the styling; the
  `get_style_guide` tool teaches the LLM the available classes, so every deck
  comes out looking designed. Slide HTML is sanitized server-side — no scripts,
  no iframes, no event handlers.
- **Share links** are unguessable 128-bit tokens (`/d/<token>`). Re-publishing
  after edits keeps the same link. Optionally **password-protect** a deck
  (`publish` takes a `password`); viewers are prompted before it opens, and the
  PDF honors it too. **PDF export** at `/d/<token>.pdf` via headless Chromium.
- **Viewer**: keyboard navigation (arrows/space, `f` fullscreen, `n` speaker
  notes), deck overview at `/`.

## Run it

```sh
docker build -t pointless .
docker run -d -p 3000:3000 -v pointless-data:/data \
  -e BASE_URL=https://pointless.yourcompany.com pointless
```

`BASE_URL` is what publish links are minted with; omit it to derive from the
request host.

### Connect an LLM

Point any MCP client at `http://your-host:3000/mcp`. For Claude Code:

```sh
claude mcp add --transport http pointless http://your-host:3000/mcp
```

Then just ask for a deck.

## Development

```sh
pnpm install
pnpm --filter @pointless/shared build
pnpm dev           # server on :3000 (tsx watch)
pnpm dev:web       # vite dev server on :5173, proxies /api + /mcp
```

PDF export locally needs Chromium once: `npx playwright install chromium`.

Repo layout: `server/` (Express, MCP, SQLite, PDF), `web/` (React viewer),
`shared/` (types), `server/themes/` (the design system).

## Security model (v1)

Built for deployment **inside a trusted network**. Anyone who can reach the
server can create decks; anyone with a share link can view that deck unless it
carries a password (scrypt-hashed at rest). Slide HTML is sanitized at write
time. Creator auth (API keys / OAuth) is on the roadmap — the schema already
carries a nullable `owner` for it.

## License

MIT
