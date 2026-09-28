// Phase 4 (Teach Once) verification in real Chrome via the DevTools pipe. Fake data only.
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

const LINKEDIN = 'https://www.linkedin.com/in/jane-doe-example';
const SENSITIVE = ['Jane', 'Doe', 'jane.doe@example.com', '555 010 0199', 'Springfield', 'Ontario', LINKEDIN];

const PAGE = `<!doctype html><html><head><title>ApplyOnce Teach Test</title></head><body>
<form id="app" action="/submitted">
  <div><label for="first">First Name</label><input id="first" name="firstName"></div>
  <div><label for="email">Email</label><input id="email" type="email" name="email"></div>
  <div><label for="pref">Preferred Working Location</label><input id="pref" name="q_17"></div>
  <div><label for="cur">Current location</label><input id="cur" name="q_18"></div>
  <div><label for="phone">Phone</label><input id="phone" type="tel" name="phone"></div>
  <button type="submit">Submit application</button>
</form>
<p id="submitted">false</p>
<p id="events">0</p>
<script>
  document.getElementById('app').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
  let count = 0;
  document.addEventListener('input', () => { document.getElementById('events').textContent = String(++count); });
</script>
</body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE_URL = `http://127.0.0.1:${server.address().port}/teach.html`;

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${mkdtempSync(join(SCRATCH, 'chrome-'))}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
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
    } else if (msg.method === 'Runtime.executionContextsCleared') {
      contexts.set(msg.sessionId, []);
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
  await send('Extensions.triggerAction', { id: extensionId, targetId: tabTarget.targetId });
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const popup = targetInfos.find((t) => t.url === `chrome-extension://${extensionId}/popup.html`);
    if (popup) {
      const page = await attach(popup.targetId);
      await waitFor(page, `!!document.querySelector('button.primary')`);
      await page.evaluate(POPUP_HELPERS);
      return page;
    }
    await sleep(100);
  }
  throw new Error('Popup did not open');
}
const POPUP_HELPERS = `
  window.t = {
    button: (prefix, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.startsWith(prefix)),
    li: (name) => [...document.querySelectorAll('.review-item')].find((li) => li.querySelector('.field-name').textContent === name),
    item: (name) => {
      const li = t.li(name);
      return li && {
        mapping: li.querySelector('.mapping').textContent,
        note: li.querySelector('.note').textContent,
        checked: li.querySelector('input[type=checkbox]').checked,
        disabled: li.querySelector('input[type=checkbox]').disabled,
        action: li.querySelector('button.teach')?.textContent,
      };
    },
    toggle: (name) => t.li(name).querySelector('input[type=checkbox]').click(),
    openTeach: (name) => t.li(name).querySelector('button.teach').click(),
    options: (name) => [...t.li(name).querySelectorAll('.teach-editor option')].map((o) => [o.value, o.textContent]),
    selected: (name) => t.li(name).querySelector('.teach-editor select').value,
    choose: (name, key) => {
      const select = t.li(name).querySelector('.teach-editor select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, key);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    saveTeach: (name) => t.button('Save mapping', t.li(name)).click(),
  };
  true`;
