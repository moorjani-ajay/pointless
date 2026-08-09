# Contributing to Pointless

Thanks for your interest in improving Pointless! This guide covers how to get set
up and what we expect before a change can be merged.

## Project layout

Pointless is a pnpm monorepo:

| Package             | What it is                                           |
| ------------------- | ---------------------------------------------------- |
| `@pointless/shared` | Types shared between server and web                  |
| `@pointless/server` | Express + MCP server, Postgres storage, share links  |
| `@pointless/web`    | React + Vite single-page app (the viewer/manager UI) |

## Getting started

Prerequisites: **Node 24+** and **pnpm 11+** (`corepack enable` will give you pnpm).

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
Husky hooks run on commit: `pre-commit` auto-formats and lints staged files
(lint-staged), and `commit-msg` checks the message with commitlint (see below).

### Where to add tests

- **Pure logic** (auth hashing, view keys, DB helpers) → unit tests in `server/test`.
- **MCP tools** → drive `buildMcpServer` over an in-memory transport (`server/test/mcp.test.ts`).
- **HTTP behaviour** (routes, the password gate, CSP headers) → Supertest against
  `createApp()` (`server/test/http.test.ts`).
- **Front-end data layer** → mock `fetch` (`web/test/api.test.ts`).

## Commit messages

Pointless uses [Conventional Commits](https://www.conventionalcommits.org/). The
format is enforced locally by a Husky `commit-msg` hook (commitlint) and in CI on
the pull-request title — because PRs are squash-merged, **the PR title becomes the
commit subject**, so it must conform too.

```
<type>[optional scope]: <description>
```

Common types: `feat` (new feature → minor bump), `fix` (bug fix → patch bump),
`perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`. Breaking changes add a
`!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer.

These types and markers drive automated releases: release-please reads the merged
commits to choose the next version and assemble `CHANGELOG.md`. See
[`RELEASING.md`](RELEASING.md) for the release process and what counts as a
breaking change for this project.

Examples:

```
feat: add a GET /version identity endpoint
fix(auth): reject empty share-link passwords
docs: document the Docker image in the README
feat!: rename the publish MCP tool to share
```

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
