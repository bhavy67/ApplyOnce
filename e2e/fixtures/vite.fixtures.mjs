// Builds one framework fixture app (FIXTURE_APP, e.g. "fw/react-cb" or "react-fixture") into
// e2e/.out/fixtures/<app>/dist. Run through the extension's Vite (see scripts/setup.mjs).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const app = process.env.FIXTURE_APP;
if (!app) throw new Error('Set FIXTURE_APP, e.g. fw/react-cb');
const name = app.split('/').at(-1);
const extensionModules = join(ROOT, 'apps/chrome-extension/node_modules');

export default {
  root: join(E2E, 'fixtures', app),
  base: './',
  logLevel: 'warn',
  resolve: {
    alias: name.startsWith('react')
      ? {
          // React comes from the extension's own dependencies (the version ApplyOnce uses).
          'react-dom/client': join(extensionModules, 'react-dom/client.js'),
          'react-dom': join(extensionModules, 'react-dom'),
          react: join(extensionModules, 'react'),
        }
      : { vue: join(E2E, 'fixtures/fw/node_modules/vue/dist/vue.esm-bundler.js') },
  },
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    outDir: join(E2E, '.out/fixtures', app, 'dist'),
    emptyOutDir: true,
    minify: !name.startsWith('angular'),
  },
};
