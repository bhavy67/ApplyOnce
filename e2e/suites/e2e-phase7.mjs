// Phase 7 verification (custom dropdowns) in real Chrome via the DevTools pipe. Fake data only.
import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

// Repo-relative paths: suites live in e2e/suites, output goes to e2e/.out (git-ignored).
const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const SCRATCH = join(E2E, '.out');
e2eMkdir(SCRATCH, { recursive: true });
const DIST = join(ROOT, 'apps/chrome-extension/dist');
const FW = join(SCRATCH, 'fixtures/fw');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Plain page: vanilla ARIA widgets ----------------
const PLAIN = `<!doctype html><html><head><title>Plain Dropdown Form</title>
<style>[role=listbox]{border:1px solid #999;margin:2px 0;padding:2px} [role=option]{padding:2px;cursor:pointer}</style></head><body>
<form id="app"><div id="fields"></div>
  <button type="button" id="rerender">Re-render work mode</button>
  <button type="submit">Submit</button>
</form>
<pre id="state"></pre><p id="submitted">false</p>
<script>
  const state = { firstName: '', country: '', countryRes: '', etype: '', mode: '', degree: '', city: '', notice: '60', arrangement: '', relocate: '', fos: '', role: '' };
  window.__widgetOpens = 0;
  const render = () => { document.getElementById('state').textContent = JSON.stringify(state); };
  const fields = document.getElementById('fields');
  fields.insertAdjacentHTML('beforeend', '<div class="field"><label for="first">First Name</label><input id="first" name="firstName"></div>');
  fields.insertAdjacentHTML('beforeend', '<div class="field"><label for="country">Country</label><select id="country" name="country"><option value="">Select…</option><option value="IN">India</option><option value="CA">Canada</option></select></div>');
  document.getElementById('first').addEventListener('input', (e) => { state.firstName = e.target.value; render(); });
  document.getElementById('country').addEventListener('change', (e) => { state.country = e.target.value; render(); });

  function mountWidget(c) {
    const lbIds = c.listboxIds ?? [c.id + '-listbox'];
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.dataset.widget = c.id;
    wrap.innerHTML = '<label id="' + c.id + '-label" for="' + c.id + '">' + c.label + '</label>';
    const control = document.createElement(c.kind === 'input' ? 'input' : c.kind === 'button' ? 'button' : 'div');
    control.id = c.id;
    if (c.kind === 'button') { control.type = 'button'; control.setAttribute('aria-haspopup', 'listbox'); } else control.setAttribute('role', 'combobox');
    if (c.selfLabel) control.setAttribute('aria-labelledby', c.id + '-label ' + c.id);
    if (!c.noRelationship) {
      control.setAttribute('aria-expanded', 'false');
      if (!c.controlsOnlyWhenOpen) control.setAttribute('aria-controls', lbIds.join(' '));
    }
    wrap.append(control);
    if (c.nativeHidden) wrap.insertAdjacentHTML('beforeend', '<input name="' + c.id + '-native" aria-hidden="true" tabindex="-1" style="opacity:0;position:absolute;pointer-events:none">');
    const outside = document.createElement('div');
    wrap.append(outside);
    const old = document.querySelector('[data-widget="' + c.id + '"]');
    if (old) old.replaceWith(wrap); else fields.append(wrap);
    document.querySelectorAll('[data-owner="' + c.id + '"]').forEach((n) => n.remove());

    let listboxes = [];
    const labelOf = (v) => c.options.find((o) => o.value === v)?.label ?? '';
    const display = () => {
      const text = labelOf(state[c.key]);
      if (c.valueOutside) outside.textContent = text;
      else if (c.kind === 'input') control.value = text;
      else control.textContent = text || 'Select…';
    };
    const make = (id) => {
      const lb = document.createElement('div');
      lb.id = id; lb.setAttribute('role', 'listbox'); lb.hidden = true; lb.dataset.owner = c.id;
      (c.portal ? document.body : wrap).append(lb);
      return lb;
    };
    const renderOptions = () => listboxes.forEach((lb) => {
      lb.innerHTML = '';
      c.options.forEach((o) => {
        const el = document.createElement('div');
        el.setAttribute('role', 'option');
        el.dataset.value = o.value;
        const isSel = state[c.key] === o.value;
        el.setAttribute('aria-selected', isSel ? 'true' : 'false');
        el.innerHTML = '<span>' + o.label + '</span>' + (c.checkmarks && isSel ? '<span aria-hidden="true"> ✓</span>' : '');
        el.addEventListener('click', () => { state[c.key] = o.value; display(); render(); close(); });
        lb.append(el);
      });
    });
    const open = () => {
      if (control.getAttribute('aria-expanded') === 'true') return;
      window.__widgetOpens += 1;
      if (!listboxes.length) listboxes = lbIds.map(make);
      listboxes.forEach((lb) => { lb.hidden = false; });
      control.setAttribute('aria-expanded', 'true');
      if (c.controlsOnlyWhenOpen) control.setAttribute('aria-controls', lbIds.join(' '));
      if (c.optionsDelayMs) setTimeout(renderOptions, c.optionsDelayMs); else renderOptions();
    };
    const close = () => {
      control.setAttribute('aria-expanded', 'false');
      if (c.controlsOnlyWhenOpen) control.removeAttribute('aria-controls');
      if (c.createOnOpen) { listboxes.forEach((lb) => lb.remove()); listboxes = []; }
      else listboxes.forEach((lb) => { lb.hidden = true; });
    };
    if (!c.createOnOpen && !c.noRelationship) listboxes = lbIds.map(make);
    display();
    control.addEventListener(c.openOn ?? 'click', () => (control.getAttribute('aria-expanded') === 'true' && (c.openOn ?? 'click') === 'click' ? close() : open()));
    control.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  const COUNTRIES = [{ value: 'IN', label: 'India' }, { value: 'CA', label: 'Canada' }];
  const TYPES = [{ value: 'ft', label: 'Full time' }, { value: 'pt', label: 'Part time' }, { value: 'c', label: 'Contract' }];
  const MODES = [{ value: 'r', label: 'Remote' }, { value: 'h', label: 'Hybrid' }, { value: 'o', label: 'On-site' }];
  const workMode = { id: 'mode', key: 'mode', label: 'Work Mode', options: MODES, openOn: 'mousedown', createOnOpen: true, controlsOnlyWhenOpen: true, optionsDelayMs: 150 };
  mountWidget({ id: 'res', key: 'countryRes', label: 'Country of residence', kind: 'input', options: COUNTRIES });
  mountWidget({ id: 'etype', key: 'etype', label: 'Employment Type', kind: 'button', selfLabel: true, options: TYPES });
  mountWidget(workMode);
  mountWidget({ id: 'degree', key: 'degree', label: 'Highest Degree', portal: true, nativeHidden: true, checkmarks: true, options: [{ value: 'b', label: "Bachelor's" }, { value: 'm', label: "Master's" }, { value: 'p', label: 'PhD' }] });
  mountWidget({ id: 'city', key: 'city', label: 'City', kind: 'input', openOn: 'mousedown', controlsOnlyWhenOpen: true, valueOutside: true, options: [{ value: 'spf', label: 'Springfield' }, { value: 'shv', label: 'Shelbyville' }] });
  mountWidget({ id: 'notice', key: 'notice', label: 'Notice Period', kind: 'button', options: [{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }] });
  mountWidget({ id: 'arr', key: 'arrangement', label: 'Preferred work arrangement', options: [{ value: 'a', label: 'On-site' }, { value: 'b', label: 'On site' }, { value: 'c', label: 'Remote' }] });
  mountWidget({ id: 'reloc', key: 'relocate', label: 'Willing to relocate', listboxIds: ['reloc-a', 'reloc-b'], options: [{ value: 'y', label: 'Yes' }, { value: 'n', label: 'No' }] });
  mountWidget({ id: 'fos', key: 'fos', label: 'Field of Study', noRelationship: true, options: [{ value: 'ph', label: 'Physics' }] });
  mountWidget({ id: 'role', key: 'role', label: 'What kind of role are you looking for?', kind: 'button', options: TYPES });
  document.getElementById('rerender').addEventListener('click', () => mountWidget(workMode));
  document.getElementById('app').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
  render();
</script>
</body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/plain/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PLAIN);
  }
  const match = url.pathname.match(/^\/(react|vue|angular)\/(.*)$/);
  if (match) {
    const file = join(FW, `${match[1]}-cb/dist`, match[2] || 'index.html');
    if (existsSync(file)) {
      res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'text/html; charset=utf-8' });
      return res.end(readFileSync(file));
    }
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// ---------------- Chrome + CDP (relaunchable) ----------------
let chrome;
let send;
const contexts = new Map();
async function launch(userDataDir) {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
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
      } else if (msg.method === 'Runtime.executionContextCreated') {
        const list = contexts.get(msg.sessionId) ?? [];
        list.push(msg.params.context);
        contexts.set(msg.sessionId, list);
      }
    }
  });
  send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      chrome.stdio[3].write(JSON.stringify({ id: nextId, method, params, sessionId }) + '\0');
    });
}
async function shutdown() {
  const exited = new Promise((r) => chrome.once('exit', r));
  await send('Browser.close').catch(() => undefined);
  await Promise.race([exited, sleep(5000)]);
  chrome.kill();
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
async function waitFor(page, expression, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await page.evaluate(expression)) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}
const POPUP_HELPERS = `
  window.t = {
    button: (prefix, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.startsWith(prefix)),
    li: (name) => [...document.querySelectorAll('.review-item')].find((li) => li.querySelector('.field-name').textContent === name),
    item: (name) => { const li = t.li(name); return li && { mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled }; },
    items: () => [...document.querySelectorAll('.review-item')].map((li) => li.querySelector('.field-name').textContent),
    toggle: (name) => t.li(name).querySelector('input[type=checkbox]').click(),
    choose: (name, key) => { const s = t.li(name).querySelector('.teach-editor select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, key); s.dispatchEvent(new Event('change', { bubbles: true })); },
  };
  true`;
async function openPopupFor(extensionId, tab) {
  await send('Target.activateTarget', { targetId: tab.targetId });
  const { targetInfo } = await send('Target.getTargetInfo', { targetId: tab.targetId });
  const { targetInfos: tabs } = await send('Target.getTargets', { filter: [{ type: 'tab' }] });
  await send('Extensions.triggerAction', { id: extensionId, targetId: tabs.find((t) => t.url === targetInfo.url).targetId });
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
async function analyze(popup) {
  await popup.evaluate(`t.button('Analyze').click(); true`);
  await sleep(200);
  await waitFor(popup, `!t.button('Analyzing') && !!document.querySelector('.analysis, .message.error')`);
  return popup.evaluate(`document.querySelector('main').innerText`);
}
async function fill(popup) {
  await popup.evaluate(`t.button('Fill ').click(); true`);
  await sleep(200);
  await waitFor(popup, `!t.button('Filling') && !!document.querySelector('.fill-summary')`);
  return popup.evaluate(`document.querySelector('.fill-summary').textContent`);
}
async function teach(popup, name, key) {
  await popup.evaluate(`t.li(${JSON.stringify(name)}).querySelector('button.teach').click(); true`);
  await waitFor(popup, `!!t.li(${JSON.stringify(name)}).querySelector('.teach-editor')`);
  await popup.evaluate(`t.choose(${JSON.stringify(name)}, ${JSON.stringify(key)}); true`);
  await sleep(50);
  await popup.evaluate(`t.button('Save mapping', t.li(${JSON.stringify(name)})).click(); true`);
  await waitFor(popup, `!t.li(${JSON.stringify(name)}).querySelector('.teach-editor')`);
}
const item = (popup, name) => popup.evaluate(`t.item(${JSON.stringify(name)})`);
const readState = async (tab) => JSON.parse(await tab.evaluate(`document.querySelector('#state').textContent`));
const isolatedWorld = (tab) => (contexts.get(tab.sessionId) ?? []).findLast((c) => c.auxData?.type === 'isolated');
const domValues = (tab) => tab.evaluate(`JSON.stringify([...document.querySelectorAll('input, select, textarea')].map((e) => e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value))`);
function editorSet(values) {
  return `(() => {
    const values = ${JSON.stringify(values)};
    for (const [label, value] of Object.entries(values)) {
      const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label);
      if (!l) throw new Error('No editor field ' + label);
      const el = document.getElementById(l.htmlFor);
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    }
    return true;
  })()`;
}

const OPEN_LISTBOXES = `[...document.querySelectorAll('[role=listbox]')].filter((l) => l.checkVisibility()).length`;
const hi = (target) => `→ ${target} · Automatic · High confidence`;

async function snapshot(tab) {
  return tab.evaluate(`JSON.stringify({ state: document.querySelector('#state').textContent, expanded: [...document.querySelectorAll('[aria-expanded]')].map((e) => e.getAttribute('aria-expanded')), open: ${OPEN_LISTBOXES} })`);
}

async function recorderFor(tab) {
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  return async () => {
    const raw = await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id);
    const values = JSON.parse(raw).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => i.value));
    return { raw, values };
  };
}

async function privacyChecks(label, tab, recorded, approvedValues, baselineHtml) {
  const { raw, values } = await recorded();
  const page = JSON.parse(await tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce/i.test(k)) })`));
  const unapproved = ['Physics', 'Authorized to work in Canada', 'jane.doe@example.com', 'https://www.linkedin.com/in/jane-doe-example'];
  check(`${label}: only approved values crossed to the content script`, JSON.stringify(values) === JSON.stringify(approvedValues), JSON.stringify(values));
  // Page text that was there before ApplyOnce acted (e.g. option labels) is not a leak.
  const leaked = (v) => raw.includes(v) || (page.html.includes(v) && !baselineHtml.includes(v));
  const found = unapproved.filter(leaked).map((v) => `${v} in ${raw.includes(v) ? 'messages' : 'page HTML'}`);
  if (found.length) console.log('      matched: ' + found.join('; ') + ' | page source contains: ' + unapproved.filter((v) => PLAIN.includes(v)).join(', '));
  check(`${label}: no profile/mapping data in page DOM, storage, or globals`, found.length === 0 && !raw.includes('schemaVersion') && !raw.includes('savedMappings') && page.local.length === 0 && page.session.length === 0 && page.globals.length === 0);
}

