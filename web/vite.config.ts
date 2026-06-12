import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/themes': backend,
      '/mcp': backend,
      '/print': backend,
      '^/d/.*\\.pdf$': backend,
    },
  },
});
