import type { PresentationSummary } from '@pointless/shared';
import { adminHeaders } from './admin';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function get<T>(url: string, headers?: Record<string, string>): Promise<T> {
  // Pass init only when there's something to send so callers without auth
  // headers issue a plain single-arg fetch.
  const res =
    headers && Object.keys(headers).length ? await fetch(url, { headers }) : await fetch(url);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      res.status === 404 ? 'Not found' : `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export const listDecks = () => get<PresentationSummary[]>('/api/decks', adminHeaders());
export const getDeck = (id: string) => get<PresentationSummary>(`/api/decks/${id}`, adminHeaders());

export const getSharedDeck = (token: string, key?: string | null) =>
  get<PresentationSummary>(`/api/shared/${token}${key ? `?k=${encodeURIComponent(key)}` : ''}`);

export async function unlockDeck(token: string, password: string): Promise<string | null> {
  const res = await fetch(`/api/shared/${token}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.status === 401) throw new ApiError(401, 'Wrong password');
  if (!res.ok) throw new ApiError(res.status, `Unlock failed (${res.status})`);
  const data = (await res.json()) as { key: string | null };
  return data.key;
}

export async function deleteDeck(id: string): Promise<void> {
  const res = await fetch(`/api/decks/${id}`, { method: 'DELETE', headers: adminHeaders() });
  if (!res.ok) throw new ApiError(res.status, `Delete failed (${res.status})`);
}
