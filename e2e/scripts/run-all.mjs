// Runs every browser suite in sequence against apps/chrome-extension/dist (build it first with
// `pnpm build`), writes each log to e2e/.out/logs, and prints a summary.
// Usage: node e2e/scripts/run-all.mjs [suite-name-filter]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E = fileURLToPath(new URL('..', import.meta.url));
const LOGS = join(E2E, '.out/logs');
mkdirSync(LOGS, { recursive: true });
const filter = process.argv[2];
const order = (name) => Number(/phase(\d+)/.exec(name)?.[1] ?? 1) + (name.includes('verify') ? 0.5 : 0);
const suites = readdirSync(join(E2E, 'suites'))
  .filter((name) => name.endsWith('.mjs') && (!filter || name.includes(filter)))
  .sort((a, b) => order(a) - order(b));

let failed = 0;
for (const suite of suites) {
  const result = spawnSync('node', [join(E2E, 'suites', suite)], { encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  writeFileSync(join(LOGS, `${suite}.log`), output);
  const summary = output.trim().split('\n').at(-1);
  if (result.status !== 0) failed += 1;
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'}  ${suite.padEnd(26)} ${summary}`);
  for (const line of output.split('\n').filter((l) => l.startsWith('FAIL'))) console.log(`        ${line.slice(0, 200)}`);
  // Chrome profiles are per run and large: remove them.
  for (const entry of readdirSync(join(E2E, '.out'))) {
    if (!entry.startsWith('chrome-')) continue;
    try {
      rmSync(join(E2E, '.out', entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Chrome may still be flushing its profile; it is git-ignored and removed next time.
    }
  }
}
console.log(`\n${suites.length - failed}/${suites.length} suites passed (logs in e2e/.out/logs)`);
process.exit(failed ? 1 : 0);
