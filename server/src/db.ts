import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import type { Presentation, PresentationSummary } from '@pointless/shared';

let _pool: Pool | null = null;

// The pool is created lazily on first use so that DATABASE_URL can be set just
// before the store is exercised (the server sets it from the environment; tests
// point it at a throwaway Postgres). endPool() resets it so it re-opens later.
function pool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is required (e.g. postgres://user:pass@host:5432/pointless). ' +
          'Run a Postgres container (see docker-compose.yml) or point at a hosted instance.'
      );
    }
    const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    _pool = new Pool({ connectionString, ssl });
  }
  return _pool;
}

/** Create the schema if it does not exist. Call once on startup before serving. */
export async function init(): Promise<void> {
  await pool().query(`
    CREATE TABLE IF NOT EXISTS decks (
      id            text PRIMARY KEY,
      title         text NOT NULL,
      html          text NOT NULL DEFAULT '',
      share_token   text NOT NULL UNIQUE,
      published     boolean NOT NULL DEFAULT false,
      password_hash text,
      owner         text,
      created_at    text NOT NULL,
      updated_at    text NOT NULL
    );
  `);
}

/** Close the pool. Tests call this for clean teardown; it re-opens lazily. */
export async function endPool(): Promise<void> {
  if (_pool) {
    const p = _pool;
    _pool = null;
    await p.end();
  }
}

const newId = () => randomBytes(6).toString('base64url');
const newShareToken = () => randomBytes(16).toString('base64url');
const now = () => new Date().toISOString();

interface DeckRow {
  id: string;
  title: string;
  html: string;
  share_token: string;
  published: boolean;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
}

function toSummary(row: DeckRow): PresentationSummary {
  return {
    id: row.id,
    title: row.title,
    published: row.published,
    protected: row.password_hash != null,
    shareToken: row.share_token,
    htmlSize: Buffer.byteLength(row.html, 'utf8'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const toFull = (row: DeckRow): Presentation => ({ ...toSummary(row), html: row.html });

export async function createPresentation(title: string): Promise<Presentation> {
  const id = newId();
  const ts = now();
  await pool().query(
    'INSERT INTO decks (id, title, share_token, published, created_at, updated_at) VALUES ($1, $2, $3, false, $4, $5)',
    [id, title, newShareToken(), ts, ts]
  );
  return (await getPresentation(id))!;
}

export async function getPresentation(id: string): Promise<Presentation | null> {
  const { rows } = await pool().query<DeckRow>('SELECT * FROM decks WHERE id = $1', [id]);
  return rows[0] ? toFull(rows[0]) : null;
}

export async function getPresentationByToken(token: string): Promise<Presentation | null> {
  const { rows } = await pool().query<DeckRow>('SELECT * FROM decks WHERE share_token = $1', [
    token,
  ]);
  return rows[0] ? toFull(rows[0]) : null;
}

export async function listPresentations(): Promise<PresentationSummary[]> {
  const { rows } = await pool().query<DeckRow>('SELECT * FROM decks ORDER BY updated_at DESC');
  return rows.map(toSummary);
}

export async function setHtml(id: string, html: string, title?: string): Promise<boolean> {
  const { rows } = await pool().query<{ title: string }>('SELECT title FROM decks WHERE id = $1', [
    id,
  ]);
  if (!rows[0]) return false;
  await pool().query('UPDATE decks SET html = $1, title = $2, updated_at = $3 WHERE id = $4', [
    html,
    title ?? rows[0].title,
    now(),
    id,
  ]);
  return true;
}

export async function deletePresentation(id: string): Promise<boolean> {
  const res = await pool().query('DELETE FROM decks WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Publish a presentation. `passwordHash` semantics: undefined = leave
 * protection unchanged, null = remove protection, string = set it.
 */
export async function publishPresentation(
  id: string,
  passwordHash?: string | null
): Promise<Presentation | null> {
  if (passwordHash === undefined) {
    await pool().query('UPDATE decks SET published = true, updated_at = $1 WHERE id = $2', [
      now(),
      id,
    ]);
  } else {
    await pool().query(
      'UPDATE decks SET published = true, password_hash = $1, updated_at = $2 WHERE id = $3',
      [passwordHash, now(), id]
    );
  }
  return getPresentation(id);
}

export async function getPasswordHash(shareToken: string): Promise<string | null> {
  const { rows } = await pool().query<{ password_hash: string | null }>(
    'SELECT password_hash FROM decks WHERE share_token = $1',
    [shareToken]
  );
  return rows[0]?.password_hash ?? null;
}
