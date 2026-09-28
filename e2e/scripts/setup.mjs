// One-time (and after fixture changes) preparation for the browser suites:
//   1. installs the framework fixtures' dependencies (Vue, Angular) into e2e/fixtures/fw;
//   2. builds every fixture app into e2e/.out/fixtures;
//   3. builds the old extension versions the upgrade suites install first, from git history
//      (git archive → e2e/.out/builds/<ref>), never touching the working tree.
// Usage: node e2e/scripts/setup.mjs [--skip-install] [--skip-builds]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const OUT = join(E2E, '.out');
const args = new Set(process.argv.slice(2));
const run = (cmd, argv, options = {}) => execFileSync(cmd, argv, { stdio: 'inherit', ...options });

/** Old versions the upgrade suites start from: Phase 4 (0.5.0) and Phase 5 (0.6.0). */
const OLD_BUILDS = ['5232240', 'b3f8f10'];

if (!args.has('--skip-install')) {
  console.log('Installing fixture dependencies…');
  run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: join(E2E, 'fixtures/fw') });
}

const apps = [
  'react-fixture',
  ...readdirSync(join(E2E, 'fixtures/fw'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'node_modules')
    .map((d) => `fw/${d.name}`),
];
for (const app of apps) {
  console.log(`Building fixture ${app}…`);
  run('pnpm', ['exec', 'vite', 'build', '--config', join(E2E, 'fixtures/vite.fixtures.mjs')], {
    cwd: join(ROOT, 'apps/chrome-extension'),
    env: { ...process.env, FIXTURE_APP: app },
  });
}

if (!args.has('--skip-builds')) {
  for (const ref of OLD_BUILDS) {
    const dir = join(OUT, 'builds', ref);
    if (existsSync(join(dir, 'apps/chrome-extension/dist/manifest.json'))) {
      console.log(`Old build ${ref} already present.`);
      continue;
    }
    console.log(`Building extension at ${ref}…`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${ref} | tar -x -C "${dir}"`], { stdio: 'inherit' });
    run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: dir });
    run('pnpm', ['build'], { cwd: dir });
  }
}
console.log('Setup complete.');