try {
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')));
  const { id } = await send('Extensions.loadUnpacked', { path: DIST });
  const editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(editorSet({
    'First name': 'Jane', Email: 'jane.doe@example.com', City: 'Springfield', Country: 'Canada', LinkedIn: 'https://www.linkedin.com/in/jane-doe-example',
    'Notice period': '30 days', 'Work mode': 'onsite', 'Employment type': 'full-time', 'Willing to relocate': 'yes',
    'Highest degree': "Master's", 'Field of study': 'Physics', 'Work authorization': 'Authorized to work in Canada',
  }));
  await sleep(100);
  await editor.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  check('profile saved', await waitFor(editor, `document.querySelector('.save-bar [role=status]')?.textContent === 'Profile saved'`));

  // =================== Plain page: every pattern ===================
  let tab = await open(`${ORIGIN}/plain/`);
  await waitFor(tab, `!!document.querySelector('#state') && document.querySelectorAll('[role=combobox], [aria-haspopup=listbox]').length >= 9`);
  const before = await snapshot(tab);
  let popup = await openPopupFor(id, tab);
  await analyze(popup);
  const names = await popup.evaluate('t.items()');
  const expectedNames = ['First Name', 'Country', 'Country of residence', 'Employment Type', 'Work Mode', 'Highest Degree', 'City', 'Notice Period', 'Preferred work arrangement', 'Willing to relocate', 'Field of Study', 'What kind of role are you looking for?'];
  check('A. custom controls detected as one field each (no inner inputs, options, or hidden native input)', JSON.stringify(names) === JSON.stringify(expectedNames), names.join(', '));
  check('A. Analyze leaves the page untouched (nothing opened)', (await snapshot(tab)) === before && (await tab.evaluate('window.__widgetOpens')) === 0);
  const review = {};
  for (const n of names) review[n] = await item(popup, n);
  console.log('      review:');
  for (const [n, r] of Object.entries(review)) console.log(`        [${r.checked ? 'x' : r.disabled ? '-' : ' '}] ${n} | ${r.mapping} | ${r.note}`);
  const expectedMappings = {
    'Country of residence': hi('Country (location.country)'),
    'Employment Type': hi('Employment type (preferences.employmentType)'),
    'Work Mode': hi('Work mode (preferences.workMode)'),
    'Highest Degree': hi('Highest degree (education[0].degree)'),
    City: hi('City (location.city)'),
    'Notice Period': hi('Notice period (experience.noticePeriod)'),
    'What kind of role are you looking for?': 'No match',
  };
  const wrong = Object.entries(expectedMappings).filter(([n, m]) => review[n]?.mapping !== m);
  check('A/B. deterministic mappings and confidence for custom controls (label not taken from the current value)', wrong.length === 0, wrong.map(([n]) => n).join(', '));
  const pre = names.filter((n) => review[n].checked);
  check('B. high-confidence fields pre-selected as for native selects', pre.length === 10 && !pre.includes('Field of Study') && !pre.includes('What kind of role are you looking for?'), pre.join(', '));
  check('F. control without ARIA relationship is unsupported and not selectable', review['Field of Study'].disabled && review['Field of Study'].note === 'Custom dropdown ApplyOnce cannot operate safely. Will not be filled.');

  const plainBaseline = await tab.evaluate('document.documentElement.outerHTML');
  const recorded = await recorderFor(tab);
  await tab.evaluate(`document.getElementById('rerender').click(); true`); // D: re-render between Analyze and Fill
  const rerenderedNode = await tab.evaluate(`document.getElementById('mode').dataset.fresh = '1'; true`);
  const summary = await fill(popup);
  const state = JSON.parse((JSON.parse(await snapshot(tab))).state);
  check('C. explicit Fill summary', summary === '7 fields filled · 1 skipped · 2 failed', summary);
  check('C/ARIA combobox (input, inline listbox)', state.countryRes === 'CA');
  check('C/button + listbox (self-referencing label)', state.etype === 'ft');
  check('D/dynamic listbox: re-rendered control and listbox rediscovered, delayed options', rerenderedNode && state.mode === 'o' && (await tab.evaluate(`document.getElementById('mode').dataset.fresh`)) === '1');
  check('E/portal listbox with hidden native input and decorative check mark', state.degree === 'm');
  check('react-select-like control (value shown outside, confirmed by re-opening)', state.city === 'spf');
  check('native select unchanged', state.country === 'CA' && state.firstName === 'Jane');
  check('C. existing selection preserved', state.notice === '60' && review['Notice Period'] && (await item(popup, 'Notice Period')).note === 'Skipped. The field already has a value.');
  const arr = await item(popup, 'Preferred work arrangement');
  const reloc = await item(popup, 'Willing to relocate');
  check('F. duplicate options fail safely', state.arrangement === '' && arr.note.startsWith('Failed. No unique option matched'), arr.note);
  check('F. multiple listboxes fail safely', state.relocate === '' && reloc.note === 'Failed. Several lists are attached to this control.', reloc.note);
  check('F. unsupported and unknown controls untouched', state.fos === '' && state.role === '');
  check('no popup left open; not submitted', (await tab.evaluate(OPEN_LISTBOXES)) === 0 && (await tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  await privacyChecks('G. plain', tab, recorded, ['Jane', 'Canada', 'Canada', 'full-time', 'onsite', "Master's", 'Springfield', '30 days', 'onsite', true], plainBaseline);
  let shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase7-plain.png'), Buffer.from(shot.data, 'base64'));
  await popup.close();
  await tab.close();

  // =================== Teach Once with a custom combobox ===================
  tab = await open(`${ORIGIN}/plain/`);
  await waitFor(tab, `document.querySelectorAll('[role=combobox], [aria-haspopup=listbox]').length >= 9`);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  const roleName = 'What kind of role are you looking for?';
  const pageBefore = await snapshot(tab);
  await teach(popup, roleName, 'employment_type');
  let role = await item(popup, roleName);
  check('Teach: saved and shown as "Taught by you", not selected', role.mapping === '→ Employment type (preferences.employmentType) · Taught by you' && !role.checked, JSON.stringify(role));
  check('Teach: page unchanged', (await snapshot(tab)) === pageBefore && (await tab.evaluate('window.__widgetOpens')) === 0);
  for (const n of await popup.evaluate('t.items()')) {
    if ((await item(popup, n)).checked) await popup.evaluate(`t.toggle(${JSON.stringify(n)}); true`);
  }
  await popup.evaluate(`t.toggle(${JSON.stringify(roleName)}); true`);
  await sleep(100);
  await fill(popup);
  const taughtState = JSON.parse(JSON.parse(await snapshot(tab)).state);
  check('Teach: approve + Fill selects "Full time" in the custom dropdown', taughtState.role === 'ft' && (await tab.evaluate(`document.getElementById('role').textContent`)) === 'Full time');
  await popup.close();
  await tab.send('Page.reload');
  await sleep(800);
  await waitFor(tab, `document.querySelectorAll('[role=combobox], [aria-haspopup=listbox]').length >= 9`);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  role = await item(popup, roleName);
  check('Teach: after reload the mapping is reused, still taught, not pre-selected', role.mapping.endsWith('Taught by you') && !role.checked);
  check('Teach: nothing filled automatically after reload', JSON.parse(JSON.parse(await snapshot(tab)).state).role === '' && (await tab.evaluate('window.__widgetOpens')) === 0);
  await popup.close();
  await tab.close();

  // =================== React / Vue / Angular ===================
  for (const [label, path] of [['React', 'react'], ['Vue', 'vue'], ['Angular', 'angular']]) {
    tab = await open(`${ORIGIN}/${path}/`);
    const ready = await waitFor(tab, `!!document.querySelector('#state') && !!document.getElementById('etype')`);
    if (!ready) {
      check(`${label}: fixture renders`, false, await tab.evaluate(`document.body.innerText.slice(0, 200)`).catch(() => ''));
      continue;
    }
    const start = await snapshot(tab);
    popup = await openPopupFor(id, tab);
    await analyze(popup);
    const fwNames = await popup.evaluate('t.items()');
    check(`${label}: custom controls detected`, JSON.stringify(fwNames) === JSON.stringify(['First Name', 'Work Mode', 'Employment Type', 'Notice Period', roleName]), fwNames.join(', '));
    check(`${label}: Analyze leaves framework state untouched`, (await snapshot(tab)) === start);
    const fwReview = {};
    for (const n of fwNames) fwReview[n] = await item(popup, n);
    check(`${label}: mappings (taught mapping from the plain page applies here too)`, fwReview['Work Mode'].mapping === hi('Work mode (preferences.workMode)') && fwReview['Employment Type'].mapping === hi('Employment type (preferences.employmentType)') && fwReview[roleName].mapping.endsWith('Taught by you') && !fwReview[roleName].checked);
    const fwBaseline = await tab.evaluate('document.documentElement.outerHTML');
    const rec = await recorderFor(tab);
    await tab.evaluate(`document.getElementById('rerender').click(); true`);
    await sleep(200);
    const fwSummary = await fill(popup);
    const fwState = JSON.parse(JSON.parse(await snapshot(tab)).state);
    check(`${label}: Fill summary`, fwSummary === '3 fields filled · 1 skipped · 1 need review', fwSummary);
    check(`${label}: framework state updated (button listbox after re-render, input combobox${label === 'Angular' ? '' : ' with portal'})`, fwState.firstName === 'Jane' && fwState.mode === 'o' && fwState.etype === 'ft', JSON.stringify(fwState));
    check(`${label}: existing selection preserved; taught field not filled without approval`, fwState.notice === '60' && fwState.role === '');
    check(`${label}: no popup left open; not submitted`, (await tab.evaluate(OPEN_LISTBOXES)) === 0 && (await tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
    await privacyChecks(label, tab, rec, ['Jane', 'onsite', 'full-time', '30 days'], fwBaseline);
    if (label === 'React') {
      shot = await popup.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SCRATCH, 'phase7-react.png'), Buffer.from(shot.data, 'base64'));
    }
    await popup.close();
    await tab.close();
  }
  await shutdown();
} catch (error) {
  check('run completed', false, String(error));
  chrome?.kill();
} finally {
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
