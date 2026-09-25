import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // INTERVIEW NOTE: Why proxy /api to the backend instead of calling Gemini directly?
    // The Gemini API key must never be in the browser — it would be visible in DevTools.
    // Vite's proxy rewrites /api/* requests to localhost:3001 transparently.
    // The React code just calls fetch('/api/plan') — it never knows the backend URL.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
