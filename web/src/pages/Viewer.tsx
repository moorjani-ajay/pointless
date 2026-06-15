import type { PresentationSummary } from '@pointless/shared';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getDeck, getSharedDeck, unlockDeck } from '../api';

/** Untrusted presentation documents always render through this sandbox. */
const SANDBOX = 'allow-scripts allow-popups';

function PasswordGate({
  onSubmit,
  error,
}: {
  onSubmit: (pw: string) => void;
  error: string | null;
}) {
  const [pw, setPw] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(pw);
  };
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1 className="gate-title">
          This presentation is locked<span className="dot">.</span>
        </h1>
        <p className="gate-help">Enter the password you were given with the link.</p>
        <div className="gate-row">
          <input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Password"
            aria-label="Presentation password"
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
  const [meta, setMeta] = useState<PresentationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(() =>
    token ? sessionStorage.getItem(`pointless-key-${token}`) : null
  );

  useEffect(() => {
    const load = kind === 'preview' ? getDeck(id!) : getSharedDeck(token!, viewKey);
    load.then(
      (m) => {
        setMeta(m);
        setLocked(false);
        document.title = m.title;
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
      setGateError(
        e instanceof ApiError && e.status === 401
          ? 'Wrong password — try again.'
          : (e as Error).message
      );
    }
  };

  if (locked) return <PasswordGate onSubmit={(pw) => void tryUnlock(pw)} error={gateError} />;

  if (error) {
    return (
      <div className="viewer-message">
        <p>
          {error === 'Not found' ? 'This presentation does not exist or is not published.' : error}
        </p>
        {kind === 'preview' && <Link to="/">Back to home</Link>}
      </div>
    );
  }

  if (!meta) return <div className="viewer-message">Loading…</div>;

  if (meta.htmlSize === 0) {
    return (
      <div className="viewer-message">
        <p>This presentation has no content yet — ask your LLM to send it with set_html.</p>
        {kind === 'preview' && <Link to="/">Back to home</Link>}
      </div>
    );
  }

  const src =
    kind === 'preview'
      ? `/raw/deck/${meta.id}`
      : `/raw/${meta.shareToken}${viewKey ? `?k=${encodeURIComponent(viewKey)}` : ''}`;

  return (
    <div className="doc-host">
      {kind === 'preview' && (
        <Link className="doc-back" to="/" title="Back to Pointless" aria-label="Back to Pointless">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="doc-back-label">Back</span>
        </Link>
      )}
      <iframe
        className="doc-frame"
        title={meta.title}
        src={src}
        sandbox={SANDBOX}
        allowFullScreen
      />
    </div>
  );
}
