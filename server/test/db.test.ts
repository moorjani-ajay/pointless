import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '../src/db';
import { hashPassword } from '../src/auth';

beforeEach(() => {
  // The setup file gives this suite its own DATA_DIR, but tests within the
  // file share one db — start each from a clean slate.
  for (const p of store.listPresentations()) store.deletePresentation(p.id);
});

describe('createPresentation', () => {
  it('starts unpublished, unprotected and empty, with a unique share token', () => {
    const a = store.createPresentation('Deck A');
    const b = store.createPresentation('Deck B');
    expect(a.title).toBe('Deck A');
    expect(a.published).toBe(false);
    expect(a.protected).toBe(false);
    expect(a.html).toBe('');
    expect(a.htmlSize).toBe(0);
    expect(a.shareToken).toBeTruthy();
    expect(a.shareToken).not.toBe(b.shareToken);
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toBe(a.updatedAt);
  });
});

describe('lookups', () => {
  it('fetches by id and by share token, and returns null for misses', () => {
    const p = store.createPresentation('Find me');
    expect(store.getPresentation(p.id)?.id).toBe(p.id);
    expect(store.getPresentationByToken(p.shareToken)?.id).toBe(p.id);
    expect(store.getPresentation('nope')).toBeNull();
    expect(store.getPresentationByToken('nope')).toBeNull();
  });

  it('lists presentations newest-updated first', () => {
    const a = store.createPresentation('first');
    const b = store.createPresentation('second');
    store.setHtml(a.id, '<html>touched last</html>');
    const ids = store.listPresentations().map((p) => p.id);
    expect(ids).toEqual([a.id, b.id]);
  });
});

describe('setHtml', () => {
  it('stores the document and reports its byte size (multibyte aware)', () => {
    const p = store.createPresentation('Sizes');
    expect(store.setHtml(p.id, '<html>café</html>')).toBe(true);
    const updated = store.getPresentation(p.id)!;
    expect(updated.html).toBe('<html>café</html>');
    // "café" is 5 bytes in UTF-8, not 4 chars.
    expect(updated.htmlSize).toBe(Buffer.byteLength('<html>café</html>', 'utf8'));
  });

  it('keeps the existing title when none is supplied, and updates it when given', () => {
    const p = store.createPresentation('Original');
    store.setHtml(p.id, '<html></html>');
    expect(store.getPresentation(p.id)!.title).toBe('Original');
    store.setHtml(p.id, '<html></html>', 'Renamed');
    expect(store.getPresentation(p.id)!.title).toBe('Renamed');
  });

  it('returns false for an unknown id', () => {
    expect(store.setHtml('ghost', '<html></html>')).toBe(false);
  });
});

describe('deletePresentation', () => {
  it('returns true when a row was removed, false otherwise', () => {
    const p = store.createPresentation('Doomed');
    expect(store.deletePresentation(p.id)).toBe(true);
    expect(store.getPresentation(p.id)).toBeNull();
    expect(store.deletePresentation(p.id)).toBe(false);
  });
});

describe('publishPresentation password semantics', () => {
  it('string hash sets protection and publishes', () => {
    const p = store.createPresentation('Protected');
    const published = store.publishPresentation(p.id, hashPassword('pw'))!;
    expect(published.published).toBe(true);
    expect(published.protected).toBe(true);
    expect(store.getPasswordHash(p.shareToken)).toBeTruthy();
  });

  it('undefined leaves existing protection unchanged', () => {
    const p = store.createPresentation('Keep');
    store.publishPresentation(p.id, hashPassword('pw'));
    const again = store.publishPresentation(p.id, undefined)!;
    expect(again.protected).toBe(true);
    expect(again.published).toBe(true);
  });

  it('null removes protection', () => {
    const p = store.createPresentation('Unlock');
    store.publishPresentation(p.id, hashPassword('pw'));
    const cleared = store.publishPresentation(p.id, null)!;
    expect(cleared.protected).toBe(false);
    expect(store.getPasswordHash(p.shareToken)).toBeNull();
  });
});

describe('getPasswordHash', () => {
  it('returns null for an unprotected or unknown deck', () => {
    const p = store.createPresentation('Open');
    expect(store.getPasswordHash(p.shareToken)).toBeNull();
    expect(store.getPasswordHash('unknown-token')).toBeNull();
  });
});
