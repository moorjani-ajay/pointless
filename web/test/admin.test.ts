import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminHeaders, captureAdminToken, getAdminToken, withAdmin } from '../src/admin';

/** Minimal browser-ish window for the token helpers (web tests run under node). */
function fakeWindow(search: string) {
  const store: Record<string, string> = {};
  const win = {
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
    location: { search, pathname: '/', hash: '' },
    history: { replaceState: vi.fn() },
  };
  vi.stubGlobal('window', win);
  return win;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin token helpers', () => {
  it('no-ops cleanly when there is no token', () => {
    fakeWindow('');
    expect(getAdminToken()).toBeNull();
    expect(adminHeaders()).toEqual({});
    expect(withAdmin('/raw/deck/1')).toBe('/raw/deck/1');
  });

  it('captures ?admin=, persists it, strips it from the URL, and applies it', () => {
    const win = fakeWindow('?admin=tok123');
    captureAdminToken();
    expect(win.history.replaceState).toHaveBeenCalled();
    expect(getAdminToken()).toBe('tok123');
    expect(adminHeaders()).toEqual({ Authorization: 'Bearer tok123' });
    expect(withAdmin('/raw/deck/1')).toBe('/raw/deck/1?admin=tok123');
    expect(withAdmin('/raw/deck/1?x=1')).toBe('/raw/deck/1?x=1&admin=tok123');
  });
});
