import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Client-side auth state for the operator dashboard.
 *
 * The server tells us the mode implicitly: `/auth/me` is only mounted when
 * AUTH_MODE=oidc, so a 404 means auth is disabled (open mode) and the dashboard
 * is reachable as before. A 200 with a body means signed in; a 200 with `null`
 * means OIDC is on but the visitor must sign in.
 *
 * Requests are same-origin, so the session cookie rides along by default — no
 * credentials/CORS handling needed.
 */
export interface Me {
  id: string;
  email: string | null;
  name: string | null;
  role: 'admin' | 'user';
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'open' } // auth disabled on the server
  | { status: 'authed'; user: Me }
  | { status: 'anon' }; // oidc on, not signed in

export async function fetchAuthState(): Promise<AuthState> {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return { status: 'open' }; // 404 ⇒ route not mounted ⇒ open mode
    const body = (await res.json()) as Me | null;
    return body ? { status: 'authed', user: body } : { status: 'anon' };
  } catch {
    return { status: 'open' };
  }
}

export function login(): void {
  window.location.assign('/auth/login');
}

export async function logout(): Promise<void> {
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } finally {
    window.location.assign('/');
  }
}

const AuthContext = createContext<AuthState>({ status: 'loading' });

export const useAuth = (): AuthState => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  useEffect(() => {
    void fetchAuthState().then(setState);
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
