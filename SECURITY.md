# Security Policy

## Supported versions

Pointless is pre-1.0. Only the **most recent minor release line** receives
security fixes; older versions are not patched. Upgrade to the latest release to
stay supported.

| Version             | Supported          |
| ------------------- | ------------------ |
| Latest `0.x` minor  | :white_check_mark: |
| Any earlier release | :x:                |

Once the project reaches `1.0.0`, this table will be updated with a concrete
supported-version window.

## Reporting a vulnerability

**Please do not open a public issue for security problems.** Report privately via
GitHub Security Advisories:

> https://github.com/moorjani-ajay/pointless/security/advisories/new

(Private vulnerability reporting is enabled for this repository.) Include a
description, affected version or commit, reproduction steps, and impact. If you
have a suggested fix, link a private fork or patch.

### What to expect

1. **Acknowledgement** of your report.
2. **Triage** — we confirm the issue and assess severity (CVSS).
3. **Embargoed fix** developed under the advisory; you are credited unless you
   prefer otherwise.
4. **Coordinated disclosure** — a patched release is cut (a signed image; see
   [RELEASING.md](RELEASING.md)), a CVE is requested where warranted, and the
   advisory is published.

Please give us a reasonable window to ship a fix before any public disclosure.

## Security model

Pointless is built for deployment **inside a trusted network**.

- **Presentations are untrusted HTML and may contain arbitrary JavaScript** —
  that is the product. They are therefore _always_ served under a strict CSP
  sandbox and embedded via `<iframe sandbox>` with an opaque origin: no cookies,
  no same-origin API access, no reach into the app or other presentations.
  Changes that touch the sandbox or the share-link auth deserve extra care and
  tests.
- **Share links** are unguessable 128-bit tokens; presentations may additionally
  be password-protected (scrypt-hashed at rest).
- **The operator surface** (deck list/delete, preview-by-id) is gated by
  `ADMIN_TOKEN` when set, and is loopback-only when unset — never exposed
  unguarded on a public host.

Released images are signed with [cosign](https://docs.sigstore.dev) keyless and
ship with an SBOM and build provenance; verify them before running (see the
README).
