import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '../src/db';
import { hashPassword } from '../src/auth';

beforeEach(async () => {
  // Tests within the file share one database — start each from a clean slate.
  for (const p of await store.listPresentations()) await store.deletePresentation(p.id);
});

describe('createPresentation', () => {
  it('starts unpublished, unprotected and empty, with a unique share token', async () => {
    const a = await store.createPresentation('Deck A');
    const b = await store.createPresentation('Deck B');
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
  it('fetches by id and by share token, and returns null for misses', async () => {
    const p = await store.createPresentation('Find me');
    expect((await store.getPresentation(p.id))?.id).toBe(p.id);
    expect((await store.getPresentationByToken(p.shareToken))?.id).toBe(p.id);
    expect(await store.getPresentation('nope')).toBeNull();
    expect(await store.getPresentationByToken('nope')).toBeNull();
  });

  it('lists presentations newest-updated first', async () => {
    const a = await store.createPresentation('first');
    const b = await store.createPresentation('second');
    await store.setHtml(a.id, '<html>touched last</html>');
    const ids = (await store.listPresentations()).map((p) => p.id);
    expect(ids).toEqual([a.id, b.id]);
  });
});

describe('setHtml', () => {
  it('stores the document and reports its byte size (multibyte aware)', async () => {
    const p = await store.createPresentation('Sizes');
    expect(await store.setHtml(p.id, '<html>café</html>')).toBe(true);
    const updated = (await store.getPresentation(p.id))!;
    expect(updated.html).toBe('<html>café</html>');
    // "café" is 5 bytes in UTF-8, not 4 chars.
    expect(updated.htmlSize).toBe(Buffer.byteLength('<html>café</html>', 'utf8'));
  });

  it('keeps the existing title when none is supplied, and updates it when given', async () => {
    const p = await store.createPresentation('Original');
    await store.setHtml(p.id, '<html></html>');
    expect((await store.getPresentation(p.id))!.title).toBe('Original');
    await store.setHtml(p.id, '<html></html>', 'Renamed');
    expect((await store.getPresentation(p.id))!.title).toBe('Renamed');
  });

  it('returns false for an unknown id', async () => {
    expect(await store.setHtml('ghost', '<html></html>')).toBe(false);
  });
});

describe('deletePresentation', () => {
  it('returns true when a row was removed, false otherwise', async () => {
    const p = await store.createPresentation('Doomed');
    expect(await store.deletePresentation(p.id)).toBe(true);
    expect(await store.getPresentation(p.id)).toBeNull();
    expect(await store.deletePresentation(p.id)).toBe(false);
  });
});

describe('publishPresentation password semantics', () => {
  it('string hash sets protection and publishes', async () => {
    const p = await store.createPresentation('Protected');
    const published = (await store.publishPresentation(p.id, hashPassword('pw')))!;
    expect(published.published).toBe(true);
    expect(published.protected).toBe(true);
    expect(await store.getPasswordHash(p.shareToken)).toBeTruthy();
  });

  it('undefined leaves existing protection unchanged', async () => {
    const p = await store.createPresentation('Keep');
    await store.publishPresentation(p.id, hashPassword('pw'));
    const again = (await store.publishPresentation(p.id, undefined))!;
    expect(again.protected).toBe(true);
    expect(again.published).toBe(true);
  });

  it('null removes protection', async () => {
    const p = await store.createPresentation('Unlock');
    await store.publishPresentation(p.id, hashPassword('pw'));
    const cleared = (await store.publishPresentation(p.id, null))!;
    expect(cleared.protected).toBe(false);
    expect(await store.getPasswordHash(p.shareToken)).toBeNull();
  });
});

describe('getPasswordHash', () => {
  it('returns null for an unprotected or unknown deck', async () => {
    const p = await store.createPresentation('Open');
    expect(await store.getPasswordHash(p.shareToken)).toBeNull();
    expect(await store.getPasswordHash('unknown-token')).toBeNull();
  });
});
