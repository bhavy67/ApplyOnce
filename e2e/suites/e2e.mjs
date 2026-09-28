// Manual-style verification of the ApplyOnce profile page in real Chrome via CDP.
// Uses fake data only.
import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// Repo-relative paths: suites live in e2e/suites, output goes to e2e/.out (git-ignored).
const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const SCRATCH = join(E2E, '.out');
e2eMkdir(SCRATCH, { recursive: true });
const DIST = join(ROOT, 'apps/chrome-extension/dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging',
  `--user-data-dir=${mkdtempSync(join(SCRATCH, 'chrome-'))}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// CDP over the debugging pipe: NUL-delimited JSON on fd 3 (to Chrome) and fd 4 (from Chrome).
let nextId = 0;
const pending = new Map();
let buffer = '';
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    nextId += 1;
    pending.set(nextId, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    chrome.stdio[3].write(JSON.stringify({ id: nextId, method, params, sessionId }) + '\0');
  });
}

async function findExtensionId() {
  const { id } = await send('Extensions.loadUnpacked', { path: DIST });
  return id;
}

async function connect(url) {
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description);
    return res.result?.value;
  };
  return {
    send: (method, params) => send(method, params, sessionId),
    evaluate,
    close: () => send('Target.closeTarget', { targetId }),
  };
}

// Helpers injected into the page.
const HELPERS = `
  window.t = {
    input(label) {
      const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label);
      return l && (document.getElementById(l.htmlFor) ?? l.querySelector('input'));
    },
    set(label, value) {
      const el = this.input(label);
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    },
    get(label) { const el = this.input(label); return el.type === 'checkbox' ? el.checked : el.value; },
    button(text) { return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text); },
    click(text) { this.button(text).click(); },
    status() { return document.querySelector('[role=status]')?.textContent ?? ''; },
    errors() { return [...document.querySelectorAll('.field-error')].map((e) => e.textContent); },
  };
  true;
`;

async function openProfile(id) {
  const page = await connect(`chrome-extension://${id}/profile.html`);
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate(`!!document.querySelector('form')`)) break;
    await sleep(100);
  }
  await page.evaluate(HELPERS);
  return page;
}

try {
  const id = await findExtensionId();
  check('extension loads in Chrome (Extensions.loadUnpacked)', !!id, id);
  if (!id) throw new Error('Extension did not load');

  // Popup
  const popup = await connect(`chrome-extension://${id}/popup.html`);
  await sleep(500);
  const popupText = await popup.evaluate(`document.body.innerText`);
  check('popup shows tagline and Manage Profile', popupText.includes('Your information. Once.') && popupText.includes('Manage Profile'));
  await popup.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Manage Profile').click(); true`);
  await sleep(800);
  const { targetInfos } = await send('Target.getTargets');
  const opened = targetInfos.filter((t) => t.url === `chrome-extension://${id}/profile.html`);
  check('Manage Profile opens the profile page in a tab', opened.length === 1);
  for (const t of opened) await send('Target.closeTarget', { targetId: t.targetId });
  await popup.close();

  // 1. Open profile, empty initially
  let page = await openProfile(id);
  const title = await page.evaluate(`document.querySelector('h1').textContent`);
  check('profile page opens', title === 'Your profile');
  const sections = await page.evaluate(`[...document.querySelectorAll('form section h2')].map((h) => h.textContent).join(',')`);
  check('all 9 sections present (Phase 10 adds Work experience and Certifications)', sections === 'Personal information,Location,Professional,Employment,Work experience,Job preferences,Education,Certifications,Authorization', sections);
  check('new profile is empty', (await page.evaluate(`t.get('First name') + t.get('Email')`)) === '');

  // 2. Validation blocks invalid save
  await page.evaluate(`t.set('First name', 'Jane'); t.set('Email', 'not-an-email'); t.set('LinkedIn', 'not a url'); true`);
  await sleep(100);
  check('unsaved changes indicator', (await page.evaluate(`t.status()`)) === 'Unsaved changes');
  await page.evaluate(`t.click('Save profile'); true`);
  await sleep(300);
  const errors = await page.evaluate(`t.errors()`);
  check('invalid email + URL show field errors', errors.length === 2, errors.join(' | '));
  check('save refused with message', (await page.evaluate(`t.status()`)).startsWith('Fix the highlighted fields'));

  // 3. Fix and fill partial profile, save
  await page.evaluate(`
    t.set('Email', 'jane.doe@example.com');
    t.set('LinkedIn', 'https://www.linkedin.com/in/jane-doe-example');
    t.set('Last name', 'Doe');
    t.set('Phone', '+1 555 010 0199');
    t.set('City', 'Springfield');
    t.set('Years of experience', '4.5');
    t.set('Requires visa sponsorship', 'no');
    t.set('Work mode', 'remote');
    true`);
  await sleep(200);
  await page.evaluate(`t.set('Institution', 'Example University'); t.set('Graduation year', '2019'); true`);
  await sleep(100);
  check('errors clear live once fixed', (await page.evaluate(`t.errors().length`)) === 0);
  await page.evaluate(`t.click('Save profile'); true`);
  await sleep(500);
  check('save shows "Profile saved"', (await page.evaluate(`t.status()`)) === 'Profile saved');

  // 4. Close and reopen the page
  await page.close();
  page = await openProfile(id);
  const reloaded = await page.evaluate(`JSON.stringify([t.get('First name'), t.get('Last name'), t.get('Email'), t.get('Phone'), t.get('City'), t.get('Years of experience'), t.get('Requires visa sponsorship'), t.get('Work mode'), t.get('Institution'), t.get('Graduation year')])`);
  check('values persist after closing and reopening', reloaded === JSON.stringify(['Jane', 'Doe', 'jane.doe@example.com', '+1 555 010 0199', 'Springfield', '4.5', 'no', 'remote', 'Example University', '2019']), reloaded);

  // 5. Edit saved data
  await page.evaluate(`t.set('City', 'Shelbyville'); true`);
  await sleep(100);
  await page.evaluate(`t.click('Save profile'); true`);
  await sleep(500);
  await page.send('Page.reload');
  await sleep(1000);
  await page.evaluate(HELPERS);
  check('edits to saved data persist', (await page.evaluate(`t.get('City')`)) === 'Shelbyville');

  await page.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1500, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(join(SCRATCH, 'profile-page.png'), Buffer.from(shot.data, 'base64'));

  // 6. Clear: cancel first, then confirm
  await page.evaluate(`t.click('Clear profile…'); true`);
  await sleep(200);
  check('confirmation dialog opens', await page.evaluate(`document.querySelector('dialog').open && document.querySelector('dialog h2').textContent === 'Clear your saved profile?'`));
  await page.evaluate(`t.click('Cancel'); true`);
  await sleep(200);
  check('cancel keeps the profile', (await page.evaluate(`!document.querySelector('dialog').open && t.get('First name') === 'Jane'`)));
  await page.evaluate(`t.click('Clear profile…'); true`);
  await sleep(200);
  await page.evaluate(`t.click('Clear Profile'); true`);
  await sleep(500);
  check('clear resets form and shows confirmation', (await page.evaluate(`t.get('First name') === '' && t.status() === 'Profile cleared'`)));
  await page.close();
  page = await openProfile(id);
  check('cleared profile stays empty after reopening', (await page.evaluate(`t.get('First name') + t.get('Email') + t.get('City')`)) === '');
  await page.close();
} catch (error) {
  check('run completed', false, String(error));
} finally {
  chrome.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
