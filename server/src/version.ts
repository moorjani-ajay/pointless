import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The product version, resolved once at module load.
 *
 * Release images inject it at build time (`POINTLESS_VERSION` build-arg → env)
 * so a running container always reports the git tag it was cut from. For local
 * dev, tests, and any image built without the arg, it falls back to the
 * `version` in the server package.json — which release-please keeps lockstep
 * with the root package.json (the single source of truth). A leading `v` from
 * a tag ref (e.g. `v0.3.0`) is stripped so the value is always bare SemVer.
 */
function resolveVersion(): string {
  const injected = process.env.POINTLESS_VERSION?.trim();
  if (injected) return injected.replace(/^v/, '');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(HERE, '../package.json'), 'utf8')) as {
      version?: string;
    };
    if (pkg.version) return pkg.version;
  } catch {
    // No package.json next to the bundle — fall through to the sentinel.
  }
  return '0.0.0-unknown';
}

/** Bare SemVer string the product reports everywhere, e.g. `0.2.0`. */
export const VERSION = resolveVersion();

/** Git commit the build was cut from, or `unknown` outside a release build. */
export const COMMIT = process.env.POINTLESS_COMMIT?.trim() || 'unknown';
