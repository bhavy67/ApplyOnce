import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the extension pages (popup, profile) and the background service worker, all as
 * ES modules.
 * The content script has its own config because MV3 content scripts cannot be modules.
 * `dist/` is cleaned by the package scripts, since both builds write into it.
 */
const { version } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as { version: string };

/** One id per build, shared by the popup and service worker (see src/build-info.ts). */
const BUILD_ID = `${version}+${Date.now().toString(36)}`;

export default defineConfig({
  plugins: [react()],
  define: { __APPLYONCE_BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    // Chrome preloads modules natively; the polyfill would add a fetch() to every page.
    modulePreload: { polyfill: false },
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
