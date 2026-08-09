# Releasing Pointless

Pointless ships as a single multi-arch Docker image
(`ghcr.io/moorjani-ajay/pointless`). Releases are automated with
[release-please](https://github.com/googleapis/release-please): you merge
[Conventional Commits](https://www.conventionalcommits.org/) to `main`, and a
standing "release PR" accumulates the next version bump and the changelog.
Merging that PR cuts the release and publishes the signed image. This document is
the maintainer runbook.

## TL;DR — cutting a release

1. Land changes on `main` as Conventional Commits. PRs are squash-merged, so the
   **PR title** must be conventional — the `Commit lint` check enforces it.
2. release-please opens/updates a PR titled `chore(main): release X.Y.Z`. Review
   the proposed version and the generated `CHANGELOG.md`.
3. **Merge the release PR.** That tags `vX.Y.Z`, creates the GitHub Release, and
   triggers the `publish` job, which runs the full quality gate and then builds,
   pushes, and signs the multi-arch image.
4. The release job's summary prints the image **digest** and a ready-to-run
   `cosign verify` command. That digest is what downstream deployments should
   pin.

Nothing is published from arbitrary `main` pushes — only a merged release PR
publishes a release image.

## Versioning

- **Scheme:** [SemVer 2.0.0](https://semver.org). The product has **one version**;
  the whole monorepo releases together (lockstep), never per-package.
- **Single source of truth:** the `version` in the root `package.json`.
  release-please keeps `server`, `shared`, and `web` `package.json` in lockstep
  via `extra-files` in `release-please-config.json`. Nothing else hardcodes a
  version — the running app derives it (build-arg → `POINTLESS_VERSION` →
  `server/src/version.ts`), exposes it at `GET /version` and in MCP
  `serverInfo`, and logs it at startup. A unit test asserts the MCP version
  matches `package.json` so the old drift cannot return.
- **How the bump is chosen** (from the merged commits since the last release):
  - `fix:` → **patch** (e.g. `0.3.0` → `0.3.1`)
  - `feat:` → **minor** (e.g. `0.3.0` → `0.4.0`)
  - `feat!:` / `BREAKING CHANGE:` → **minor while pre-1.0** (breaking changes do
    _not_ bump to `1.0.0` automatically; see below), **major** once `>= 1.0`.
- **Pre-1.0 policy (we are here):** while `0.x`, a **minor** bump may include
  breaking changes and a **patch** is fixes only. Treat every `0.x` minor as
  potentially breaking.

## What counts as a breaking change

For this product, a breaking change is a non-backwards-compatible change to any
of:

1. **The MCP tool contract** — tool names or their input/output schemas
   (`server/src/mcp.ts`).
2. **The share-link / token format** — `/d/<token>`, `/raw/...`.
3. **The env-var / config contract** — `DATABASE_URL`, `ADMIN_TOKEN`, `BASE_URL`,
   `DATABASE_SSL`, `PORT`.
4. **The HTTP API shape** — request/response contracts of the `/api/...` routes
   (and `/version`).
5. **A non-additive database schema change** — anything beyond additive
   `CREATE TABLE IF NOT EXISTS` (column drops/renames/type changes). Note: safe
   version-to-version schema evolution requires a migration runner, which is a
   prerequisite for declaring 1.0 stability and does not yet exist.

Mark such changes with `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer so the
changelog and version bump reflect them.

## Pre-releases (release candidates)

Cut an RC by forcing the version with a `Release-As:` footer on a commit merged to
`main`:

```
chore: prepare 1.0.0-rc.1

Release-As: 1.0.0-rc.1
```

release-please will propose that exact version. The publish pipeline pushes only
the `X.Y.Z-rc.N` tag for pre-releases — it **never** moves `latest` or the
floating `X` / `X.Y` tags (a tag containing a hyphen is treated as a
pre-release).

## Hotfixes

Trunk-based: a production bug is fixed with a `fix:` commit on `main`, which
release-please turns into a patch release. There are no maintenance branches yet
(see below), so there is no backport step today.

## Branching & tags

- **Trunk-based on `main`.** Tags are `vX.Y.Z`, created by release-please.
- **No maintenance branches yet.** When a real backport need appears (a security
  fix for an older line that cannot take `main`'s changes), cut a
  `release-X.Y` branch at that minor and cherry-pick fixes onto it — but do not
  build that machinery until it is actually needed.

## Signing & supply chain

- **Images** are signed with **cosign keyless** (Sigstore, via GitHub OIDC) in
  the release pipeline, and ship with an **SBOM** and **SLSA build provenance**.
  Consumers verify with the `cosign verify` command printed in the release
  summary and the README.
- **Tags** created by release-please are made by the GitHub Actions bot and show
  as verified on GitHub. For any **manual** local commits/tags you want
  independently verifiable, configure [`gitsign`](https://docs.sigstore.dev/)
  (keyless, no GPG key to manage).
- The Docker base image should stay **pinned by digest** and bumped by
  Dependabot; installs use `--frozen-lockfile`.

## One-time setup (do once)

- **Make the GHCR package public.** GHCR packages default to private. After the
  first publish, set `ghcr.io/moorjani-ajay/pointless` to **public** (GitHub →
  the package → Package settings → Change visibility) so OSS users and the deploy
  box can pull without auth.
- **Enable private vulnerability reporting** (Settings → Code security) so
  `SECURITY.md`'s report link works.

## Manual / recovery

- **Re-publish an existing tag** (e.g. a transient registry failure): run the
  `release` workflow via **workflow_dispatch** with the `tag_name` input
  (`vX.Y.Z`). It rebuilds from that tag and re-pushes/signs.

## Moving to 1.0

Hold `1.0.0` until **(a)** the MCP tool contract and the share-link/token format
are considered stable, and **(b)** a schema-migration runner exists so upgrades
between released versions are safe. When you cut `1.0.0`, state the stability
contract here (what is covered by SemVer and what is explicitly excluded), and
from then on breaking changes bump the **major**.
