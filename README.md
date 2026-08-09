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

- **One stateless server.** Express + PostgreSQL + a built-in web UI. The app
  keeps no local state — point `DATABASE_URL` at a Postgres container or a
  hosted instance (RDS, etc.).
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

The app is stateless and needs a PostgreSQL database, configured with
`DATABASE_URL`. The quickest way to run both together is Docker Compose:

```sh
docker compose up --build
# app on http://localhost:3000, Postgres running alongside it
```

### Run a published image

Released images are published to the GitHub Container Registry, built multi-arch
(`linux/amd64` + `linux/arm64`), signed, and SBOM-attested. Run a pinned version
against any Postgres:

```sh
docker run -d -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@your-db-host:5432/pointless \
  -e DATABASE_SSL=true \
  -e BASE_URL=https://pointless.yourcompany.com \
  ghcr.io/moorjani-ajay/pointless:0.3.0
```

For reproducible deploys, pin by immutable digest instead of a moving tag:

```sh
docker run -d -p 3000:3000 -e DATABASE_URL=… \
  ghcr.io/moorjani-ajay/pointless@sha256:<digest>
```

Every release is signed with [cosign](https://docs.sigstore.dev) keyless — verify
it before running:

```sh
cosign verify ghcr.io/moorjani-ajay/pointless:0.3.0 \
  --certificate-identity-regexp '^https://github.com/moorjani-ajay/pointless/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

A running instance reports what it is at `GET /version` (`{ version, commit }`).

### Build it yourself

No registry needed — build the image locally and run it the same way:

```sh
docker build -t pointless .
docker run -d -p 3000:3000 -e DATABASE_URL=… pointless
```

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

`ADMIN_TOKEN` gates the operator surface (deck list/delete and preview-by-id).
Set it whenever the server is reachable beyond loopback, then open the manager
UI once as `https://your-host/?admin=<token>` — the token is stored locally and
attached to operator requests thereafter. When unset, the operator routes are
reachable only from `127.0.0.1`, so a purely local instance needs no config.
Share links (and their optional passwords) are unaffected either way.

### SSO / OIDC (optional)

By default Pointless is open (or `ADMIN_TOKEN`-gated). Set `AUTH_MODE=oidc` to
require **single sign-on** with any OpenID Connect provider — Google Workspace,
Microsoft Entra ID, Okta, Keycloak, Auth0, etc. This turns on three things:

- **Dashboard login** — a "Sign in with SSO" screen for the operator UI.
- **MCP endpoint auth** — the `/mcp` endpoint becomes an OAuth 2.1 resource
  server; MCP clients discover it and complete a browser sign-in (no token to
  paste). Gated by default under `oidc`; set `MCP_REQUIRE_AUTH=false` to opt out.
- **Per-user ownership** — decks are private to their creator; `OIDC_ADMIN_EMAILS`
  see and manage everything.

The server acts as its own OAuth 2.1 authorization server and federates the
human login to your IdP, so heterogeneous providers work through one code path —
no per-provider plugin. Restrict who may sign in with `OIDC_ALLOWED_DOMAINS`.

**Google Workspace** — in Google Cloud Console → _Credentials → Create OAuth
client ID → Web application_, set the redirect URI to
`https://your-host/auth/callback`, and (to restrict to your org) set the OAuth
consent screen to _Internal_. Then:

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

**Microsoft Entra ID** — register a web app with the same redirect URI and use
`OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0`. The rest is
identical. (Okta/Keycloak/Auth0: point `OIDC_ISSUER` at the tenant/realm issuer.)

### Connect an LLM

Point any MCP client at `http://your-host:3000/mcp`. For Claude Code:

```sh
claude mcp add --transport http pointless http://your-host:3000/mcp
```

For Claude Desktop / claude.ai: Settings → Connectors → Add custom connector
→ paste the endpoint URL. Then just ask for a presentation. If the server has
SSO enabled (`AUTH_MODE=oidc`), the client prompts a browser sign-in on first
connect.

## Development

```sh
pnpm install
pnpm --filter @pointless/shared build
docker compose up -d db    # local Postgres on :5432
export DATABASE_URL=postgres://pointless:pointless@localhost:5432/pointless
pnpm dev           # server on :3000 (tsx watch)
pnpm dev:web       # vite dev server on :5173, proxies /api + /raw + /mcp
```

Tests spin up a throwaway Postgres via [testcontainers](https://testcontainers.com)
(Docker required); run them with `pnpm test`.

Repo layout: `server/` (Express, MCP, PostgreSQL), `web/` (React
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
iframe with an opaque origin. For per-creator auth beyond a trusted network, set
`AUTH_MODE=oidc` to require SSO (see [SSO / OIDC](#sso--oidc-optional)) — this
gates the dashboard and the `/mcp` endpoint and scopes each deck to its creator.

## License

MIT
