import type { DeckSummary } from '@pointless/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteDeck, listDecks } from '../api';
import { SlideCanvas } from '../components/SlideCanvas';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const HERO_SLIDE = `
  <div class="center">
    <p class="kicker">Q3 Business Review</p>
    <h1>Growth held. Costs didn't.</h1>
    <p class="subtitle">Finance · October 2026</p>
  </div>`;

const HERO_SLIDE_BACK = `
  <p class="kicker">Impact</p>
  <h2>Renewals</h2>
  <div class="fill" style="display:flex;align-items:center">
    <div class="stat-row">
      <div class="stat"><div class="stat-value">87%</div><div class="stat-label">renewal rate</div></div>
      <div class="stat"><div class="stat-value">$4.2M</div><div class="stat-label">renewed ARR</div></div>
    </div>
  </div>`;

const THEME_PREVIEWS: { name: string; label: string; blurb: string; html: string }[] = [
  {
    name: 'boardroom',
    label: 'Boardroom',
    blurb: 'Light, restrained, enterprise-friendly. The default.',
    html: `<p class="kicker">Where we are</p><h2>Three things changed</h2><hr class="divider">
      <div class="columns">
        <div class="col"><div class="card"><h3>Pricing</h3><p>New tiers shipped; ARPU up <strong class="accent">11%</strong>.</p></div></div>
        <div class="col"><div class="card"><h3>Churn</h3><p>Down to 2.1% after the revamp.</p></div></div>
      </div>`,
  },
  {
    name: 'midnight',
    label: 'Midnight',
    blurb: 'Dark, quiet, for low-light rooms and late demos.',
    html: `<div class="center"><p class="kicker">Roadmap</p><h1>Ship the boring thing first.</h1><p class="subtitle">Platform · H2 plan</p></div>`,
  },
];

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

function DeckCard({ deck, onDelete }: { deck: DeckSummary; onDelete: (d: DeckSummary) => void }) {
  const shareUrl = `${window.location.origin}/d/${deck.shareToken}`;
  return (
    <li className="deck-card">
      <Link className="deck-thumb" to={`/deck/${deck.id}`} aria-label={`Open ${deck.title}`}>
        {deck.firstSlideHtml ? (
          <SlideCanvas html={deck.firstSlideHtml} theme={deck.theme} />
        ) : (
          <span className="deck-thumb-empty">No slides yet</span>
        )}
      </Link>
      <div className="deck-body">
        <h3 className="deck-title">
          <Link to={`/deck/${deck.id}`}>{deck.title}</Link>
        </h3>
        <p className="deck-meta">
          {deck.slideCount} slide{deck.slideCount === 1 ? '' : 's'} · {fmtDate(deck.updatedAt)} ·{' '}
          {deck.published ? (deck.protected ? 'published 🔒' : 'published') : 'draft'}
        </p>
        <div className="deck-actions">
          {deck.published && (
            <>
              <CopyButton className="btn btn-small" text={shareUrl} label="Copy link" />
              {!deck.protected && (
                <a className="btn btn-small" href={`/d/${deck.shareToken}.pdf`}>
                  PDF
                </a>
              )}
            </>
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
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = window.location.origin;
  const mcpUrl = `${origin}/mcp`;
  const claudeCodeCmd = `claude mcp add --transport http pointless ${mcpUrl}`;

  const refresh = () => listDecks().then(setDecks, (e: Error) => setError(e.message));
  useEffect(() => void refresh(), []);

  const remove = async (deck: DeckSummary) => {
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
          {hasDecks && <a href="#decks">Your decks</a>}
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
            Connect Claude — or any LLM that speaks MCP — to this server and talk your slides into
            existence. When it's done, you get a link to share. PowerPoint never gets opened.
          </p>
          <div className="hero-cta rise d4">
            <CopyButton className="btn btn-primary" text={mcpUrl} label="Copy MCP endpoint" />
            <code className="endpoint">{mcpUrl}</code>
          </div>
        </div>
        <div className="hero-art rise d3" aria-hidden="true">
          <div className="hero-slide hero-slide-back">
            <SlideCanvas html={HERO_SLIDE_BACK} theme="midnight" />
          </div>
          <div className="hero-slide hero-slide-front">
            <SlideCanvas html={HERO_SLIDE} theme="boardroom" />
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
            <p>Describe the deck like you'd brief a colleague. Claude reads the style guide and designs the slides.</p>
            <blockquote className="prompt-example">
              "Make me a six-slide deck on the Q3 numbers — use the midnight theme, end with the
              hiring ask."
            </blockquote>
          </li>
          <li className="step">
            <span className="step-no">03</span>
            <h3>Share</h3>
            <p>
              Claude publishes automatically and replies with the link. Anyone can open it in a
              browser — present fullscreen, or download the PDF.
            </p>
            <p className="step-fine">
              Need it private? Ask for a password — viewers are prompted before the deck opens.
            </p>
          </li>
        </ol>
      </section>

      <section className="themes">
        <h2 className="section-title">
          <span className="section-no">Two themes, zero fiddling</span>
        </h2>
        <p className="section-lede">
          Slides are HTML on a fixed canvas, styled by a design system the LLM reads before it
          writes. Decks come out consistent no matter who — or what — made them.
        </p>
        <div className="theme-grid">
          {THEME_PREVIEWS.map((t) => (
            <figure key={t.name} className="theme-card">
              <div className="theme-preview">
                <SlideCanvas html={t.html} theme={t.name} />
              </div>
              <figcaption>
                <strong>{t.label}</strong>
                <span>{t.blurb}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="decks" id="decks">
        <h2 className="section-title">
          <span className="section-no">Your decks</span>
        </h2>
        {error && <p className="notice">Could not load decks: {error}</p>}
        {decks && decks.length === 0 && (
          <div className="empty">
            <p className="empty-title">
              Nothing here yet<span className="dot">.</span> Pointless, even.
            </p>
            <p className="empty-help">Connect Claude above and ask it to make you a deck.</p>
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
        <span>Open source · MIT · Decks live on this server, nowhere else</span>
      </footer>
    </div>
  );
}
