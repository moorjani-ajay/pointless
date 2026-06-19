import type { PresentationSummary } from '@pointless/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteDeck, listDecks } from '../api';
import { withAdmin } from '../admin';

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
  const origin = window.location.origin;
  const mcpUrl = `${origin}/mcp`;
  const claudeCodeCmd = `claude mcp add --transport http pointless ${mcpUrl}`;

  const refresh = () => listDecks().then(setDecks, (e: Error) => setError(e.message));
  useEffect(() => void refresh(), []);

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
          {hasDecks && <a href="#decks">Your presentations</a>}
          <a href="#connect">Setup</a>
          <span className="topbar-tag">self-hosted · MIT</span>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <p className="overline rise d1">An MCP server for presentations</p>
          <h1 className="display rise d2">
            Your next deck is a<br />
            <em>
              conversation<span className="dot">.</span>
            </em>
          </h1>
          <p className="lede rise d3">
            Connect Claude — or any LLM that speaks MCP — and describe what you need. It designs a
            bespoke interactive presentation: its own typography, motion, and navigation, not a
            template. You get a link to share. PowerPoint never gets opened.
          </p>
          <div className="hero-cta rise d4">
            <CopyButton className="btn btn-primary" text={mcpUrl} label="Copy MCP endpoint" />
            <code className="endpoint">{mcpUrl}</code>
          </div>
        </div>
        <div className="hero-art rise d3" aria-hidden="true">
          <div className="mock mock-back">
            <div className="mock-bar">
              <i />
              <i />
              <i />
            </div>
            <div className="mock-body mock-dark">
              <div className="mock-kicker" />
              <div className="mock-headline" />
              <div className="mock-rule" />
              <div className="mock-line" />
            </div>
          </div>
          <div className="mock mock-front">
            <div className="mock-bar">
              <i />
              <i />
              <i />
            </div>
            <div className="mock-body mock-light">
              <div className="mock-kicker" />
              <div className="mock-headline" />
              <div className="mock-rule" />
              <div className="mock-tiles">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="steps" id="connect">
        <h2 className="section-title">
          <span className="section-no">Connect in three steps</span>
        </h2>
        <ol className="step-grid">
          <li className="step">
            <span className="step-no">01</span>
            <h3>Connect</h3>
            <p>Add this server to your Claude as a connector.</p>
            <div className="snippet">
              <span className="snippet-label">Claude Code</span>
              <code>{claudeCodeCmd}</code>
              <CopyButton className="btn btn-small" text={claudeCodeCmd} label="Copy" />
            </div>
            <div className="snippet">
              <span className="snippet-label">Claude Desktop & claude.ai</span>
              <code className="snippet-prose">
                Settings → Connectors → Add custom connector → paste the endpoint URL
              </code>
              <CopyButton className="btn btn-small" text={mcpUrl} label="Copy URL" />
            </div>
          </li>
          <li className="step">
            <span className="step-no">02</span>
            <h3>Ask</h3>
            <p>
              Brief it like a designer, not a typist. Claude reads the design guide and builds the
              whole experience — layout, motion, navigation.
            </p>
            <blockquote className="prompt-example">
              "Turn these Q3 numbers into a dark, editorial presentation — full-screen sections,
              keyboard navigation, end on the hiring ask."
            </blockquote>
          </li>
          <li className="step">
            <span className="step-no">03</span>
            <h3>Share</h3>
            <p>
              Claude publishes and replies with the link. It opens full-screen in any browser, on
              any device — no software, no attachments.
            </p>
            <p className="step-fine">
              Need it private? Ask for a password — viewers are prompted before it opens.
            </p>
          </li>
        </ol>
      </section>

      <section className="aesthetics">
        <h2 className="section-title">
          <span className="section-no">Not slides — experiences</span>
        </h2>
        <p className="section-lede">
          Every presentation is a self-contained interactive page, sandboxed for safety. Quiz decks
          with timers, flip-card readers, scrollytelling reports, full-screen steppers — whatever
          the content calls for, in whatever aesthetic you ask for.
        </p>
        <div className="aesthetic-row">
          <div className="aesthetic-chip">
            <strong>Editorial</strong>
            <span>paper, serifs, hairlines</span>
          </div>
          <div className="aesthetic-chip">
            <strong>After Hours</strong>
            <span>deep blues, gold, glow</span>
          </div>
          <div className="aesthetic-chip">
            <strong>Brutalist</strong>
            <span>mono, raw contrast</span>
          </div>
          <div className="aesthetic-chip">
            <strong>Yours</strong>
            <span>just describe it</span>
          </div>
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
        <span>
          pointless<span className="dot">.</span> — presentations, minus the Power
        </span>
        <span>Open source · MIT · Your content lives on this server, nowhere else</span>
      </footer>
    </div>
  );
}
