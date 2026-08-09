import React, { type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { Viewer } from './pages/Viewer';
import { Login } from './pages/Login';
import { AuthProvider, useAuth } from './auth';
import { captureAdminToken } from './admin';
import './styles.css';

// Persist an operator token passed as `?admin=` before the router reads the URL.
captureAdminToken();

/**
 * Gate the operator surface. In open mode (`status: 'open'`) this is a
 * pass-through; under OIDC it shows the sign-in screen until authenticated.
 * Public share links (`/d/:token`) are never gated.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') return null;
  if (auth.status === 'anon') return <Login />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route
            path="/deck/:id"
            element={
              <RequireAuth>
                <Viewer kind="preview" />
              </RequireAuth>
            }
          />
          <Route path="/d/:token" element={<Viewer kind="shared" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
