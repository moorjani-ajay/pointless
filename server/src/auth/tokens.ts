import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque-token helpers shared by the OAuth provider (token minting/verification)
 * and the federation callback (authorization-code minting). Tokens are random,
 * prefixed for readability, and only ever stored/looked-up by their SHA-256
 * hash — the raw value never touches the database or logs.
 */

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Mint a random opaque token with a human-readable prefix (e.g. `pt_at_…`). */
export const mintOpaque = (prefix: string): string =>
  `${prefix}${randomBytes(32).toString('base64url')}`;