async function analyze(popup) {
  await popup.evaluate(`t.button('Analyze').click(); true`);
  await waitFor(popup, `!!document.querySelector('.analysis, .message.error')`);
  return popup.evaluate(`document.querySelector('main').innerText`);
}
async function fill(popup) {
  await popup.evaluate(`document.querySelector('.fill-summary')?.remove(); t.button('Fill ').click(); true`);
  await waitFor(popup, `!!document.querySelector('.fill-summary') || !!document.querySelector('.analysis .message.error')`);
  return popup.evaluate(`document.querySelector('.fill-summary')?.textContent ?? document.querySelector('.analysis .message.error')?.textContent`);
}
async function teach(popup, name, key) {
  await popup.evaluate(`t.openTeach(${JSON.stringify(name)}); true`);
  await waitFor(popup, `!!t.li(${JSON.stringify(name)}).querySelector('.teach-editor')`);
  await popup.evaluate(`t.choose(${JSON.stringify(name)}, ${JSON.stringify(key)}); true`);
  await sleep(50);
  await popup.evaluate(`t.saveTeach(${JSON.stringify(name)}); true`);
  await waitFor(popup, `!t.li(${JSON.stringify(name)}).querySelector('.teach-editor')`);
}
const item = (popup, name) => popup.evaluate(`t.item(${JSON.stringify(name)})`);
const values = (tab) => tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('input')].map((i) => [i.id, i.value])))`).then(JSON.parse);
const isolatedWorld = (tab) => (contexts.get(tab.sessionId) ?? []).findLast((c) => c.auxData?.type === 'isolated');
async function installRecorder(tab) {
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, isolatedWorld(tab).id);
}
async function recordedFillValues(tab) {
  const recorded = JSON.parse(await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, isolatedWorld(tab).id));
  return { raw: JSON.stringify(recorded), values: recorded.filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => i.value)) };
}
async function reloadTab(tab) {
  await tab.send('Page.reload');
  await sleep(700);
  await waitFor(tab, `document.readyState === 'complete'`);
}
async function listMappings(page) {
  return JSON.parse(await page.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/list-mappings' }).then((r) => JSON.stringify(r))`));
}

