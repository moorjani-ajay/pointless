import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { Viewer } from './pages/Viewer';
import { captureAdminToken } from './admin';
import './styles.css';

// Persist an operator token passed as `?admin=` before the router reads the URL.
captureAdminToken();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/deck/:id" element={<Viewer kind="preview" />} />
        <Route path="/d/:token" element={<Viewer kind="shared" />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
