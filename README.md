# pointless.

**Presentations, minus the Power.**

Pointless is a self-hosted presentation tool you talk to instead of click at.
Deploy it once, connect any LLM that speaks
[MCP](https://modelcontextprotocol.io) (Claude, or anything else), and ask for a
presentation in plain language. What comes back is not a slide template: it's a
bespoke, self-contained HTML experience (its own typography, motion, and
navigation), published at a share link anyone in your org can open.

```
You: "Turn these Q3 numbers into a dark, editorial presentation:
      full-screen sections, keyboard nav, end on the hiring ask."
LLM: …calls create_presentation / set_html / publish…
LLM: "Here you go: https://pointless.yourcompany.com/d/YzRu45qV…"
```

See [`examples/uk-quiz.html`](examples/uk-quiz.html) for what a presentation can
be: a standup quiz with timers, reveal states, and keyboard navigation,
generated in one conversation.

## Try it

No install required. Point your MCP client at the hosted instance and start
asking for presentations.

<!-- demo GIF: add ![pointless demo](docs/demo.gif) here once recorded -->

1. **Add the MCP server.**

   ```sh
   claude mcp add --transport http pointless https://app.pointless.show/mcp
   ```

   For Claude Desktop / claude.ai: Settings → Connectors → Add custom
   connector, paste `https://app.pointless.show/mcp`.

2. **Sign in.** On first connect your client opens a Google sign-in (any Google
   account works, nothing to paste).

3. **Create.** Ask in plain language: _"make me a deck on our Q3 results."_ The
   LLM authors a self-contained HTML presentation and hands back a share link
   anyone can open.

4. **Manage in the UI.** Open [app.pointless.show](https://app.pointless.show) to
   browse your presentations with live thumbnails, copy or password-protect
   share links, and delete what you no longer need.

Want your own instance instead? See [Run it](#run-it).

## How it works

- **One stateless server.** Express + PostgreSQL + a built-in web UI. It keeps
  no local state; point `DATABASE_URL` at any Postgres.
- **A presentation is one self-contained HTML document** with CSS and JS inline.
  The `get_design_guide` tool hands the LLM the authoring contract:
  self-containment, viewport rules, house palettes, and interaction patterns.
- **Sandboxed by construction.** Documents are served under a CSP sandbox and
  embedded via `<iframe sandbox>` in an opaque origin: no cookies, no API
  access, no reach into the app or other presentations.
- **Share links** are unguessable 128-bit tokens (`/d/<token>`); re-publishing
  after edits keeps the same link. Decks can be password-protected (scrypt-hashed
  at rest).
- **MCP endpoint at `/mcp`** (Streamable HTTP). Tools: `get_design_guide`,
  `create_presentation`, `set_html`, `get_presentation`, `list_presentations`,
  `publish`.

## Run it

The app is stateless and needs a PostgreSQL database (`DATABASE_URL`). The
quickest way to run both together is Docker Compose:

```sh
docker compose up --build
# app on http://localhost:3000, Postgres alongside it
```

**Run a published image.** Releases are on the GitHub Container Registry,
multi-arch (`amd64` + `arm64`), signed, and SBOM-attested. Run a pinned version
against any Postgres:

```sh
docker run -d -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@your-db-host:5432/pointless \
  -e DATABASE_SSL=true \
  -e BASE_URL=https://pointless.yourcompany.com \
  ghcr.io/moorjani-ajay/pointless:0.5.3
```

Pin by immutable digest (`@sha256:<digest>`) for reproducible deploys, and
verify the [cosign](https://docs.sigstore.dev) signature before running:

```sh
cosign verify ghcr.io/moorjani-ajay/pointless:0.5.3 \
  --certificate-identity-regexp '^https://github.com/moorjani-ajay/pointless/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

To build it yourself instead: `docker build -t pointless . && docker run -d -p
3000:3000 -e DATABASE_URL=… pointless`. A running instance reports
`{ version, commit }` at `GET /version`.

### Configuration

| Variable               | Required   | Purpose                                                                                                 |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | yes        | Postgres connection string, e.g. `postgres://user:pass@host:5432/pointless`.                            |
| `DATABASE_SSL`         | no         | Set to `true` for hosted databases that require TLS (e.g. RDS).                                         |
| `BASE_URL`             | no\*       | Origin that publish links are minted with; omit to derive from the request host. Required under `oidc`. |
| `ADMIN_TOKEN`          | no         | Gates the operator surface; required once the server is reachable beyond loopback.                      |
| `PORT`                 | no         | Port to listen on (default `3000`).                                                                     |
| `AUTH_MODE`            | no         | `oidc` enables SSO login + the OAuth server; unset/`off` keeps the server open (default).               |
| `MCP_REQUIRE_AUTH`     | no         | Under `oidc`, defaults **on** (`/mcp` requires a token); set `false` to leave `/mcp` open.              |
| `OIDC_ISSUER`          | under oidc | IdP issuer URL, e.g. `https://accounts.google.com`.                                                     |
| `OIDC_CLIENT_ID`       | under oidc | OAuth client id from the IdP.                                                                           |
| `OIDC_CLIENT_SECRET`   | under oidc | OAuth client secret from the IdP.                                                                       |
| `SESSION_SECRET`       | under oidc | ≥32-char random string that signs the session cookie (`openssl rand -hex 32`).                          |
| `OIDC_SCOPES`          | no         | Space-separated; default `openid email profile`.                                                        |
| `OIDC_ALLOWED_DOMAINS` | no         | Comma list of email domains allowed to sign in; empty ⇒ any authenticated user.                         |
| `OIDC_ADMIN_EMAILS`    | no         | Comma list of emails granted the admin role (see and manage every deck).                                |

Set `ADMIN_TOKEN` whenever the server is reachable beyond loopback, then open
`https://your-host/?admin=<token>` once to store it locally. Unset, the operator
routes are reachable only from `127.0.0.1`, so a purely local instance needs no
config. Share links (and their passwords) are unaffected either way.

### SSO / OIDC (optional)

By default Pointless is open (or `ADMIN_TOKEN`-gated). Set `AUTH_MODE=oidc` to
require single sign-on with any OpenID Connect provider (Google Workspace,
Microsoft Entra ID, Okta, Keycloak, Auth0). It turns on three things:

- **Dashboard login** for the operator UI.
- **MCP auth.** `/mcp` becomes an OAuth 2.1 resource server; clients discover it
  and complete a browser sign-in, no token to paste. On by default under `oidc`;
  set `MCP_REQUIRE_AUTH=false` to opt out.
- **Per-user ownership.** Decks are private to their creator; `OIDC_ADMIN_EMAILS`
  see and manage everything.

Pointless is its own OAuth 2.1 authorization server and federates the human
login to your IdP, so every provider works through one code path. Restrict who
may sign in with `OIDC_ALLOWED_DOMAINS`.

Google Workspace example (set the redirect URI to `https://your-host/auth/callback`):

```sh
AUTH_MODE=oidc
BASE_URL=https://your-host
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=<client id>
OIDC_CLIENT_SECRET=<client secret>
SESSION_SECRET=$(openssl rand -hex 32)
OIDC_ALLOWED_DOMAINS=yourcompany.com
OIDC_ADMIN_EMAILS=you@yourcompany.com
```

For other providers, point `OIDC_ISSUER` at the tenant/realm issuer (Entra:
`https://login.microsoftonline.com/<tenant-id>/v2.0`).

### Connect an LLM

Point any MCP client at your server's `/mcp` endpoint. For Claude Code:

```sh
claude mcp add --transport http pointless https://your-host/mcp
```

For Claude Desktop / claude.ai: Settings → Connectors → Add custom connector,
paste the endpoint URL. Then just ask for a presentation. With SSO enabled, the
client prompts a browser sign-in on first connect.

## Development

```sh
pnpm install
pnpm --filter @pointless/shared build
docker compose up -d db    # local Postgres on :5432
export DATABASE_URL=postgres://pointless:pointless@localhost:5432/pointless
pnpm dev           # server on :3000 (tsx watch)
pnpm dev:web       # vite dev server on :5173, proxies /api + /raw + /mcp
```

Tests spin up a throwaway Postgres via
[testcontainers](https://testcontainers.com) (Docker required); run them with
`pnpm test`. Repo layout: `server/` (Express, MCP, PostgreSQL), `web/` (React
landing + viewer host), `shared/` (types), `examples/` (sample presentations).

## Security model

Built for deployment inside a trusted network. Authoring happens over MCP;
anyone with a share link can view that presentation unless it carries a password.
The operator surface (listing/deleting decks and preview-by-id, which bypasses
the share password) is `ADMIN_TOKEN`-gated when set and loopback-only otherwise,
so it is never exposed unguarded. Presentation documents may contain arbitrary
JavaScript (that is the point), so they always run isolated behind a CSP sandbox
with an opaque origin. For per-creator auth beyond a trusted network, set
`AUTH_MODE=oidc` to require SSO, which gates both the dashboard and `/mcp` and
scopes each deck to its creator.

## License

MIT
