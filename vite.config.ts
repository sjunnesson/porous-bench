import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    // The Resident relay doesn't accept calls from browser pages, so Bench reaches it through its own
    // origin: /relay/… here, and the same rewrite in vercel.json in production.
    proxy: {
      '/relay': { target: 'https://resident.inanimate.tech', changeOrigin: true, rewrite: (p) => p.replace(/^\/relay/, '') },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
