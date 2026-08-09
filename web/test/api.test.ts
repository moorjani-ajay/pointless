import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  deleteDeck,
  getDeck,
  getSharedDeck,
  getVersion,
  listDecks,
  unlockDeck,
} from '../src/api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listDecks / getDeck', () => {
  it('GETs the decks endpoint and returns the parsed body', async () => {
    const fetchFn = mockFetch(200, [{ id: 'a' }]);
    await expect(listDecks()).resolves.toEqual([{ id: 'a' }]);
    expect(fetchFn).toHaveBeenCalledWith('/api/decks');
  });

  it('throws a 404 ApiError with a friendly message', async () => {
    mockFetch(404, {});
    await expect(getDeck('missing')).rejects.toBeInstanceOf(ApiError);
    await expect(getDeck('missing')).rejects.toMatchObject({ status: 404, message: 'Not found' });
  });
});

describe('getSharedDeck', () => {
  it('omits the key param when no key is given', async () => {
    const fetchFn = mockFetch(200, { id: 'x' });
    await getSharedDeck('tok');
    expect(fetchFn).toHaveBeenCalledWith('/api/shared/tok');
  });

  it('url-encodes the key when present', async () => {
    const fetchFn = mockFetch(200, { id: 'x' });
    await getSharedDeck('tok', 'a/b+c');
    expect(fetchFn).toHaveBeenCalledWith('/api/shared/tok?k=a%2Fb%2Bc');
  });
});

describe('unlockDeck', () => {
  it('returns the key on success', async () => {
    mockFetch(200, { key: 'view-key' });
    await expect(unlockDeck('tok', 'pw')).resolves.toBe('view-key');
  });

  it('maps a 401 to a "Wrong password" ApiError', async () => {
    mockFetch(401, {});
    await expect(unlockDeck('tok', 'bad')).rejects.toMatchObject({
      status: 401,
      message: 'Wrong password',
    });
  });
});

describe('getVersion', () => {
  it('GETs the version endpoint and returns the parsed body', async () => {
    const fetchFn = mockFetch(200, { version: '0.3.0', commit: 'abc1234' });
    await expect(getVersion()).resolves.toEqual({ version: '0.3.0', commit: 'abc1234' });
    expect(fetchFn).toHaveBeenCalledWith('/version');
  });
});

describe('deleteDeck', () => {
  it('resolves on a 204', async () => {
    mockFetch(204, null);
    await expect(deleteDeck('id')).resolves.toBeUndefined();
  });

  it('throws when the server rejects the delete', async () => {
    mockFetch(500, {});
    await expect(deleteDeck('id')).rejects.toBeInstanceOf(ApiError);
  });
});
