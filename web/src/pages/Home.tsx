import type { DeckSummary } from '@pointless/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteDeck, listDecks } from '../api';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-quiet"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

export function Home() {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mcpUrl = `${window.location.origin}/mcp`;

  const refresh = () => listDecks().then(setDecks, (e: Error) => setError(e.message));
  useEffect(() => void refresh(), []);

  const remove = async (deck: DeckSummary) => {
    if (!window.confirm(`Delete "${deck.title}"? This cannot be undone.`)) return;
    await deleteDeck(deck.id);
    void refresh();
  };

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            pointless<span className="wordmark-dot">.</span>
          </h1>
          <p className="tagline">presentations, minus the Power</p>
        </div>
        <div className="connect">
          <span className="connect-label">MCP endpoint</span>
          <code className="connect-url">{mcpUrl}</code>
          <CopyButton text={mcpUrl} label="Copy" />
        </div>
      </header>

      <main>
        {error && <p className="notice">Could not load decks: {error}</p>}
        {decks && decks.length === 0 && (
          <div className="empty">
            <p className="empty-title">Nothing here yet. Pointless, even.</p>
            <p className="empty-help">
              Connect your LLM tool to <code>{mcpUrl}</code> and ask it to make you a deck.
            </p>
          </div>
        )}
        {decks && decks.length > 0 && (
          <ul className="deck-grid">
            {decks.map((deck) => (
              <li key={deck.id} className="deck-card">
                <Link className="deck-link" to={`/deck/${deck.id}`}>
                  <span className={deck.published ? 'pip pip-live' : 'pip'} />
                  <h2 className="deck-title">{deck.title}</h2>
                  <p className="deck-meta">
                    {deck.slideCount} slide{deck.slideCount === 1 ? '' : 's'} · updated{' '}
                    {fmtDate(deck.updatedAt)} · {deck.published ? 'published' : 'draft'}
                  </p>
                </Link>
                <div className="deck-actions">
                  {deck.published && (
                    <>
                      <CopyButton
                        text={`${window.location.origin}/d/${deck.shareToken}`}
                        label="Copy link"
                      />
                      <a className="btn btn-quiet" href={`/d/${deck.shareToken}.pdf`}>
                        PDF
                      </a>
                    </>
                  )}
                  <button className="btn btn-quiet btn-danger" onClick={() => void remove(deck)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
