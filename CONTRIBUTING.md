# Contributing to Pointless

Thanks for your interest in improving Pointless! This guide covers how to get set
up and what we expect before a change can be merged.

## Project layout

Pointless is a pnpm monorepo:

| Package             | What it is                                             |
| ------------------- | ------------------------------------------------------ |
| `@pointless/shared` | Types shared between server and web                    |
| `@pointless/server` | Express + MCP server, SQLite storage, share links, PDF |
| `@pointless/web`    | React + Vite single-page app (the viewer/manager UI)   |

## Getting started

Prerequisites: **Node 22+** and **pnpm 11+** (`corepack enable` will give you pnpm).

```bash
pnpm install
pnpm run build      # builds shared types first, then server + web
pnpm run dev        # runs the server with tsx watch
pnpm run dev:web    # runs the Vite dev server (separate terminal)
```

## Tests & checks

Everything a pull request must pass is bundled behind one command:

```bash
pnpm run check      # format:check + lint + typecheck + test
```

Or run the pieces individually:

| Command                  | What it does                                     |
| ------------------------ | ------------------------------------------------ |
| `pnpm run test`          | Vitest unit + integration tests (server and web) |
| `pnpm run test:coverage` | Tests with a V8 coverage report                  |
| `pnpm run e2e`           | Playwright smoke tests against the built app     |
| `pnpm run lint`          | ESLint                                           |
| `pnpm run format`        | Prettier (writes); `format:check` only verifies  |
| `pnpm run typecheck`     | `tsc --noEmit` across all packages               |

Tests live in each package's `test/` directory; end-to-end specs live in `e2e/`.
A pre-commit hook (Husky + lint-staged) auto-formats and lints staged files.

### Where to add tests

- **Pure logic** (auth hashing, view keys, DB helpers) → unit tests in `server/test`.
- **MCP tools** → drive `buildMcpServer` over an in-memory transport (`server/test/mcp.test.ts`).
- **HTTP behaviour** (routes, the password gate, CSP headers) → Supertest against
  `createApp()` (`server/test/http.test.ts`).
- **Front-end data layer** → mock `fetch` (`web/test/api.test.ts`).

## Pull requests

1. Branch off `main`.
2. Keep changes focused; add tests for new behaviour.
3. Make sure `pnpm run check` is green.
4. Fill in the PR template.

## Security

Found a vulnerability? Please **don't** open a public issue — use
[GitHub Security Advisories](https://github.com/moorjani-ajay/pointless/security/advisories/new).
Note that published presentations are untrusted HTML served only under a CSP
sandbox; changes that touch the sandbox or the share-link auth deserve extra care
and tests.
