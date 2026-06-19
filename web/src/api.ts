import type { PresentationSummary } from '@pointless/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      res.status === 404 ? 'Not found' : `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export const listDecks = () => get<PresentationSummary[]>('/api/decks');
export const getDeck = (id: string) => get<PresentationSummary>(`/api/decks/${id}`);

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
  const res = await fetch(`/api/decks/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, `Delete failed (${res.status})`);
}
