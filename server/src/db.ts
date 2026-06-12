import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Deck, DeckSummary, Slide, ThemeName } from '@pointless/shared';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'pointless.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS decks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    theme       TEXT NOT NULL DEFAULT 'boardroom',
    share_token TEXT NOT NULL UNIQUE,
    published   INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    owner       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS slides (
    id         TEXT PRIMARY KEY,
    deck_id    TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    html       TEXT NOT NULL,
    notes      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_slides_deck ON slides(deck_id, position);
`);

// Migration for databases created before password protection existed.
const deckColumns = (db.pragma('table_info(decks)') as { name: string }[]).map((c) => c.name);
if (!deckColumns.includes('password_hash')) {
  db.exec('ALTER TABLE decks ADD COLUMN password_hash TEXT');
}

const newId = () => randomBytes(6).toString('base64url');
const newShareToken = () => randomBytes(16).toString('base64url');
const now = () => new Date().toISOString();

interface DeckRow {
  id: string;
  title: string;
  theme: ThemeName;
  share_token: string;
  published: number;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
  slide_count: number;
  first_slide_html: string | null;
}

interface SlideRow {
  id: string;
  deck_id: string;
  position: number;
  html: string;
  notes: string | null;
}

function toSummary(row: DeckRow): DeckSummary {
  return {
    id: row.id,
    title: row.title,
    theme: row.theme,
    published: row.published === 1,
    protected: row.password_hash != null,
    shareToken: row.share_token,
    slideCount: row.slide_count,
    firstSlideHtml: row.first_slide_html,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSlide(row: SlideRow): Slide {
  return { id: row.id, position: row.position, html: row.html, notes: row.notes };
}

const SUMMARY_SQL = `
  SELECT d.*,
    (SELECT COUNT(*) FROM slides s WHERE s.deck_id = d.id) AS slide_count,
    (SELECT html FROM slides s WHERE s.deck_id = d.id ORDER BY position LIMIT 1) AS first_slide_html
  FROM decks d`;

function touchDeck(deckId: string): void {
  db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(now(), deckId);
}

export function createDeck(title: string, theme: ThemeName): Deck {
  const id = newId();
  const ts = now();
  db.prepare(
    'INSERT INTO decks (id, title, theme, share_token, published, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run(id, title, theme, newShareToken(), ts, ts);
  return getDeck(id)!;
}

export function getDeck(id: string): Deck | null {
  const row = db.prepare(`${SUMMARY_SQL} WHERE d.id = ?`).get(id) as DeckRow | undefined;
  if (!row) return null;
  const slides = db
    .prepare('SELECT * FROM slides WHERE deck_id = ? ORDER BY position')
    .all(id) as SlideRow[];
  return { ...toSummary(row), slides: slides.map(toSlide) };
}

export function getDeckByToken(token: string): Deck | null {
  const row = db.prepare(`${SUMMARY_SQL} WHERE d.share_token = ?`).get(token) as DeckRow | undefined;
  return row ? getDeck(row.id) : null;
}

export function listDecks(): DeckSummary[] {
  const rows = db.prepare(`${SUMMARY_SQL} ORDER BY d.updated_at DESC`).all() as DeckRow[];
  return rows.map(toSummary);
}

export function deleteDeck(id: string): boolean {
  return db.prepare('DELETE FROM decks WHERE id = ?').run(id).changes > 0;
}

export const addSlide = db.transaction(
  (deckId: string, html: string, notes: string | null, position?: number): Slide => {
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM slides WHERE deck_id = ?').get(deckId) as { n: number }
    ).n;
    const pos = position && position >= 1 && position <= count ? position : count + 1;
    db.prepare(
      'UPDATE slides SET position = position + 1 WHERE deck_id = ? AND position >= ?'
    ).run(deckId, pos);
    const id = newId();
    const ts = now();
    db.prepare(
      'INSERT INTO slides (id, deck_id, position, html, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, deckId, pos, html, notes, ts, ts);
    touchDeck(deckId);
    return { id, position: pos, html, notes };
  }
);

export function getSlide(slideId: string): (Slide & { deckId: string }) | null {
  const row = db.prepare('SELECT * FROM slides WHERE id = ?').get(slideId) as SlideRow | undefined;
  return row ? { ...toSlide(row), deckId: row.deck_id } : null;
}

export function updateSlide(slideId: string, html?: string, notes?: string | null): boolean {
  const slide = getSlide(slideId);
  if (!slide) return false;
  db.prepare('UPDATE slides SET html = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    html ?? slide.html,
    notes === undefined ? slide.notes : notes,
    now(),
    slideId
  );
  touchDeck(slide.deckId);
  return true;
}

export const deleteSlide = db.transaction((slideId: string): boolean => {
  const slide = getSlide(slideId);
  if (!slide) return false;
  db.prepare('DELETE FROM slides WHERE id = ?').run(slideId);
  db.prepare(
    'UPDATE slides SET position = position - 1 WHERE deck_id = ? AND position > ?'
  ).run(slide.deckId, slide.position);
  touchDeck(slide.deckId);
  return true;
});

/** Reorder a deck's slides. `slideIds` must be exactly the deck's slide ids in the new order. */
export const reorderSlides = db.transaction((deckId: string, slideIds: string[]): string | null => {
  const current = db
    .prepare('SELECT id FROM slides WHERE deck_id = ?')
    .all(deckId) as { id: string }[];
  const currentIds = new Set(current.map((r) => r.id));
  if (slideIds.length !== currentIds.size || !slideIds.every((id) => currentIds.has(id))) {
    return `slide_ids must contain exactly the deck's ${currentIds.size} slide id(s), each once`;
  }
  // Two passes to avoid transient unique-position collisions if a constraint is added later.
  const offset = db.prepare('UPDATE slides SET position = position + 10000 WHERE deck_id = ?');
  offset.run(deckId);
  const set = db.prepare('UPDATE slides SET position = ? WHERE id = ?');
  slideIds.forEach((id, i) => set.run(i + 1, id));
  touchDeck(deckId);
  return null;
});

export function setTheme(deckId: string, theme: ThemeName): boolean {
  const changed = db.prepare('UPDATE decks SET theme = ?, updated_at = ? WHERE id = ?')
    .run(theme, now(), deckId).changes;
  return changed > 0;
}

/**
 * Publish a deck. `passwordHash` semantics: undefined = leave protection
 * unchanged, null = remove protection, string = set it.
 */
export function publishDeck(deckId: string, passwordHash?: string | null): Deck | null {
  if (passwordHash === undefined) {
    db.prepare('UPDATE decks SET published = 1, updated_at = ? WHERE id = ?').run(now(), deckId);
  } else {
    db.prepare('UPDATE decks SET published = 1, password_hash = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, now(), deckId);
  }
  return getDeck(deckId);
}

export function getPasswordHash(shareToken: string): string | null {
  const row = db.prepare('SELECT password_hash FROM decks WHERE share_token = ?').get(shareToken) as
    | { password_hash: string | null }
    | undefined;
  return row?.password_hash ?? null;
}
