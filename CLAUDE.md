# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pointless is a self-hosted presentation tool driven over MCP: an LLM client connects to `/mcp` and authors presentations as complete, self-contained interactive HTML documents, published at unguessable share links (`/d/<token>`). pnpm monorepo, Node 24+, TypeScript ESM throughout.

## Commands

```sh
pnpm install
pnpm --filter @pointless/shared build   # required once before dev/typecheck (server & web import built types)
docker compose up -d db                 # local Postgres on :5432
export DATABASE_URL=postgres://pointless:pointless@localhost:5432/pointless
pnpm dev                                # server on :3000 (tsx watch)
pnpm dev:web                            # Vite on :5173, proxies /api /raw /mcp to :3000
```

Checks (all must pass for a PR; `pnpm run check` bundles the first four):

- `pnpm run format:check` / `pnpm run format` — Prettier
- `pnpm run lint` — ESLint
- `pnpm run typecheck` — `tsc --noEmit` per package
- `pnpm test` — Vitest; **requires Docker** (testcontainers starts a throwaway Postgres)
- `pnpm e2e` — Playwright; builds all packages and boots the real server; needs Postgres on :5432 (or `DATABASE_URL`)

Single test file: `pnpm vitest run server/test/mcp.test.ts` (add `-t 'name'` for one test). Server test files run serially (`fileParallelism: false`) because they share one database.

Commits/PR titles must follow Conventional Commits — enforced by Husky commitlint locally and on the PR title in CI (PRs are squash-merged, so the title becomes the commit subject). release-please derives versions/CHANGELOG from these.

## Architecture

Three workspace packages: `shared/` (types only, must be built first), `server/` (`@pointless/server`), `web/` (`@pointless/web`, React SPA served as static files by the server in production).

### Server (`server/src/`)

- `index.ts` is only `init()` + `createApp().listen()`; everything testable lives in `app.ts` (`createApp()` builds the Express app without binding a port — tests drive it with Supertest).
- `mcp.ts` — `buildMcpServer(baseUrl)` registers the six tools (`get_design_guide`, `create_presentation`, `set_html`, `get_presentation`, `list_presentations`, `publish`). The `/mcp` endpoint is **stateless**: a fresh McpServer + StreamableHTTPServerTransport per POST, no sessions. `designguide.ts` holds the authoring contract returned by `get_design_guide`.
- `db.ts` — single `decks` table in Postgres; schema is created by `init()` on startup (no migration framework). The pg pool opens lazily on first query so `DATABASE_URL` can be set late (tests rely on this). `publishPresentation` passwordHash semantics: `undefined` = unchanged, `null` = remove, string = set.
- `auth.ts` — scrypt password hashing, constant-time comparison, and `viewKey(hash, token)`: the proof-of-unlock a client earns via `POST /api/shared/:token/unlock` and then passes as `?k=` to view a protected deck.

### Security model (load-bearing — changes here need extra care and tests)

- Presentation HTML is **untrusted and scripts are allowed by design**. It is only ever served with `DOC_CSP` (`sandbox allow-scripts …`, in `app.ts`) and embedded via `<iframe sandbox>`, giving it an opaque origin. Never serve deck HTML without that header.
- Two access surfaces: **share links** (128-bit token + optional password) and the **operator surface** (`/api/decks*`, `/raw/deck/:id` — bypasses share passwords), gated by `requireAdmin`: Bearer/`?admin=` token when `ADMIN_TOKEN` is set, loopback-only otherwise.
- Unlock attempts are strictly rate-limited (`unlockLimiter`); a general limiter covers everything except `/mcp` and `/version`.

### Web (`web/src/`)

Routes: `/` (Home: onboarding + operator deck grid), `/deck/:id` (preview, operator-only), `/d/:token` (shared viewer). `admin.ts` captures `?admin=<token>` into localStorage at startup and attaches it to operator requests (header, or query param for iframes).

### Tests

- Server suites share one testcontainers Postgres started in `server/test/globalSetup.ts`; `setup.ts` points `DATABASE_URL` at it per suite. Override the image with `TEST_POSTGRES_IMAGE`.
- Where to add tests: pure logic → `server/test` unit tests; MCP tools → drive `buildMcpServer` over an in-memory transport (`mcp.test.ts`); HTTP behavior/CSP/password gate → Supertest against `createApp()` (`http.test.ts`); front-end data layer → mock `fetch` (`web/test/api.test.ts`).
- E2E (`e2e/`): HTTP/MCP-only specs (`api|mcp`) run once under the `api` project; rendering specs run across Chromium/Firefox/WebKit + a mobile viewport.
