import type { Deck } from '@pointless/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDeck, getSharedDeck } from '../api';
import { SlideCanvas } from '../components/SlideCanvas';

function useThemeCss(theme: string | undefined) {
  useEffect(() => {
    if (!theme) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/themes/${theme}.css`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [theme]);
}

const initialIndex = () => {
  const n = parseInt(window.location.hash.slice(1), 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : 0;
};

export function Viewer({ kind }: { kind: 'preview' | 'shared' }) {
  const { id, token } = useParams();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(initialIndex);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    const load = kind === 'preview' ? getDeck(id!) : getSharedDeck(token!);
    load.then(setDeck, (e: Error) => setError(e.message));
  }, [kind, id, token]);

  useThemeCss(deck?.theme);

  const count = deck?.slides.length ?? 0;

  const goTo = useCallback(
    (i: number) => {
      if (count === 0) return;
      const next = Math.max(0, Math.min(count - 1, i));
      setIndex(next);
      window.history.replaceState(null, '', `#${next + 1}`);
    },
    [count]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          goTo(index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          goTo(index - 1);
          break;
        case 'Home':
          goTo(0);
          break;
        case 'End':
          goTo(count - 1);
          break;
        case 'f':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
          break;
        case 'n':
          setShowNotes((v) => !v);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, count]);

  if (error) {
    return (
      <div className="viewer-message">
        <p>{error === 'Not found' ? 'This deck does not exist or is not published.' : error}</p>
        {kind === 'preview' && <Link to="/">Back to decks</Link>}
      </div>
    );
  }

  if (!deck) return <div className="viewer-message">Loading…</div>;

  const slide = deck.slides[Math.min(index, count - 1)];

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <div className="viewer-bar-side">
          {kind === 'preview' && (
            <Link className="btn btn-quiet" to="/">
              ← Decks
            </Link>
          )}
          <span className="viewer-title">{deck.title}</span>
        </div>
        <div className="viewer-bar-side">
          <span className="viewer-count">
            {count === 0 ? '0 / 0' : `${index + 1} / ${count}`}
          </span>
          <button className="btn btn-quiet" onClick={() => setShowNotes((v) => !v)}>
            Notes
          </button>
          {deck.published && (
            <a className="btn btn-quiet" href={`/d/${deck.shareToken}.pdf`}>
              PDF
            </a>
          )}
        </div>
      </header>

      <div className="viewer-stage" onClick={() => goTo(index + 1)}>
        {count === 0 ? (
          <div className="viewer-message">This deck has no slides yet.</div>
        ) : (
          <SlideCanvas html={slide.html} />
        )}
      </div>

      {showNotes && (
        <aside className="viewer-notes">
          <strong>Notes</strong>
          <p>{slide?.notes?.trim() ? slide.notes : 'No notes for this slide.'}</p>
        </aside>
      )}

      {count > 1 && (
        <>
          <button
            className="nav-arrow nav-prev"
            aria-label="Previous slide"
            onClick={(e) => {
              e.stopPropagation();
              goTo(index - 1);
            }}
          >
            ‹
          </button>
          <button
            className="nav-arrow nav-next"
            aria-label="Next slide"
            onClick={(e) => {
              e.stopPropagation();
              goTo(index + 1);
            }}
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
