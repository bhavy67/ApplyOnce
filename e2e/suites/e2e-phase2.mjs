// Phase 2 verification in real Chrome via the DevTools pipe. Fake data only.
import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

// Repo-relative paths: suites live in e2e/suites, output goes to e2e/.out (git-ignored).
const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const SCRATCH = join(E2E, '.out');
e2eMkdir(SCRATCH, { recursive: true });
const DIST = join(ROOT, 'apps/chrome-extension/dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FORM_PAGE = `<!doctype html><html><head><title>ApplyOnce Test Form</title></head><body>
<form id="application" name="application" action="/submit">
  <label for="first">First Name</label><input id="first" name="firstName" required>
  <label>Last Name <input name="lastName"></label>
  <label for="email">Email</label><input id="email" type="email" name="email" autocomplete="email">
  <label for="phone">Phone</label><input id="phone" type="tel" name="phone">
  <label for="city">City</label><input id="city" name="city" value="Prefilled Town">
  <label for="country">Country</label><select id="country" name="country"><option value="">Select…</option><option value="ca">Canada</option><option value="in">India</option></select>
  <label for="yoe">Years of Experience</label><input id="yoe" type="number" name="yearsOfExperience">
  <p>Notes</p><textarea name="notes"></textarea>
  <label><input type="checkbox" name="relocate"> Willing to relocate</label>
  <fieldset><legend>Work mode</legend>
    <label><input type="radio" name="workMode" value="remote"> Remote</label>
    <label><input type="radio" name="workMode" value="onsite"> On-site</label>
  </fieldset>
  <input type="password" name="password"><input type="hidden" name="csrf" value="token123"><input type="file" name="resume">
  <input name="internalCode" style="display:none"><input name="locked" disabled>
  <button type="submit">Submit</button>
</form>
<form id="newsletter"><input type="email" placeholder="Newsletter email" name="newsletter"></form>
<input aria-label="Search jobs" type="search">
</body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FORM_PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE_URL = `http://127.0.0.1:${server.address().port}/form.html`;

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

// CDP over the pipe, with event capture for execution contexts.
let nextId = 0;
const pending = new Map();
const contexts = new Map(); // sessionId -> [{id, auxData, name}]
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
    } else if (msg.method === 'Runtime.executionContextCreated') {
      const list = contexts.get(msg.sessionId) ?? [];
      list.push(msg.params.context);
      contexts.set(msg.sessionId, list);
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

async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  const evaluate = async (expression, contextId) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result?.value;
  };
  return { sessionId, targetId, evaluate, send: (m, p) => send(m, p, sessionId), close: () => send('Target.closeTarget', { targetId }) };
}

async function open(url) {
  const { targetId } = await send('Target.createTarget', { url });
  return attach(targetId);
}

async function waitFor(page, expression, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await page.evaluate(expression)) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

/** Clicks the toolbar action for a tab (grants activeTab like a user click) and attaches to the popup. */
async function openPopupFor(extensionId, tab) {
  await send('Target.activateTarget', { targetId: tab.targetId });
  const { targetInfo } = await send('Target.getTargetInfo', { targetId: tab.targetId });
  const { targetInfos: tabs } = await send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const tabTarget = tabs.find((t) => t.url === targetInfo.url);
  if (!tabTarget) throw new Error(`No tab target for ${targetInfo.url}`);
  await send('Extensions.triggerAction', { id: extensionId, targetId: tabTarget.targetId });
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const popup = targetInfos.find((t) => t.url === `chrome-extension://${extensionId}/popup.html`);
    if (popup) {
      const page = await attach(popup.targetId);
      await waitFor(page, `!!document.querySelector('button.primary')`);
      return page;
    }
    await sleep(100);
  }
  throw new Error('Popup did not open');
}

async function analyze(popup) {
  await popup.evaluate(`document.querySelector('button.primary').click(); true`);
  await waitFor(popup, `!!document.querySelector('.analysis, .message.error')`);
  return popup.evaluate(`document.querySelector('main').innerText`);
}

const PAGE_STATE = `JSON.stringify({
  html: document.documentElement.outerHTML,
  values: [...document.querySelectorAll('input, select, textarea')].map((e) => e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value),
  local: Object.keys(localStorage), session: Object.keys(sessionStorage),
  globals: Object.keys(window).filter((k) => /applyonce/i.test(k)),
})`;

