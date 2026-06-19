import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Presentation, PresentationSummary } from '@pointless/shared';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'pointless.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS decks (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    html          TEXT NOT NULL DEFAULT '',
    share_token   TEXT NOT NULL UNIQUE,
    published     INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    owner         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
`);

// Migration from the slide-based era: presentations are single HTML documents now.
const deckColumns = (db.pragma('table_info(decks)') as { name: string }[]).map((c) => c.name);
if (!deckColumns.includes('html')) {
  db.exec("ALTER TABLE decks ADD COLUMN html TEXT NOT NULL DEFAULT ''");
}
if (!deckColumns.includes('password_hash')) {
  db.exec('ALTER TABLE decks ADD COLUMN password_hash TEXT');
}
db.exec('DROP TABLE IF EXISTS slides');

const newId = () => randomBytes(6).toString('base64url');
const newShareToken = () => randomBytes(16).toString('base64url');
const now = () => new Date().toISOString();

interface DeckRow {
  id: string;
  title: string;
  html: string;
  share_token: string;
  published: number;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
}

function toSummary(row: DeckRow): PresentationSummary {
  return {
    id: row.id,
    title: row.title,
    published: row.published === 1,
    protected: row.password_hash != null,
    shareToken: row.share_token,
    htmlSize: Buffer.byteLength(row.html, 'utf8'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const toFull = (row: DeckRow): Presentation => ({ ...toSummary(row), html: row.html });

export function createPresentation(title: string): Presentation {
  const id = newId();
  const ts = now();
  db.prepare(
    'INSERT INTO decks (id, title, share_token, published, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)'
  ).run(id, title, newShareToken(), ts, ts);
  return getPresentation(id)!;
}

export function getPresentation(id: string): Presentation | null {
  const row = db.prepare('SELECT * FROM decks WHERE id = ?').get(id) as DeckRow | undefined;
  return row ? toFull(row) : null;
}

export function getPresentationByToken(token: string): Presentation | null {
  const row = db.prepare('SELECT * FROM decks WHERE share_token = ?').get(token) as
    | DeckRow
    | undefined;
  return row ? toFull(row) : null;
}

export function listPresentations(): PresentationSummary[] {
  const rows = db.prepare('SELECT * FROM decks ORDER BY updated_at DESC').all() as DeckRow[];
  return rows.map(toSummary);
}

export function setHtml(id: string, html: string, title?: string): boolean {
  const row = db.prepare('SELECT title FROM decks WHERE id = ?').get(id) as
    | { title: string }
    | undefined;
  if (!row) return false;
  db.prepare('UPDATE decks SET html = ?, title = ?, updated_at = ? WHERE id = ?').run(
    html,
    title ?? row.title,
    now(),
    id
  );
  return true;
}

export function deletePresentation(id: string): boolean {
  return db.prepare('DELETE FROM decks WHERE id = ?').run(id).changes > 0;
}

/**
 * Publish a presentation. `passwordHash` semantics: undefined = leave
 * protection unchanged, null = remove protection, string = set it.
 */
export function publishPresentation(id: string, passwordHash?: string | null): Presentation | null {
  if (passwordHash === undefined) {
    db.prepare('UPDATE decks SET published = 1, updated_at = ? WHERE id = ?').run(now(), id);
  } else {
    db.prepare(
      'UPDATE decks SET published = 1, password_hash = ?, updated_at = ? WHERE id = ?'
    ).run(passwordHash, now(), id);
  }
  return getPresentation(id);
}

export function getPasswordHash(shareToken: string): string | null {
  const row = db
    .prepare('SELECT password_hash FROM decks WHERE share_token = ?')
    .get(shareToken) as { password_hash: string | null } | undefined;
  return row?.password_hash ?? null;
}
