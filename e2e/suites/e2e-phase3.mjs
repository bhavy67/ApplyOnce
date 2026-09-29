// Phase 2 + Phase 3 verification in real Chrome via the DevTools pipe. Fake data only.
import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

// Repo-relative paths: suites live in e2e/suites, output goes to e2e/.out (git-ignored).
const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const SCRATCH = join(E2E, '.out');
e2eMkdir(SCRATCH, { recursive: true });
const DIST = join(ROOT, 'apps/chrome-extension/dist');
const REACT_DIST = join(SCRATCH, 'fixtures/react-fixture/dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake profile. LinkedIn is saved but is not on any test page: it must never reach a page.
const LINKEDIN = 'https://www.linkedin.com/in/jane-doe-example';
const PORTFOLIO = 'https://jane-doe.example.com';

const PLAIN_PAGE = `<!doctype html><html><head><title>ApplyOnce Test Form</title></head><body>
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
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/plain.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PLAIN_PAGE);
  }
  try {
    const path = url.pathname === '/react.html' ? 'index.html' : url.pathname.slice(1);
    const body = readFileSync(join(REACT_DIST, path));
    res.writeHead(200, { 'content-type': extname(path) === '.js' ? 'text/javascript' : 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

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

// ---- CDP over the pipe ----
let nextId = 0;
const pending = new Map();
const contexts = new Map();
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
const open = async (url) => attach((await send('Target.createTarget', { url })).targetId);
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
const POPUP_HELPERS = `
  window.t = {
    button: (prefix) => [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith(prefix)),
    items: () => [...document.querySelectorAll('.review-item')].map((li) => ({
      name: li.querySelector('.field-name').textContent,
      mapping: li.querySelector('.mapping').textContent,
      note: li.querySelector('.note').textContent,
      checked: li.querySelector('input').checked,
      disabled: li.querySelector('input').disabled,
    })),
    toggle: (name) => [...document.querySelectorAll('.review-item')].find((li) => li.querySelector('.field-name').textContent === name).querySelector('input').click(),
  };
  true`;
async function analyze(popup) {
  await popup.evaluate(POPUP_HELPERS);
  await popup.evaluate(`t.button('Analyze').click(); true`);
  await waitFor(popup, `!!document.querySelector('.analysis, .message.error')`);
  return popup.evaluate(`document.querySelector('main').innerText`);
}
async function fill(popup) {
  await popup.evaluate(`document.querySelector('.fill-summary')?.remove(); t.button('Fill ').click(); true`);
  await waitFor(popup, `!!document.querySelector('.fill-summary') || !!document.querySelector('.analysis .message.error')`);
  return popup.evaluate(`document.querySelector('.fill-summary')?.textContent ?? document.querySelector('.analysis .message.error')?.textContent`);
}
function isolatedWorld(tab) {
  return (contexts.get(tab.sessionId) ?? []).findLast((c) => c.auxData?.type === 'isolated');
}
const PAGE_STATE = `JSON.stringify({
  html: document.documentElement.outerHTML,
  values: [...document.querySelectorAll('input, select, textarea')].map((e) => e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value),
  local: Object.keys(localStorage), session: Object.keys(sessionStorage),
  globals: Object.keys(window).filter((k) => /applyonce/i.test(k)),
})`;

try {
  const { id } = await send('Extensions.loadUnpacked', { path: DIST });
  check('extension loads', !!id);

  // ---- Save a fake profile with the Phase 1 editor ----
  const profile = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(profile, `!!document.querySelector('form')`);
  await profile.evaluate(`
    const set = (label, value) => {
      const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label);
      const el = document.getElementById(l.htmlFor);
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    set('First name', 'Jane'); set('Last name', 'Doe');
    set('Email', 'jane.doe@example.com'); set('Phone', '+1 555 010 0199');
    set('City', 'Springfield'); set('Country', 'Canada');
    set('Years of experience', '4.5');
    set('LinkedIn', '${LINKEDIN}'); set('Portfolio', '${PORTFOLIO}');
    set('Willing to relocate', 'yes'); set('Requires visa sponsorship', 'no');
    true`);
  await sleep(100);
  await profile.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  check('Phase 1: profile saves', await waitFor(profile, `document.querySelector('[role=status]').textContent === 'Profile saved'`));
  await profile.close();

  // ================= Phase 2 regression: plain HTML page =================
  const plain = await open(`${ORIGIN}/plain.html`);
  await waitFor(plain, `document.readyState === 'complete'`);
  const plainBefore = JSON.parse(await plain.evaluate(PAGE_STATE));
  let popup = await openPopupFor(id, plain);
  let text = await analyze(popup);
  check('Phase 2: plain page analysis detects 12 fields', text.includes('12 fields detected'));
  check('Phase 2: profile status via content script → service worker', text.includes('Profile ready: 11 saved values.'), text.match(/Profile[^\n]*/)?.[0]);
  const plainItems = await popup.evaluate(`t.items()`);
  check('Phase 2: every supported field listed, sensitive inputs ignored', plainItems.length === 14 && !JSON.stringify(plainItems).match(/password|csrf|resume|token123/));
  const plainAfter = JSON.parse(await plain.evaluate(PAGE_STATE));
  check('Phase 2/3: Analyze does not change or fill the page', plainAfter.html === plainBefore.html && JSON.stringify(plainAfter.values) === JSON.stringify(plainBefore.values));
  const plainWorld = isolatedWorld(plain);
  const denied = plainWorld && (await plain.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }).then((r) => JSON.stringify(r))`, plainWorld.id));
  check('Phase 2: content script is refused the full profile', denied === '{"ok":false,"error":"forbidden"}', denied);
  const deniedMap = plainWorld && (await plain.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/map-fields', payload: { fields: [] } }).then((r) => JSON.stringify(r))`, plainWorld.id));
  check('Phase 3: content script cannot request mappings or fills', deniedMap === '{"ok":false,"error":"forbidden"}', deniedMap);
  check('Phase 2: analyze again works', (await analyze(popup)).includes('12 fields detected'));
  await popup.close();
  await plain.send('Page.reload');
  await sleep(800);
  popup = await openPopupFor(id, plain);
  check('Phase 2: analysis works after refresh', (await analyze(popup)).includes('12 fields detected'));
  await popup.close();
  const internal = await open('chrome://version');
  await sleep(500);
  popup = await openPopupFor(id, internal);
  check('Phase 2: unsupported page fails gracefully', (await analyze(popup)).includes('This page cannot be analyzed'));
  await popup.close();
  await internal.close();

  // ================= Phase 3: React controlled form =================
  const tab = await open(`${ORIGIN}/react.html`);
  await waitFor(tab, `!!document.querySelector('#state')`);
  const initialState = await tab.evaluate(`document.querySelector('#state').textContent`);
  const reactState = async () => JSON.parse(await tab.evaluate(`document.querySelector('#state').textContent`));

  popup = await openPopupFor(id, tab);
  text = await analyze(popup);
  check('popup shows detected fields', text.includes('13 fields detected'));
  check('review summary shown', /Ready to fill\s*9/.test(text) && /Needs review\s*1/.test(text) && /No value in profile\s*1/.test(text) && /Not recognized\s*2/.test(text), text.split('\n').slice(6, 16).join(' | '));
  check('Fill button waits for the user', text.includes('Fill 9 selected fields'));
  const items = await popup.evaluate(`t.items()`);
  console.log('      review:');
  for (const i of items) console.log(`        [${i.checked ? 'x' : i.disabled ? '-' : ' '}] ${i.name} | ${i.mapping} | ${i.note}`);
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  check('deterministic mappings with confidence shown', byName['First Name']?.mapping === '→ First name (identity.firstName) · Automatic · High confidence' && byName['Email']?.mapping === '→ Email (contact.email) · Automatic · High confidence');
  check('high-confidence fields with values are pre-selected', ['First Name', 'Last Name', 'Email', 'Phone', 'City', 'Country', 'Years of Experience', 'Portfolio', 'Willing to relocate'].every((n) => byName[n]?.checked));
  check('review-level radio group is not pre-selected', byName['Do you require visa sponsorship?']?.checked === false && byName['Do you require visa sponsorship?']?.disabled === false && byName['Do you require visa sponsorship?']?.mapping.includes('Low confidence'));
  check('unknown fields cannot be selected', byName['Notes']?.disabled && byName['Referral code']?.disabled && byName['Notes']?.note === 'No safe match. Will not be filled.');
  check('field without profile value cannot be selected', byName['Postal Code']?.disabled && byName['Postal Code']?.note === 'No value in your profile.');
  check('no profile values shown in the popup', !text.includes('Jane') && !text.includes('jane.doe@example.com') && !text.includes('Springfield'));
  check('Analyze did not change React state', (await tab.evaluate(`document.querySelector('#state').textContent`)) === initialState);

  // Record what the content script receives (installed in the extension's isolated world).
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);

  // The page re-renders and removes a field between Analyze and Fill.
  await tab.evaluate(`document.querySelector('#toggle-portfolio').click(); true`);
  await sleep(200);

  const summary = await fill(popup);
  check('fill summary shown', summary === '8 fields filled · 1 failed · 1 need review', summary);
  const state = await reactState();
  check('React state received every filled value', state.firstName === 'Jane' && state.lastName === 'Doe' && state.email === 'jane.doe@example.com' && state.phone === '+1 555 010 0199' && state.city === 'Springfield' && state.country === 'CA' && state.years === '4.5' && state.relocate === true, JSON.stringify(state));
  check('review-level and unknown fields were not filled', state.sponsorship === '' && state.notes === '' && state.referral === '' && state.postal === '');
  const afterFill = Object.fromEntries((await popup.evaluate(`t.items()`)).map((i) => [i.name, i]));
  check('removed field reported as not found, others still filled', afterFill['Portfolio']?.note === 'Not found. The field is no longer on the page.' && afterFill['Email']?.note.startsWith('Filled'), afterFill['Portfolio']?.note);
  check('no automatic submission', (await tab.evaluate(`document.querySelector('#submitted').textContent`)) === 'false' && (await tab.evaluate('location.pathname')) === '/react.html');

  const recorded = await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id);
  const fillMessages = JSON.parse(recorded).filter((m) => m.type === 'applyonce/fill-fields');
  const values = fillMessages.flatMap((m) => m.payload.instructions.map((i) => i.value));
  // Since Phase 16 the service worker re-scans the page before filling, so the removed Portfolio
  // field is refused there and its value is never sent to the page at all.
  check('content script received only approved field/value pairs (the removed field\'s value not even sent)', fillMessages.length === 1 && JSON.stringify(values) === JSON.stringify(['Jane', 'Doe', 'jane.doe@example.com', '+1 555 010 0199', 'Springfield', 'Canada', 4.5, true]) && !values.includes(PORTFOLIO), JSON.stringify(values));
  check('unapproved profile data never reached the content script', !recorded.includes(LINKEDIN) && !recorded.includes('schemaVersion') && !recorded.includes('identity'));
  const pageAfter = JSON.parse(await tab.evaluate(PAGE_STATE));
  check('full profile not exposed to the page (DOM, storage, globals)', !pageAfter.html.includes(LINKEDIN) && pageAfter.local.length === 0 && pageAfter.session.length === 0 && pageAfter.globals.length === 0);

  let shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'popup-after-fill.png'), Buffer.from(shot.data, 'base64'));

  // The user explicitly approves the review-level radio group and fills again.
  await popup.evaluate(`t.toggle('Do you require visa sponsorship?'); true`);
  await sleep(100);
  const second = await fill(popup);
  const state2 = await reactState();
  check('explicitly approved radio group is filled (No)', state2.sponsorship === 'no', second);
  check('existing values are not overwritten on a second fill', state2.firstName === 'Jane' && state2.email === 'jane.doe@example.com' && (await popup.evaluate(`t.items().find((i) => i.name === 'First Name').note`)).startsWith('Skipped'));
  check('still not submitted', (await tab.evaluate(`document.querySelector('#submitted').textContent`)) === 'false');
  await popup.close();

  // Screenshot of the review before filling (fresh page).
  await tab.send('Page.reload');
  await sleep(1000);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'popup-review.png'), Buffer.from(shot.data, 'base64'));
  check('analysis after reload works on the React page', (await popup.evaluate(`document.querySelector('main').innerText`)).includes('13 fields detected'));
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
