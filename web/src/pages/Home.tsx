import type { PresentationSummary } from '@pointless/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteDeck, getVersion, listDecks, type VersionInfo } from '../api';
import { withAdmin } from '../admin';
import { logout, useAuth } from '../auth';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function CopyButton({
  text,
  label,
  className = 'btn',
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

/** Scaled, inert, sandboxed live preview of a presentation document. */
function DocThumb({ deck }: { deck: PresentationSummary }) {
  if (deck.htmlSize === 0) return <span className="deck-thumb-empty">No content yet</span>;
  return (
    <div className="thumb-clip" aria-hidden="true">
      <iframe
        className="thumb-frame"
        src={withAdmin(`/raw/deck/${deck.id}`)}
        sandbox="allow-scripts"
        tabIndex={-1}
        loading="lazy"
        title=""
      />
    </div>
  );
}

function DeckCard({
  deck,
  onDelete,
}: {
  deck: PresentationSummary;
  onDelete: (d: PresentationSummary) => void;
}) {
  const shareUrl = `${window.location.origin}/d/${deck.shareToken}`;
  return (
    <li className="deck-card">
      <Link className="deck-thumb" to={`/deck/${deck.id}`} aria-label={`Open ${deck.title}`}>
        <DocThumb deck={deck} />
      </Link>
      <div className="deck-body">
        <h3 className="deck-title">
          <Link to={`/deck/${deck.id}`}>{deck.title}</Link>
        </h3>
        <p className="deck-meta">
          {fmtDate(deck.updatedAt)} · {Math.max(1, Math.round(deck.htmlSize / 1024))} KB ·{' '}
          {deck.published ? (deck.protected ? 'published 🔒' : 'published') : 'draft'}
        </p>
        <div className="deck-actions">
          {deck.published && (
            <CopyButton className="btn btn-small" text={shareUrl} label="Copy link" />
          )}
          <button className="btn btn-small btn-danger" onClick={() => onDelete(deck)}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

export function Home() {
  const [decks, setDecks] = useState<PresentationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const auth = useAuth();
  const origin = window.location.origin;
  const mcpUrl = `${origin}/mcp`;
  const claudeCodeCmd = `claude mcp add --transport http pointless ${mcpUrl}`;

  const refresh = () => listDecks().then(setDecks, (e: Error) => setError(e.message));
  useEffect(() => void refresh(), []);

  // Non-critical chrome: if the probe fails, the footer just omits the version.
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);

  const remove = async (deck: PresentationSummary) => {
    if (!window.confirm(`Delete "${deck.title}"? This cannot be undone.`)) return;
    await deleteDeck(deck.id);
    void refresh();
  };

  const hasDecks = !!decks && decks.length > 0;

  return (
    <div className="landing">
      <nav className="topbar rise">
        <span className="wordmark-sm">
          pointless<span className="dot">.</span>
        </span>
        <div className="topbar-right">
          {auth.status === 'authed' ? (
            <span className="user-chip">
              <span className="user-name">{auth.user.email ?? auth.user.name ?? 'Signed in'}</span>
              <button className="btn btn-small" onClick={() => void logout()}>
                Sign out
              </button>
            </span>
          ) : (
            <span className="topbar-tag">self-hosted · MIT</span>
          )}
        </div>
      </nav>

      <section className="connect" aria-label="Connect a client">
        <span className="connect-label">Connect a client</span>
        <div className="connect-value">
          <code>{mcpUrl}</code>
          <CopyButton className="btn btn-small" text={mcpUrl} label="Copy MCP endpoint" />
        </div>
        <div className="connect-value">
          <code>{claudeCodeCmd}</code>
          <CopyButton className="btn btn-small" text={claudeCodeCmd} label="Copy" />
        </div>
      </section>

      <section className="decks" id="decks">
        <h2 className="section-title">
          <span className="section-no">Your presentations</span>
        </h2>
        {error && <p className="notice">Could not load presentations: {error}</p>}
        {decks && decks.length === 0 && (
          <div className="empty">
            <p className="empty-title">
              Nothing here yet<span className="dot">.</span> Pointless, even.
            </p>
            <p className="empty-help">Connect Claude above and ask it to make you something.</p>
          </div>
        )}
        {hasDecks && (
          <ul className="deck-grid">
            {decks!.map((deck) => (
              <DeckCard key={deck.id} deck={deck} onDelete={(d) => void remove(d)} />
            ))}
          </ul>
        )}
      </section>

      <footer className="footer">
        <span>Open source · MIT</span>
        {version && (
          <span className="footer-version">
            v{version.version}
            {version.commit !== 'unknown' && ` · ${version.commit.slice(0, 7)}`}
          </span>
        )}
      </footer>
    </div>
  );
}
