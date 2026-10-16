import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In dev, /api and /ws are proxied to the Node API so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Plotly is large: keep it in its own chunk, loaded only on the Analytics page
        manualChunks: { plotly: ['plotly.js-dist-min'], recharts: ['recharts'] },
      },
    },
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
