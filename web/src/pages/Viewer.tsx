import type { Deck } from '@pointless/shared';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getDeck, getSharedDeck, unlockDeck } from '../api';
import { SlideCanvas } from '../components/SlideCanvas';

const initialIndex = () => {
  const n = parseInt(window.location.hash.slice(1), 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : 0;
};

function PasswordGate({ onSubmit, error }: { onSubmit: (pw: string) => void; error: string | null }) {
  const [pw, setPw] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(pw);
  };
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1 className="gate-title">
          This deck is locked<span className="dot">.</span>
        </h1>
        <p className="gate-help">Enter the password you were given with the link.</p>
        <div className="gate-row">
          <input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Password"
            aria-label="Deck password"
          />
          <button className="btn btn-primary" type="submit">
            Open
          </button>
        </div>
        {error && <p className="gate-error">{error}</p>}
      </form>
    </div>
  );
}

export function Viewer({ kind }: { kind: 'preview' | 'shared' }) {
  const { id, token } = useParams();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(() =>
    token ? sessionStorage.getItem(`pointless-key-${token}`) : null
  );
  const [index, setIndex] = useState(initialIndex);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    const load = kind === 'preview' ? getDeck(id!) : getSharedDeck(token!, viewKey);
    load.then(
      (d) => {
        setDeck(d);
        setLocked(false);
      },
      (e: Error) => {
        if (e instanceof ApiError && e.status === 401) setLocked(true);
        else setError(e.message);
      }
    );
  }, [kind, id, token, viewKey]);

  const tryUnlock = async (password: string) => {
    try {
      const key = await unlockDeck(token!, password);
      if (key) sessionStorage.setItem(`pointless-key-${token}`, key);
      setGateError(null);
      setViewKey(key);
    } catch (e) {
      setGateError(e instanceof ApiError && e.status === 401 ? 'Wrong password — try again.' : (e as Error).message);
    }
  };

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
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
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

  if (locked) return <PasswordGate onSubmit={(pw) => void tryUnlock(pw)} error={gateError} />;

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
  const pdfHref = `/d/${deck.shareToken}.pdf${viewKey ? `?k=${encodeURIComponent(viewKey)}` : ''}`;

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <div className="viewer-bar-side">
          {kind === 'preview' && (
            <Link className="btn btn-small" to="/">
              ← Decks
            </Link>
          )}
          <span className="viewer-title">{deck.title}</span>
        </div>
        <div className="viewer-bar-side">
          <span className="viewer-count">{count === 0 ? '0 / 0' : `${index + 1} / ${count}`}</span>
          <button className="btn btn-small" onClick={() => setShowNotes((v) => !v)}>
            Notes
          </button>
          {deck.published && (
            <a className="btn btn-small" href={pdfHref}>
              PDF
            </a>
          )}
        </div>
      </header>

      <div className="viewer-stage" onClick={() => goTo(index + 1)}>
        {count === 0 ? (
          <div className="viewer-message">This deck has no slides yet.</div>
        ) : (
          <SlideCanvas html={slide.html} theme={deck.theme} />
        )}
      </div>

      {count > 0 && (
        <div className="viewer-progress" aria-hidden="true">
          <div className="viewer-progress-fill" style={{ width: `${((index + 1) / count) * 100}%` }} />
        </div>
      )}

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
