import { login } from '../auth';

/** Shown on the operator dashboard when OIDC is enabled but no one is signed in. */
export function Login() {
  return (
    <div className="login-screen">
      <div className="login-card rise">
        <span className="wordmark-sm">
          pointless<span className="dot">.</span>
        </span>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">
          This Pointless instance is private. Sign in with your organization account to create and
          manage presentations.
        </p>
        <button className="btn btn-primary login-btn" onClick={login}>
          Sign in with SSO
        </button>
        <p className="login-fine">You’ll be redirected to your identity provider.</p>
      </div>
    </div>
  );
}
