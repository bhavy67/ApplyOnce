import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the extension pages (popup, profile) and the background service worker, all as
 * ES modules.
 * The content script has its own config because MV3 content scripts cannot be modules.
 * `dist/` is cleaned by the package scripts, since both builds write into it.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rolldownOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        profile: resolve(import.meta.dirname, 'profile.html'),
        background: resolve(import.meta.dirname, 'src/background/service-worker.ts'),
      },
      output: {
        // The manifest references the service worker by a fixed file name.
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
