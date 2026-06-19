# pointless.

**Presentations, minus the Power.**

Pointless is a self-hosted presentation tool you talk to instead of click at.
Deploy it once, connect any LLM tool (Claude, or anything that speaks
[MCP](https://modelcontextprotocol.io)) to its endpoint, and ask for a
presentation in plain language. What you get back is not a slide template —
it's a **bespoke interactive HTML experience** (its own typography, motion,
and navigation), published at a share link anyone in your org can open.

```
You: "Turn these Q3 numbers into a dark, editorial presentation —
      full-screen sections, keyboard nav, end on the hiring ask."
LLM: …calls create_presentation / set_html / publish…
LLM: "Here you go: https://pointless.yourcompany.com/d/YzRu45qV…"
```

See [`examples/uk-quiz.html`](examples/uk-quiz.html) for the kind of thing a
presentation can be — a daily standup quiz with timers, reveal states, and
keyboard navigation, generated in one conversation.

## How it works

- **One server, one Docker image.** Express + SQLite + a built-in web UI.
- **A presentation is one complete, self-contained HTML document** — CSS and
  JS inline, scripts allowed. The MCP `get_design_guide` tool gives the LLM
  the authoring contract: self-containment, viewport rules, house light/dark
  palettes, interaction patterns, and the craft bar.
- **Sandboxed by construction.** Documents are only ever served with a CSP
  sandbox and embedded via `<iframe sandbox>`, so they run in an opaque
  origin: no cookies, no API access, no reach into the app or other
  presentations.
- **MCP endpoint at `/mcp`** (Streamable HTTP). Tools: `get_design_guide`,
  `create_presentation`, `set_html`, `get_presentation`,
  `list_presentations`, `publish`.
- **Share links** are unguessable 128-bit tokens (`/d/<token>`).
  Re-publishing after edits keeps the same link. Optionally
  **password-protect** a presentation (`publish` takes a `password`,
  scrypt-hashed at rest); viewers are prompted before it opens.
- **Web UI**: a landing page that onboards new users (copy the MCP endpoint,
  connect Claude, ask), plus a grid of your presentations with live
  thumbnails.

## Run it

```sh
docker build -t pointless .
docker run -d -p 3000:3000 -v pointless-data:/data \
  -e BASE_URL=https://pointless.yourcompany.com pointless
```

`BASE_URL` is what publish links are minted with; omit it to derive from the
request host.

`ADMIN_TOKEN` gates the operator surface (deck list/delete and preview-by-id).
Set it whenever the server is reachable beyond loopback, then open the manager
UI once as `https://your-host/?admin=<token>` — the token is stored locally and
attached to operator requests thereafter. When unset, the operator routes are
reachable only from `127.0.0.1`, so a purely local instance needs no config.
Share links (and their optional passwords) are unaffected either way.

### Connect an LLM

Point any MCP client at `http://your-host:3000/mcp`. For Claude Code:

```sh
claude mcp add --transport http pointless http://your-host:3000/mcp
```

For Claude Desktop / claude.ai: Settings → Connectors → Add custom connector
→ paste the endpoint URL. Then just ask for a presentation.

## Development

```sh
pnpm install
pnpm --filter @pointless/shared build
pnpm dev           # server on :3000 (tsx watch)
pnpm dev:web       # vite dev server on :5173, proxies /api + /raw + /mcp
```

Repo layout: `server/` (Express, MCP, SQLite), `web/` (React
landing + viewer host), `shared/` (types), `examples/` (sample
presentations).

## Security model (v1)

Built for deployment **inside a trusted network**. Authoring happens over MCP;
anyone with a share link can view that presentation unless it carries a
password. The operator surface (listing/deleting decks and previewing a deck by
its internal id, which bypasses the share password) is gated by `ADMIN_TOKEN`
when set, and is loopback-only otherwise — so it is never exposed unguarded on a
public host. Presentation documents may contain arbitrary JavaScript — that is
the point — and are therefore always isolated behind a CSP sandbox / sandboxed
iframe with an opaque origin. Per-creator auth (API keys / OAuth) is on the
roadmap — the schema already carries a nullable `owner` for it.

## License

MIT