try {
  const { id } = await send('Extensions.loadUnpacked', { path: DIST });
  check('extension loads', !!id);

  // Fake profile via the Phase 1 editor.
  const profile = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(profile, `!!document.querySelector('form')`);
  await profile.evaluate(`
    const set = (label, value) => {
      const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label);
      const el = document.getElementById(l.htmlFor);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('First name', 'Jane'); set('Last name', 'Doe'); set('Email', 'jane.doe@example.com');
    set('Phone', '+1 555 010 0199'); set('City', 'Springfield'); set('State / province', 'Ontario');
    set('LinkedIn', '${LINKEDIN}');
    true`);
  await sleep(100);
  await profile.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  check('profile saved', await waitFor(profile, `document.querySelector('[role=status]').textContent === 'Profile saved'`));

  // ============ Teach Once ============
  const tab = await open(PAGE_URL);
  await waitFor(tab, `document.readyState === 'complete'`);
  let popup = await openPopupFor(id, tab);
  await analyze(popup);
  await installRecorder(tab);

  let pref = await item(popup, 'Preferred Working Location');
  check('1-4. unknown field appears as unknown, not selectable, with Teach', pref.mapping === 'No match' && pref.note === 'No safe match. Will not be filled.' && pref.disabled && pref.action === 'Teach', JSON.stringify(pref));
  check('automatic mappings labeled as Automatic', (await item(popup, 'Email')).mapping === '→ Email (contact.email) · Automatic · High confidence');

  await popup.evaluate(`t.openTeach('Preferred Working Location'); true`);
  await waitFor(popup, `!!t.li('Preferred Working Location').querySelector('.teach-editor')`);
  const options = await popup.evaluate(`t.options('Preferred Working Location')`);
  const optionKeys = options.map(([key]) => key);
  check('5-6. Teach shows a selector of canonical profile fields for this field type', ['city', 'state', 'postal_code', 'full_name', 'first_name'].every((k) => optionKeys.includes(k)) && !optionKeys.includes('requires_sponsorship') && !optionKeys.includes('willing_to_relocate') && options.find(([k]) => k === 'city')?.[1] === 'City', `${options.length - 1} options`);
  await popup.evaluate(`t.button('Cancel', t.li('Preferred Working Location')).click(); true`);

  await teach(popup, 'Preferred Working Location', 'city');
  pref = await item(popup, 'Preferred Working Location');
  check('7-8. saved; field shown as user-taught', pref.mapping === '→ City (location.city) · Taught by you' && pref.note === 'Taught by you. Select to fill.' && !pref.checked && !pref.disabled && pref.action === 'Change', JSON.stringify(pref));
  let v = await values(tab);
  check('9. teaching did not fill the page', Object.values(v).every((x) => x === '') && (await tab.evaluate(`document.querySelector('#events').textContent`)) === '0');

  const listed = await listMappings(profile);
  const storedJson = JSON.stringify(listed);
  check('mapping persisted with metadata only', listed.ok && listed.data.mappings.length === 1 && listed.data.mappings[0].parts.question === 'preferred working location' && listed.data.mappings[0].profileField === 'city' && listed.data.mappings[0].site === '127.0.0.1', storedJson);
  check('31. no profile values stored in mappings', SENSITIVE.every((s) => !storedJson.includes(s)));

  await popup.evaluate(`t.toggle('Preferred Working Location'); true`);
  await sleep(100);
  let summary = await fill(popup);
  v = await values(tab);
  check('10-12. Fill fills approved fields including the taught one', v.pref === 'Springfield' && v.first === 'Jane' && v.email === 'jane.doe@example.com' && v.phone === '+1 555 010 0199', summary);
  check('28. unknown field left untouched', v.cur === '');
  let rec = await recordedFillValues(tab);
  check('11/30. content script received only approved pairs', JSON.stringify(rec.values) === JSON.stringify(['Jane', 'jane.doe@example.com', 'Springfield', '+1 555 010 0199']) && !rec.raw.includes(LINKEDIN) && !rec.raw.includes('Ontario') && !rec.raw.includes('savedMappings') && !rec.raw.includes('preferred working location'), JSON.stringify(rec.values));
  check('29. no submission', (await tab.evaluate(`document.querySelector('#submitted').textContent`)) === 'false' && (await tab.evaluate('location.pathname')) === '/teach.html');
  let shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase4-taught.png'), Buffer.from(shot.data, 'base64'));
  await popup.close();

  // ============ Persistence ============
  await reloadTab(tab);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  await installRecorder(tab);
  pref = await item(popup, 'Preferred Working Location');
  check('13-16. after reload, the saved mapping is reused and shown as taught', pref.mapping === '→ City (location.city) · Taught by you' && !pref.checked, JSON.stringify(pref));
  check('17. no automatic fill on analysis', Object.values(await values(tab)).every((x) => x === ''));
  // 32: the page removes a field between Analyze and Fill.
  await tab.evaluate(`document.querySelector('#phone').parentElement.remove(); true`);
  await popup.evaluate(`t.toggle('Preferred Working Location'); true`);
  await sleep(100);
  summary = await fill(popup);
  v = await values(tab);
  check('18. explicit approval + Fill uses the saved mapping', v.pref === 'Springfield', summary);
  check('32. removed field does not break filling', (await item(popup, 'Phone')).note === 'Not found. The field is no longer on the page.' && v.first === 'Jane', summary);
  await popup.close();

  // ============ Re-mapping ============
  await reloadTab(tab);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  await installRecorder(tab);
  await popup.evaluate(`t.openTeach('Preferred Working Location'); true`);
  await waitFor(popup, `!!t.li('Preferred Working Location').querySelector('.teach-editor')`);
  check('Change starts from the current target', (await popup.evaluate(`t.selected('Preferred Working Location')`)) === 'city');
  await popup.evaluate(`t.button('Cancel', t.li('Preferred Working Location')).click(); true`);
  await teach(popup, 'Preferred Working Location', 'state');
  pref = await item(popup, 'Preferred Working Location');
  check('19-20. re-mapped and saved', pref.mapping === '→ State / province (location.state) · Taught by you' && !pref.checked, JSON.stringify(pref));
  check('re-mapping did not fill', Object.values(await values(tab)).every((x) => x === ''));
  const afterRemap = await listMappings(profile);
  check('previous mapping replaced (still one mapping)', afterRemap.data.mappings.length === 1 && afterRemap.data.mappings[0].profileField === 'state');
  await popup.evaluate(`t.toggle('Preferred Working Location'); true`);
  await sleep(100);
  summary = await fill(popup);
  v = await values(tab);
  rec = await recordedFillValues(tab);
  check('21-22. new target used', v.pref === 'Ontario', summary);
  check('23. old target no longer used', !rec.raw.includes('Springfield'), JSON.stringify(rec.values));
  await popup.close();

  // Also re-map an automatic field, to test that deterministic mapping resumes after deletion.
  await reloadTab(tab);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  check('First Name automatic before re-mapping', (await item(popup, 'First Name')).mapping === '→ First name (identity.firstName) · Automatic · High confidence');
  await teach(popup, 'First Name', 'full_name');
  const first = await item(popup, 'First Name');
  check('automatic field re-mapped by the user, now needs approval', first.mapping === '→ Full name (identity.fullName) · Taught by you' && !first.checked, JSON.stringify(first));
  await popup.close();

  // ============ Deletion (management view) ============
  const manage = await open(`chrome-extension://${id}/profile.html#saved-mappings`);
  await waitFor(manage, `document.querySelectorAll('.mapping-list li').length === 2`);
  const rows = await manage.evaluate(`[...document.querySelectorAll('.mapping-list li')].map((li) => li.innerText.replace(/\\n/g, ' | '))`);
  console.log('      saved mappings:\n        ' + rows.join('\n        '));
  check('management view lists mappings with field metadata, target, and site', rows.some((r) => r.includes('“preferred working location”') && r.includes('State / province (location.state)') && r.includes('taught on 127.0.0.1')) && rows.some((r) => r.includes('“first name”') && r.includes('Full name')));
  shot = await manage.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await manage.evaluate(`document.getElementById('saved-mappings').scrollIntoView(); true`);
  await sleep(200);
  shot = await manage.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase4-manage.png'), Buffer.from(shot.data, 'base64'));
  await manage.evaluate(`[...document.querySelectorAll('.mapping-list li')].find((li) => li.innerText.includes('preferred working location')).querySelector('button').click(); true`);
  check('24. mapping deleted', await waitFor(manage, `document.querySelectorAll('.mapping-list li').length === 1 && document.querySelector('#saved-mappings [role=status]')?.textContent === 'Mapping deleted.'`));

  await reloadTab(tab);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  pref = await item(popup, 'Preferred Working Location');
  check('25-26. deleted mapping no longer applied', pref.mapping === 'No match' && pref.disabled && pref.action === 'Teach', JSON.stringify(pref));
  await popup.close();

  // Delete all (with confirmation), then deterministic mapping returns for First Name.
  await manage.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Delete all mappings')).click(); true`);
  await sleep(200);
  check('delete-all asks for confirmation', await manage.evaluate(`document.querySelectorAll('dialog[open]').length === 1 && document.querySelector('dialog[open] h2').textContent === 'Delete all saved mappings?'`));
  await manage.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Delete all').click(); true`);
  check('all mappings deleted', await waitFor(manage, `document.body.innerText.includes('No saved mappings yet.')`));
  const profileAfter = JSON.parse(await manage.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }).then((r) => JSON.stringify(r))`));
  check('deleting mappings does not change the profile', profileAfter.data.location.city === 'Springfield' && profileAfter.data.identity.firstName === 'Jane');

  await reloadTab(tab);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  const firstAgain = await item(popup, 'First Name');
  check('27. deterministic mapping returns (automatic, pre-selected)', firstAgain.mapping === '→ First name (identity.firstName) · Automatic · High confidence' && firstAgain.checked, JSON.stringify(firstAgain));
  await popup.close();

  // ============ Safety: content scripts cannot touch mappings ============
  const world = isolatedWorld(tab);
  const attempts = await tab.evaluate(`Promise.all([
      chrome.runtime.sendMessage({ type: 'applyonce/list-mappings' }),
      chrome.runtime.sendMessage({ type: 'applyonce/save-mapping', payload: { field: { id: 'x', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, signals: { label: 'Evil' } }, profileField: 'email' } }),
      chrome.runtime.sendMessage({ type: 'applyonce/clear-mappings' }),
      chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }),
    ]).then((r) => JSON.stringify(r))`, world.id);
  check('content script cannot list, save, or clear mappings, or read the profile', attempts === JSON.stringify(Array(4).fill({ ok: false, error: 'forbidden' })), attempts);
  const pageState = JSON.parse(await tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce/i.test(k)) })`));
  check('30. full profile never exposed to the page', !pageState.html.includes(LINKEDIN) && pageState.local.length === 0 && pageState.session.length === 0 && pageState.globals.length === 0);
  check('29. never submitted', (await tab.evaluate(`document.querySelector('#submitted').textContent`)) === 'false');
} catch (error) {
  check('run completed', false, String(error));
} finally {
  chrome.kill();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
