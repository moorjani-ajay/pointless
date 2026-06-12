import type { Deck, DeckSummary } from '@pointless/shared';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const listDecks = () => get<DeckSummary[]>('/api/decks');
export const getDeck = (id: string) => get<Deck>(`/api/decks/${id}`);
export const getSharedDeck = (token: string) => get<Deck>(`/api/shared/${token}`);

export async function deleteDeck(id: string): Promise<void> {
  const res = await fetch(`/api/decks/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