try {
  const { id } = await send('Extensions.loadUnpacked', { path: DIST });
  check('extension loads', !!id, id);

  // Save a fake profile through the Phase 1 editor.
  const profile = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(profile, `!!document.querySelector('form')`);
  await profile.evaluate(`
    const setInput = (label, value) => {
      const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label);
      const el = document.getElementById(l.htmlFor);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setInput('First name', 'Jane'); setInput('Last name', 'Doe');
    setInput('Email', 'jane.doe@example.com'); setInput('City', 'Springfield');
    true`);
  await sleep(100);
  await profile.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  check('Phase 1 profile save still works', await waitFor(profile, `document.querySelector('[role=status]').textContent === 'Profile saved'`));

  // GET_PROFILE through the service worker, from an extension page.
  const viaWorker = await profile.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }).then((r) => JSON.stringify(r))`);
  const parsed = JSON.parse(viaWorker);
  check('extension page retrieves profile through service worker', parsed.ok && parsed.data.identity.firstName === 'Jane' && parsed.data.contact.email === 'jane.doe@example.com');
  await profile.close();

  // Open the test form in a tab.
  const tab = await open(PAGE_URL);
  await waitFor(tab, `document.readyState === 'complete'`);
  const before = await tab.evaluate(PAGE_STATE);

  let popup = await openPopupFor(id, tab);
  const initial = await popup.evaluate(`document.querySelector('main').innerText`);
  check('popup offers "Analyze this page" and no fill action', initial.includes('Analyze this page') && !/fill/i.test(initial.replace('Autofill is coming in a later phase.', '')));

  const text = await analyze(popup);
  check('popup shows detected field count', text.includes('12 fields detected'), text.split('\n').slice(0, 12).join(' | '));
  check('popup shows labeled / needs review / hidden-or-disabled', /Labeled\s*11/.test(text) && /Needs review\s*1/.test(text) && /Hidden or disabled\s*2/.test(text));
  check('popup shows page title', text.includes('ApplyOnce Test Form'));
  check('content script retrieved profile status via service worker', text.includes('Profile ready: 4 saved values.'));

  await popup.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'View fields').click(); true`);
  await sleep(200);
  const items = await popup.evaluate(`[...document.querySelectorAll('.field-list li')].map((li) => li.innerText.replace(/\\n/g, ' | '))`);
  console.log('      fields:\n        ' + items.join('\n        '));
  const listText = items.join('\n');
  check('field list shows metadata', items.length === 14 && listText.includes('First Name | text · name="firstName" · id="first" | required') && listText.includes('Work mode | radio · name="workMode" · 2 options') && listText.includes('Notes | textarea · name="notes" | needs review'));
  check('no page values in the field list', !listText.includes('Prefilled Town') && !listText.includes('token123'));
  check('password, hidden, and file inputs ignored', !/password|csrf|resume/.test(listText));

  // Content script cannot read the full profile.
  const isolated = (contexts.get(tab.sessionId) ?? []).find((c) => c.auxData?.type === 'isolated' && c.origin === `chrome-extension://${id}`) ??
    (contexts.get(tab.sessionId) ?? []).find((c) => c.auxData?.type === 'isolated');
  if (isolated) {
    const denied = await tab.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }).then((r) => JSON.stringify(r))`, isolated.id);
    check('content script is refused the full profile', denied === JSON.stringify({ ok: false, error: 'forbidden' }), denied);
  } else {
    check('content script isolated world found', false);
  }

  const after = await tab.evaluate(PAGE_STATE);
  const b = JSON.parse(before);
  const a = JSON.parse(after);
  check('nothing was filled and the page DOM is unchanged', a.html === b.html && JSON.stringify(a.values) === JSON.stringify(b.values));
  check('no ApplyOnce data in page storage or globals', a.local.length === 0 && a.session.length === 0 && a.globals.length === 0);

  // Analyze again without reload (listener must not duplicate).
  const again = await analyze(popup);
  check('second analysis on same page works', again.includes('12 fields detected'));
  await popup.close();

  // Refresh the page, then analyze again (content script re-injected).
  await tab.send('Page.reload');
  await sleep(800);
  await waitFor(tab, `document.readyState === 'complete'`);
  popup = await openPopupFor(id, tab);
  check('analysis works after page refresh', (await analyze(popup)).includes('12 fields detected'));
  await popup.close();

  // Unsupported page.
  const internal = await open('chrome://version');
  await sleep(500);
  popup = await openPopupFor(id, internal);
  const refused = await analyze(popup);
  check('unsupported page fails gracefully', refused.includes('This page cannot be analyzed'), refused.split('\n').slice(2, 4).join(' | '));
  const shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'popup-unsupported.png'), Buffer.from(shot.data, 'base64'));
  await popup.close();

  // Screenshot of a successful analysis with the field list open.
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  await popup.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'View fields').click(); true`);
  await sleep(300);
  const shot2 = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'popup-analysis.png'), Buffer.from(shot2.data, 'base64'));
  await popup.close();
} catch (error) {
  check('run completed', false, String(error));
} finally {
  chrome.kill();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
