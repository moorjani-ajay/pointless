/**
 * Operator-token plumbing for the manager UI. Deck management and preview hit
 * the server's operator surface, which requires ADMIN_TOKEN when the server is
 * exposed beyond loopback. The operator opens the app once as `…/?admin=<token>`;
 * we stash the token and strip it from the visible URL.
 */
const STORAGE_KEY = 'pointless.adminToken';

const hasBrowserStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

/** Capture `?admin=<token>` from the URL once, persist it, and clean the URL. */
export function captureAdminToken(): void {
  if (!hasBrowserStorage()) return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('admin');
  if (!token) return;
  window.localStorage.setItem(STORAGE_KEY, token);
  params.delete('admin');
  const qs = params.toString();
  window.history.replaceState(
    {},
    '',
    window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
  );
}

export function getAdminToken(): string | null {
  return hasBrowserStorage() ? window.localStorage.getItem(STORAGE_KEY) : null;
}

/** Auth header for operator fetches; empty when no token is configured. */
export function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Append the token to operator URLs used where headers can't be set (iframes). */
export function withAdmin(url: string): string {
  const token = getAdminToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}admin=${encodeURIComponent(token)}`;
}
