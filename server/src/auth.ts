import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * Proof-of-unlock for protected decks. Derivable only with the stored hash
 * (server-side secret), so handing it to an unlocked client reveals nothing.
 */
export function viewKey(passwordHash: string, shareToken: string): string {
  return createHash('sha256').update(`${passwordHash}:${shareToken}`).digest('hex');
}
