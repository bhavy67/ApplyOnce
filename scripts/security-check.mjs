// Security regression check for the built extension (Phase 17). Runs after `pnpm build`
// (part of `pnpm check`): permissions, CSP, shipped files, remote code and network use, and
// test data or fixtures leaking into production. Exits non-zero on any finding.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'apps/chrome-extension');
const DIST = join(APP, 'dist');
const findings = [];
const fail = (message) => findings.push(message);

// ---------- manifest: the intended minimal permission set ----------
const EXPECTED_PERMISSIONS = ['activeTab', 'scripting'];
const EXPECTED_CSP =
  "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ALLOWED_MANIFEST_KEYS = [
  'manifest_version',
  'name',
  'version',
  'description',
  'permissions',
  'action',
  'options_ui',
  'background',
  'content_security_policy',
];
for (const path of [join(APP, 'public/manifest.json'), join(DIST, 'manifest.json')]) {
  if (!existsSync(path)) {
    fail(`${relative(ROOT, path)} is missing (run pnpm build first)`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const name = relative(ROOT, path);
  const unexpected = Object.keys(manifest).filter((key) => !ALLOWED_MANIFEST_KEYS.includes(key));
  // Covers host_permissions, optional_permissions, optional_host_permissions, content_scripts,
  // externally_connectable, web_accessible_resources, key, update_url, and anything new.
  if (unexpected.length > 0) fail(`${name}: unexpected keys ${unexpected.join(', ')}`);
  if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(EXPECTED_PERMISSIONS))
    fail(
      `${name}: permissions ${JSON.stringify(manifest.permissions)} ≠ ${JSON.stringify(EXPECTED_PERMISSIONS)}`,
    );
  const csp = manifest.content_security_policy?.extension_pages;
  if (csp !== EXPECTED_CSP) fail(`${name}: extension_pages CSP is ${JSON.stringify(csp)}`);
  if (/unsafe-|https?:|\*|data:|blob:/.test(JSON.stringify(manifest.content_security_policy ?? {})))
    fail(`${name}: CSP allows unsafe or remote sources`);
  if (manifest.background?.service_worker !== 'background.js')
    fail(`${name}: unexpected service worker`);
}

// ---------- shipped files ----------
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
};
if (existsSync(DIST)) walk(DIST);
for (const file of files) {
  const name = relative(DIST, file);
  if (!/\.(js|css|html|json)$/.test(name)) fail(`dist/${name}: unexpected file type`);
  if (/\.map$|fixture|e2e|test|spec/i.test(name)) fail(`dist/${name}: test or debug artifact`);
}

// ---------- contents: remote code, network, test data ----------
const FORBIDDEN_CODE = [
  ['fetch(', 'network request'],
  ['XMLHttpRequest', 'network request'],
  ['WebSocket', 'network connection'],
  ['sendBeacon', 'beacon'],
  ['EventSource', 'server events'],
  ['importScripts', 'remote script loading'],
  ['new Function', 'dynamic code'],
  ['eval(', 'dynamic code'],
  ['sourceMappingURL', 'source map reference'],
];
// (Raw HTML rendering is checked in the sources, not here: React DOM itself names the prop.)
// Test markers used by the unit and browser suites (fake data only).
const TEST_MARKERS = [
  'jane.doe',
  'Jane Doe',
  '555 010',
  'Degree A',
  'University A',
  'Springfield',
  'aaaaaaaa-aaaa',
  '127.0.0.1',
  'localhost',
  'vitest',
  'happy-dom',
  'fake-indexeddb',
  'e2e/',
  '.out/',
];
// URLs that are only text in the bundles (XML namespaces, React's error-page link, and
// example text shown in the profile editor), never loaded.
const ALLOWED_URLS = [
  /^http:\/\/www\.w3\.org\//,
  /^https:\/\/react\.dev\/errors\//,
  /^https:\/\/example\.com\.?$/,
  /^https:\/\/www\.linkedin\.com\/in\/…$/,
];
for (const file of files) {
  const name = `dist/${relative(DIST, file)}`;
  const text = readFileSync(file, 'utf8');
  for (const [pattern, why] of FORBIDDEN_CODE)
    if (text.includes(pattern)) fail(`${name}: contains ${pattern} (${why})`);
  for (const marker of TEST_MARKERS)
    if (text.includes(marker)) fail(`${name}: contains test marker ${JSON.stringify(marker)}`);
  for (const url of text.match(/https?:\/\/[^\s"'`)<>\\]+/g) ?? [])
    if (!ALLOWED_URLS.some((allowed) => allowed.test(url))) fail(`${name}: unexpected URL ${url}`);
  if (/<script[^>]+src=["']?(https?:)?\/\//i.test(text)) fail(`${name}: remote script tag`);
  if (name.endsWith('.html') && /<script(?![^>]*\bsrc=)[^>]*>/i.test(text))
    fail(`${name}: inline script`);
}

// ---------- dependencies: no install-time scripts ----------
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'];
for (const group of ['', 'apps', 'packages', 'adapters']) {
  const dirs =
    group === '' ? [ROOT] : readdirSync(join(ROOT, group)).map((d) => join(ROOT, group, d));
  for (const dir of dirs) {
    const path = join(dir, 'package.json');
    if (!existsSync(path)) continue;
    const scripts = JSON.parse(readFileSync(path, 'utf8')).scripts ?? {};
    for (const script of INSTALL_SCRIPTS)
      if (scripts[script]) fail(`${relative(ROOT, path)}: has a "${script}" script`);
  }
}
const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
const buildDeps = [...lock.matchAll(/^ {2}(\S+):\n(?: {4}.*\n)*? {4}requiresBuild: true/gm)].map(
  (m) => m[1],
);
if (buildDeps.length > 0) fail(`dependencies that run build scripts: ${buildDeps.join(', ')}`);

// ---------- test isolation ----------
const e2eIgnore = readFileSync(join(ROOT, 'e2e/.gitignore'), 'utf8');
if (!/^\.out\/?$/m.test(e2eIgnore)) fail('e2e/.gitignore does not ignore .out/');
if (!/^dist\/$/m.test(readFileSync(join(ROOT, '.gitignore'), 'utf8')))
  fail('.gitignore does not ignore dist/');

if (findings.length > 0) {
  console.error(`Security check: ${findings.length} finding(s)`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log(
  `Security check passed: permissions ${EXPECTED_PERMISSIONS.join(' + ')}, strict CSP, ${files.length} shipped files with no remote code, network calls, source maps, or test data; no install scripts.`,
);
