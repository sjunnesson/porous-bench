import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createShare, readShare, type ShareStore } from './api/_share.js';

/** Where the dev server reads a short link it doesn't hold: Bench's own, so its links open here too. */
const PRODUCTION = 'https://bench.porous.systems';

/**
 * Short share links in development: the handlers Vercel runs (api/), with setups kept in memory. A
 * link made on Bench's site is read from there (and kept), so the gallery's entries and links people
 * sent you open on the dev server as well. What an id names never changes, so the copy stays true.
 */
function shareApi(): Plugin {
  const kept = new Map<string, string>();
  const fromProduction = async (id: string): Promise<string | null> => {
    const r = await fetch(`${PRODUCTION}/api/share/${id}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`); // answered as the store being down: the link may be fine
    const data = await r.text();
    kept.set(id, data);
    return data;
  };
  const store: ShareStore = { get: async (id) => kept.get(id) ?? fromProduction(id), add: async (id, data) => void kept.set(id, data) };
  return {
    name: 'bench-share-api',
    configureServer(server) {
      server.middlewares.use('/api/share', async (req, res) => {
        // Node's request, read as the stream it is (the config has no Node types).
        const incoming = req as unknown as AsyncIterable<Uint8Array<ArrayBuffer>> & { method?: string; originalUrl?: string };
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const post = incoming.method === 'POST';
        const request = new Request(new URL(incoming.originalUrl ?? '/', 'http://localhost'), { method: incoming.method, body: post ? new Blob(chunks) : undefined });
        const response = await (post ? createShare(request, store) : readShare(request, store));
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), shareApi()],
  // Four pages: Bench, the guide (guide.html, served at /guide), the privacy notice (privacy.html, at
  // /privacy, plain HTML), neither of which loads the simulator, and the gallery (gallery.html, at
  // /gallery), which runs apps on it without Bench around them.
  build: { rolldownOptions: { input: { main: 'index.html', guide: 'guide.html', privacy: 'privacy.html', gallery: 'gallery.html' } } },
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
