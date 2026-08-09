import { describe, expect, it } from 'vitest';
import { hashPassword, safeEqual, verifyPassword, viewKey } from '../src/auth';

describe('safeEqual', () => {
  it('is true only for identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('is false for differing lengths instead of throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('stores a salt:hash pair', () => {
    const stored = hashPassword('correct horse');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('uses a fresh salt every call, so the same password hashes differently', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('verifies the right password', () => {
    const stored = hashPassword('s3cret');
    expect(verifyPassword('s3cret', stored)).toBe(true);
  });

  it('rejects the wrong password', () => {
    const stored = hashPassword('s3cret');
    expect(verifyPassword('guess', stored)).toBe(false);
  });

  it('rejects an empty / malformed stored value instead of throwing', () => {
    expect(verifyPassword('anything', '')).toBe(false);
    expect(verifyPassword('anything', 'no-colon-here')).toBe(false);
    expect(verifyPassword('anything', 'onlysalt:')).toBe(false);
  });
});

describe('viewKey', () => {
  const hash = hashPassword('pw');
  const token = 'share-token-abc';

  it('is deterministic for the same (hash, token)', () => {
    expect(viewKey(hash, token)).toBe(viewKey(hash, token));
  });

  it('is a sha256 hex digest, never the raw password hash', () => {
    const key = viewKey(hash, token);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toBe(hash);
  });

  it('changes when the share token changes', () => {
    expect(viewKey(hash, token)).not.toBe(viewKey(hash, 'other-token'));
  });

  it('changes when the password hash changes', () => {
    expect(viewKey(hash, token)).not.toBe(viewKey(hashPassword('pw'), token));
  });
});
