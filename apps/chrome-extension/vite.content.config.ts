import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Builds the content script as one self-contained classic script (IIFE). */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/content-script.ts'),
      formats: ['iife'],
      name: 'ApplyOnceContentScript',
      fileName: () => 'content.js',
    },
  },
});
