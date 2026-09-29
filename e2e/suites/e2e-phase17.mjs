// Phase 17 (security, privacy, permissions) in real Chrome. Hostile local pages only, fake data
// only, and every request to anything but the local fixture server is blocked. Nothing is
// submitted, nobody signs in, nothing is uploaded. No real site is contacted by this suite.
import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const SCRATCH = join(E2E, '.out');
e2eMkdir(SCRATCH, { recursive: true });
const DIST = join(ROOT, 'apps/chrome-extension/dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- shared fixture matrix (as in Phase 16) ----------------
const NAV_BUTTONS = ['Back', 'Save', 'Next', 'Continue', 'Save and Continue', 'Apply', 'Finish', 'Submit'];
function questions(attrs) {
  const text = (id, label, type = 'text') => `<div data-automation-id="formField-${id}"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${attrs(id)}></div>`;
  return [
    text('first_name', 'First Name'),
    text('email', 'Email', 'email'),
    `<section aria-label="Links">${text('website', 'Website', 'url')}</section>`,
    text('years', 'Years of Experience', 'number'),
    `<div data-automation-id="formField-address"><label for="address">Address</label><textarea id="address" name="address" ${attrs('address')}></textarea></div>`,
    text('city', 'City'),
    `<div data-automation-id="formField-country"><label for="country">Country</label><select id="country" name="country" ${attrs('country')}><option value="">Select…</option><option>Canada</option><option>India</option></select><input type="text" name="country_helper" style="display:none"></div>`,
    `<div data-automation-id="formField-relocate"><label><input type="checkbox" id="relocate" name="relocate" ${attrs('relocate')}> Willing to relocate</label></div>`,
    `<fieldset data-automation-id="formField-sponsor"><legend>Will you require visa sponsorship?</legend><label><input type="radio" name="sponsor" value="yes" ${attrs('sponsor')}> Yes</label><label><input type="radio" name="sponsor" value="no" ${attrs('sponsor')}> No</label></fieldset>`,
    `<div data-automation-id="formField-mode"><label id="mode-l">Work mode</label><div id="mode" role="combobox" tabindex="0" aria-labelledby="mode-l" aria-controls="mode-list" aria-expanded="false" ${attrs('mode')}></div><ul id="mode-list" role="listbox" hidden><li role="option" data-value="remote">Remote</li><li role="option" data-value="hybrid">Hybrid</li><li role="option" data-value="onsite">On-site</li></ul></div>`,
    text('nick', 'What name should we use?'),
    text('degree_a', 'Degree'),
    text('degree_b', 'Degree'),
    `<div id="slot"></div>`,
    ...NAV_BUTTONS.map((b) => `<button${b === 'Submit' ? ' type="submit"' : ''} data-nav="${b}">${b}</button>`),
  ].join('\n');
}
const WORKDAY_EDU = [1, 2].map((n) => `<div data-automation-id="education-${n}"><h4>Education ${n}</h4>
  <div data-automation-id="formField-school"><label for="school${n}">School or University</label><input id="school${n}" data-automation-id="school" aria-autocomplete="list" aria-controls="school${n}-list" aria-expanded="false"><ul id="school${n}-list" role="listbox" hidden></ul></div>
  <div data-automation-id="formField-fieldOfStudy"><label for="fos${n}">Field of Study</label><input id="fos${n}" data-automation-id="fieldOfStudy"></div></div>`).join('');
const FIXTURES = {
  generic: {
    note: '',
    wrap: (q) => `<form id="apply">${q}</form>`,
    attrs: () => '',
  },
  workday: {
    note: 'Workday page: ApplyOnce fills the current step only. Move to the next step yourself, then analyze again.',
    wrap: (q) => `<form id="apply"><div data-automation-id="applyFlowPage"><div data-automation-id="educationSection">${WORKDAY_EDU}</div>${q}</div></form>`,
    attrs: (name) => `data-automation-id="${name}"`,
  },
  greenhouse: {
    note: 'Greenhouse page: ApplyOnce fills this form only. Voluntary self-identification questions are never filled.',
    wrap: (q) => `<form id="application-form"><div class="application--questions"><div><label for="question_120">LinkedIn Profile</label><input id="question_120" name="question_120"></div><div><label for="resume">Resume</label><input type="file" id="resume"></div>${q}</div><div class="eeoc__container"><label for="gender">Gender</label><select id="gender"><option value=""></option><option>Female</option><option>Male</option></select></div></form>`,
    attrs: () => '',
  },
};
const PAGE_SCRIPT = `
const SCHOOLS = ['University A', 'University B', 'Example Institute'];
window.__counters = { submits: 0, nav: {} };
const out = () => (document.getElementById('counters').textContent = JSON.stringify(window.__counters));
function wire() {
  const form = document.querySelector('form');
  form.addEventListener('submit', (e) => { e.preventDefault(); window.__counters.submits += 1; out(); });
  for (const b of form.querySelectorAll('[data-nav]')) b.addEventListener('click', () => { window.__counters.nav[b.dataset.nav] = (window.__counters.nav[b.dataset.nav] ?? 0) + 1; out(); });
  // A page script that submits its form as soon as City changes (accidental submission).
  document.getElementById('city').addEventListener('change', () => form.requestSubmit());
  const mode = document.getElementById('mode'); const list = document.getElementById('mode-list');
  const close = () => { list.hidden = true; mode.setAttribute('aria-expanded', 'false'); };
  mode.addEventListener('click', () => { list.hidden = false; mode.setAttribute('aria-expanded', 'true'); });
  mode.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  for (const o of list.querySelectorAll('[role=option]')) o.addEventListener('click', () => {
    for (const x of list.querySelectorAll('[role=option]')) x.setAttribute('aria-selected', 'false');
    o.setAttribute('aria-selected', 'true'); mode.textContent = o.textContent; close();
  });
  for (const input of document.querySelectorAll('input[aria-autocomplete=list]')) {
    const sl = document.getElementById(input.getAttribute('aria-controls'));
    const hide = () => { sl.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      sl.innerHTML = q ? SCHOOLS.filter((s) => s.toLowerCase().startsWith(q)).map((s, i) => '<li role="option" id="' + sl.id + '-' + i + '">' + s + '</li>').join('') : '';
      sl.hidden = sl.children.length === 0; input.setAttribute('aria-expanded', String(!sl.hidden));
      for (const o of sl.querySelectorAll('[role=option]')) o.addEventListener('click', () => {
        input.closest('[data-automation-id^="formField"]').insertAdjacentHTML('beforeend', '<div data-automation-id="selectedItem">' + o.textContent + '</div>');
        input.value = ''; hide();
      });
    });
  }
}
window.read = () => {
  const v = (id) => { const e = document.getElementById(id); return !e ? null : e.type === 'checkbox' ? e.checked : e.value; };
  return {
    first_name: v('first_name'), email: v('email'), website: v('website'), years: v('years'), address: v('address'), city: v('city'),
    country: v('country'), relocate: v('relocate'), sponsor: document.querySelector('input[name=sponsor]:checked')?.value ?? '',
    mode: document.getElementById('mode')?.textContent ?? '', nick: v('nick'), degree_a: v('degree_a'), degree_b: v('degree_b'), portfolio: v('portfolio'),
    linkedin: v('question_120'), gender: v('gender'),
    pills: [...document.querySelectorAll('[data-automation-id=selectedItem]')].map((p) => p.closest('[data-automation-id^=education]')?.dataset.automationId + ':' + p.textContent),
    fos1: v('fos1'), fos2: v('fos2'),
  };
};
window.prefill = () => {
  const set = (id, value) => { const e = document.getElementById(id); e.value = value; };
  set('first_name', 'Kept Name'); set('country', 'India'); set('address', 'Kept address');
  document.querySelector('input[name=sponsor][value=yes]').checked = true;
  document.getElementById('relocate').checked = true;
  const mode = document.getElementById('mode'); mode.textContent = 'On-site';
  document.querySelector('#mode-list [data-value=onsite]').setAttribute('aria-selected', 'true');
  const school = document.getElementById('school1');
  if (school) school.closest('[data-automation-id^="formField"]').insertAdjacentHTML('beforeend', '<div data-automation-id="selectedItem">University B</div>');
};
document.getElementById('add').addEventListener('click', () => {
  document.getElementById('slot').outerHTML = '<div data-automation-id="formField-portfolio"><label for="portfolio">Portfolio</label><input id="portfolio" name="portfolio" type="url"></div><div id="slot"></div>';
});
document.getElementById('rerender').addEventListener('click', () => {
  // New DOM nodes, same structure (values are lost, as on a framework re-render).
  const form = document.querySelector('form'); const html = form.outerHTML; form.replaceWith(Object.assign(document.createElement('div'), { innerHTML: html }).firstElementChild); wire();
});
wire();
if (location.search.includes('prefill')) prefill();
`;

// ---------------- hostile page script ----------------
// Runs first in the page's main world: it monkey-patches value setters and EventTarget methods,
// listens to every event, watches the DOM, and probes for the extension. Everything it learns
// is kept in window.__observed for the suite to inspect.
const HOSTILE_HEAD = `<script>
(() => {
  const observed = window.__observed = { setterValues: [], dispatched: [], eventValues: [], mutations: [], probes: {} };
  for (const proto of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype, HTMLSelectElement.prototype]) {
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    Object.defineProperty(proto, 'value', { configurable: true, get() { return d.get.call(this); }, set(v) { observed.setterValues.push(String(v)); d.set.call(this, v); } });
  }
  const dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (e) { observed.dispatched.push(e.type); return dispatch.call(this, e); };
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, l, o) { return add.call(this, t, l, o); };
  for (const t of ['input', 'change', 'click', 'keydown', 'focusin', 'pointerdown', 'mousedown']) {
    add.call(document, t, (e) => { const v = e.target && 'value' in e.target ? e.target.value : undefined; if (v) observed.eventValues.push(String(v)); }, true);
  }
  new MutationObserver((records) => { for (const r of records) observed.mutations.push(r.type === 'attributes' ? r.attributeName + '=' + (r.target.getAttribute(r.attributeName) ?? '') : r.type); })
    .observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
  observed.probes.chrome = typeof chrome === 'undefined' ? 'undefined' : Object.keys(chrome).join(',');
  observed.probes.runtime = typeof chrome !== 'undefined' && chrome.runtime ? Object.keys(chrome.runtime).join(',') : 'none';
  window.addEventListener('message', (e) => observed.mutations.push('message:' + JSON.stringify(e.data).slice(0, 80)));
})();
</script>`;

const hostileLabel = `&lt;img src=x onerror="document.title='XSS'"&gt; Degree`;
const ADVERSARIAL = `<form id="apply">
  <div><label for="city">City</label><input id="city" name="city"></div>
  <div><label for="email">Email</label><input id="email" name="email" type="email"></div>
  <div><label id="mode-l">Work mode</label><button id="mode" aria-haspopup="listbox" aria-labelledby="mode-l" aria-controls="mode-list" aria-expanded="false"></button><ul id="mode-list" role="listbox" hidden><li role="option">Remote</li><li role="option">Hybrid</li></ul></div>
  <div><label id="country-l">Country</label><div id="country" role="combobox" tabindex="0" aria-labelledby="country-l" aria-controls="country-list" aria-expanded="false"></div><ul id="country-list" role="listbox" hidden><button type="submit" role="option">Canada</button><li role="option">India</li></ul></div>
  ${NAV_BUTTONS.map((b) => `<button${b === 'Submit' ? ' type="submit"' : ''} data-nav="${b}">${b}</button>`).join('')}
</form>
<p id="counters">{"submits":0,"nav":{}}</p>
<script>
  window.__counters = { submits: 0, nav: {} };
  const form = document.getElementById('apply');
  const out = () => (document.getElementById('counters').textContent = JSON.stringify(window.__counters));
  form.addEventListener('submit', (e) => { e.preventDefault(); window.__counters.submits += 1; out(); });
  for (const b of form.querySelectorAll('[data-nav]')) b.addEventListener('click', () => { window.__counters.nav[b.dataset.nav] = 1; out(); });
  document.getElementById('city').addEventListener('change', () => form.requestSubmit());            // onchange submits
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') form.requestSubmit(); });      // Enter submits
  document.getElementById('email').addEventListener('keydown', () => form.requestSubmit());           // any key submits
  for (const [id] of [['mode'], ['country']]) {
    const c = document.getElementById(id), l = document.getElementById(id + '-list');
    const show = () => { l.hidden = false; c.setAttribute('aria-expanded', 'true'); };
    c.addEventListener('pointerdown', show); c.addEventListener('click', show);
    c.addEventListener('keydown', (e) => { if (e.key === 'Escape') { l.hidden = true; c.setAttribute('aria-expanded', 'false'); } });
    for (const o of l.querySelectorAll('[role=option]')) o.addEventListener('click', () => { o.setAttribute('aria-selected', 'true'); c.textContent = o.textContent; l.hidden = true; c.setAttribute('aria-expanded', 'false'); });
  }
</script>`;
const NAV_ONCHANGE = `<form><label for="city">City</label><input id="city" name="city"><label for="email">Email</label><input id="email" type="email"></form>
<script>document.getElementById('city').addEventListener('change', () => { location.href = '/navigated'; });</script>`;
const SPOOF = `<form>
  <label for="country">Country</label><select id="country"><option value=""></option><option value="Canada">India</option><option value="CA">Canada</option></select>
  <label id="mode-l">Work mode</label><div id="mode" role="combobox" tabindex="0" aria-labelledby="mode-l" aria-controls="mode-list" aria-expanded="false"></div><ul id="mode-list" role="listbox" hidden><li role="option" data-value="hybrid">Hybrid</li><li role="option" data-value="h2">Hybrid</li></ul>
  <label for="email">Email</label><input id="email" type="email">
</form>
<script>
  const c = document.getElementById('mode'), l = document.getElementById('mode-list');
  c.addEventListener('click', () => { l.hidden = false; c.setAttribute('aria-expanded', 'true'); });
  c.addEventListener('keydown', (e) => { if (e.key === 'Escape') { l.hidden = true; c.setAttribute('aria-expanded', 'false'); } });
  for (const o of l.querySelectorAll('[role=option]')) o.addEventListener('click', () => { c.textContent = o.textContent; });
</script>`;
const LABELS = `<form><h2>Education</h2>
  <div><label for="d1">${hostileLabel}</label><input id="d1" name="d1"></div>
  <div><label for="d2">${hostileLabel}</label><input id="d2" name="d2"></div>
  <div><label for="fn">First Name</label><input id="fn" name="fn"></div>
</form>`;

const page = (platform) => {
  const f = FIXTURES[platform];
  const body = platform === 'workday' ? f.wrap(questions(f.attrs)) : f.wrap(questions(f.attrs)).replace(/ data-automation-id="formField-[^"]*"/g, '').replace('<input type="text" name="country_helper" style="display:none">', '');
  return `<!doctype html><html lang="en"><head><title>${platform} fixture</title>${HOSTILE_HEAD}</head><body>
<h1>Apply</h1>${body}
<button type="button" id="add">Add a question</button><button type="button" id="rerender">Re-render</button>
<p id="counters">{"submits":0,"nav":{}}</p>
<script>${PAGE_SCRIPT}</script></body></html>`;
};
const simple = (title, body) => `<!doctype html><html lang="en"><head><title>${title}</title>${HOSTILE_HEAD}</head><body>${body}</body></html>`;
const PAGES = {
  '/adversarial/apply': simple('Adversarial', ADVERSARIAL),
  '/nav-onchange/apply': simple('Navigates on change', NAV_ONCHANGE),
  '/navigated': simple('Navigated', '<p>navigated</p>'),
  '/spoof/apply': simple('Spoofed options', SPOOF),
  '/labels/apply': simple('Hostile labels', LABELS),
};

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const platform = path.split('/')[1];
  const html = PAGES[path] ?? (FIXTURES[platform] ? page(platform) : undefined);
  if (!html) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
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
const consoleLog = [];
async function launch(userDataDir, extraArgs = []) {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check', ...extraArgs, 'about:blank',
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
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        consoleLog.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleLog.push(String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text));
      } else if (msg.method === 'Fetch.requestPaused') {
        globalThis.__onRequestPaused?.(msg);
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


// ---------------- network control: only the local fixture server and the extension ----------------
const guarded = new Set();
const blocked = [];
globalThis.__onRequestPaused = (msg) => {
  if (!guarded.has(msg.sessionId)) return;
  const { requestId, request } = msg.params;
  const local = request.url.startsWith(ORIGIN) || /^(chrome-extension|data|about|blob):/.test(request.url);
  if (local) send('Fetch.continueRequest', { requestId }, msg.sessionId).catch(() => undefined);
  else {
    blocked.push(`${request.method} ${request.url.slice(0, 80)}`);
    send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, msg.sessionId).catch(() => undefined);
  }
};
async function openPage(path) {
  const tab = await open('about:blank');
  await tab.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  guarded.add(tab.sessionId);
  await tab.send('Page.enable');
  await tab.send('Page.navigate', { url: `${ORIGIN}${path}` });
  await waitFor(tab, `document.readyState === 'complete' && location.href.startsWith(${JSON.stringify(ORIGIN)}) && !!window.__observed`);
  return tab;
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idb = (body) => `new Promise((resolve, reject) => { const r = indexedDB.open('applyonce'); r.onerror = reject; r.onsuccess = () => { const db = r.result; ${body} }; })`;
const writeRaw = (key, value) => idb(`const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(${JSON.stringify(value)}, '${key}'); tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = reject;`);
const readRaw = (key) => idb(`const req = db.transaction('records').objectStore('records').get('${key}'); req.onsuccess = () => { db.close(); resolve(JSON.stringify(req.result ?? null)); }; req.onerror = reject;`);
const deleteRaw = (key) => idb(`const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').delete('${key}'); tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = reject;`);
const PROFILE = {
  schemaVersion: 4,
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '+1 555 010 0199' },
  location: { address: '1 Example Street', city: 'Springfield', country: 'Canada' },
  links: { linkedin: 'https://www.linkedin.com/in/jane-doe-example', website: 'https://jane.example.com', portfolio: 'https://portfolio.example.com' },
  experience: { totalExperienceYears: 6, currentCompany: 'Secret Employer Co' },
  preferences: { workMode: 'hybrid', openToRelocation: true },
  authorization: { requiresSponsorship: false, workAuthorization: 'Private authorization note' },
  education: [
    { id: A, institution: 'University A', degree: 'Degree A', fieldOfStudy: 'Physics' },
    { id: B, institution: 'University B', degree: 'Degree B', fieldOfStudy: 'Chemistry' },
  ],
  workExperience: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', company: 'Hidden Past Employer', title: 'Hidden Title' }],
  certifications: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Hidden Certification' }],
  documents: { resumes: [], coverLetters: [] },
  customAnswers: [],
};
/** Profile values that no fixture question asks for: they must never appear anywhere on a page. */
const NEVER_ON_PAGE = ['Doe', '+1 555', '555 010', 'Secret Employer', 'Private authorization', 'Hidden Past Employer', 'Hidden Title', 'Hidden Certification', 'linkedin.com/in/jane'];
const SECRET = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|fp-[0-9a-f]{16}|m-[0-9a-f]{16}/;

let id;
let editor;
const review = async (popup) => JSON.parse(await popup.evaluate(`JSON.stringify([...document.querySelectorAll('.review-item')].map((li) => ({ name: li.querySelector('.field-name').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, assign: li.querySelector('button.assign')?.textContent ?? null })))`));
const byName = (items, name, n = 0) => items.filter((i) => i.name === name)[n];
const indexOf = (items, name, n = 0) => items.map((it, i) => [it, i]).filter(([it]) => it.name === name)[n]?.[1];
const observed = async (tab) => JSON.parse(await tab.evaluate(`JSON.stringify(window.__observed)`));
async function fillSlow(popup) {
  await popup.evaluate(`t.button('Fill ').click(); true`);
  await sleep(200);
  await waitFor(popup, `!t.button('Filling') && !!document.querySelector('.fill-summary, .analysis .message.error')`, 60000);
  return popup.evaluate(`document.querySelector('.fill-summary')?.textContent ?? document.querySelector('.analysis .message.error')?.textContent ?? ''`);
}
const untickAll = async (popup) => {
  await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]:checked')].forEach((c) => c.click()); true`);
  await sleep(100);
};
async function tickNames(popup, names) {
  const items = await review(popup);
  const indexes = names.map(([name, n = 0]) => indexOf(items, name, n)).filter((i) => i !== undefined);
  await popup.evaluate(`(() => { const items = [...document.querySelectorAll('.review-item')]; for (const i of ${JSON.stringify(indexes)}) { const c = items[i].querySelector('input[type=checkbox]'); if (!c.checked && !c.disabled) c.click(); } return true; })()`);
  await sleep(100);
}
async function assignVia(popup, index, target) {
  const item = `document.querySelectorAll('.review-item')[${index}]`;
  await popup.evaluate(`${item}.querySelector('button.assign').click(); true`);
  await waitFor(popup, `!!${item}.querySelector('.assign-editor select')`);
  await popup.evaluate(`(() => { const s = ${item}.querySelector('.assign-editor select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(target)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(50);
  await popup.evaluate(`[...${item}.querySelectorAll('button')].find((b) => b.textContent === 'Save assignment').click(); true`);
  await waitFor(popup, `!${item}.querySelector('.assign-editor')`);
}
const popupMessage = async (popup, message) => JSON.parse(await popup.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => JSON.stringify(r))`));
const scanFromPopup = async (popup) => JSON.parse(await popup.evaluate(`(async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const r = await chrome.tabs.sendMessage(tab.id, { type: 'applyonce/scan-page' }); const u = new URL(tab.url); return JSON.stringify({ page: u.origin + u.pathname, fields: r.data.fields }); })()`));
const pageSnapshot = (tab) => tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, attrs: [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.value)).join('\\n'), local: Object.entries(localStorage), session: Object.entries(sessionStorage), cookie: document.cookie, globals: Object.keys(window).filter((k) => /applyonce|profile|assign|mapping|record/i.test(k)), title: document.title })`).then(JSON.parse);
async function analyzeOn(tab) {
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  return popup;
}

try {
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')));
  ({ id } = await send('Extensions.loadUnpacked', { path: DIST }));
  for (let i = 0; i < 30; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(id));
    if (worker) { await attach(worker.targetId); break; }
    await sleep(100);
  }
  editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(writeRaw('profile', PROFILE));
  const storeBefore = await editor.evaluate(readRaw('profile'));

  // =================== 1–7. hostile page and message attacks ===================
  for (const platform of ['generic', 'workday', 'greenhouse']) {
    const P = (s) => `[${platform}] ${s}`;
    console.log(`\n===== ${platform} =====`);
    const tab = await openPage(`/${platform}/apply`);
    // The page tries to reach the extension before anything happens.
    const probes = JSON.parse(await tab.evaluate(`(async () => {
      const out = { globals: window.__observed.probes };
      out.sendMessage = await new Promise((r) => { try { chrome.runtime.sendMessage(${JSON.stringify(id)}, { type: 'applyonce/get-profile' }, (x) => r('answer:' + JSON.stringify(x ?? chrome.runtime.lastError?.message))); setTimeout(() => r('no answer'), 1500); } catch (e) { r('threw ' + e.name); } });
      out.resources = await Promise.all(['manifest.json', 'popup.html', 'profile.html', 'background.js', 'content.js'].map((f) => fetch('chrome-extension://${id}/' + f).then((r) => f + ':' + r.status, () => f + ':blocked')));
      window.postMessage({ type: 'applyonce/get-profile' }, '*');
      window.postMessage({ type: 'applyonce/fill-fields', payload: { instructions: [] } }, '*');
      out.databases = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
      return JSON.stringify(out);
    })()`));
    console.log('      page probes: ' + JSON.stringify(probes));
    check(P('1/6. the page cannot reach the extension: no messaging API, no extension resources, no extension database'), !/answer:\{/.test(probes.sendMessage) && probes.resources.every((r) => r.endsWith(':blocked')) && !probes.databases.includes('applyonce'), `${probes.sendMessage} | ${probes.resources.join(' ')}`);

    const popup = await analyzeOn(tab);
    // A compromised content script (the extension's isolated world in this tab) tries everything.
    const world = isolatedWorld(tab);
    const attacks = JSON.parse(await tab.evaluate(`(async () => {
      const send = (m) => chrome.runtime.sendMessage(m).then((r) => r, (e) => ({ threw: String(e) }));
      const field = { id: 'id:x', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, signals: { label: 'Degree' }, repeatedCount: 2, identity: { key: 'fp-00000000000000aa', unique: true } };
      const page = location.origin + location.pathname;
      const messages = [
        { type: 'applyonce/get-profile' }, { type: 'applyonce/get-profile-status' }, { type: 'applyonce/get-record-choices' },
        { type: 'applyonce/list-mappings' }, { type: 'applyonce/list-assignments' }, { type: 'applyonce/get-runtime-info' },
        { type: 'applyonce/map-fields', payload: { fields: [field], page } },
        { type: 'applyonce/fill-page', payload: { tabId: 1, approvals: [{ field, profileField: 'email' }] } },
        { type: 'applyonce/save-mapping', payload: { field, profileField: 'email' } },
        { type: 'applyonce/save-assignment', payload: { page, field, target: 'education@${A}.degree' } },
        { type: 'applyonce/delete-assignment', payload: { page, field } },
        { type: 'applyonce/remove-assignment', payload: { handle: { page, fieldId: 'id:x' } } },
        { type: 'applyonce/delete-mapping', payload: { key: 'v1|text|q=x|c=|i=' } },
        { type: 'applyonce/clear-mappings' }, { type: 'applyonce/clear-assignments' },
        { type: 'applyonce/fill-page', payload: { tabId: 1, approvals: [{ field, profileField: '__proto__' }] } },
      ];
      return JSON.stringify(await Promise.all(messages.map(send)));
    })()`, world.id));
    const refused = attacks.every((r) => r && r.ok === false && (r.error === 'forbidden' || r.error === 'malformed-message'));
    check(P('2–5/7. a compromised content script is refused every privileged message (profile, status, records, mappings, assignments, mutations)'), refused && !SECRET.test(JSON.stringify(attacks)) && !/Jane|University|jane\.doe/.test(JSON.stringify(attacks)), JSON.stringify(attacks.map((a) => a.error ?? a.threw ?? 'ok')));
    check(P('7. extension storage unchanged by the attacks'), (await editor.evaluate(readRaw('profile'))) === storeBefore && (await editor.evaluate(readRaw('savedMappings'))) === 'null' && (await editor.evaluate(readRaw('recordAssignments'))) === 'null');

    // Approved fill, including an explicit record assignment.
    let items = await review(popup);
    const d = indexOf(items, 'Degree');
    await assignVia(popup, d, `education@${A}.degree`);
    await untickAll(popup);
    await tickNames(popup, [['First Name'], ['Email'], ['Country'], ['Work mode'], ['Degree', 0]]);
    // The user's own typing (through the page's patched setter), then the page's log is reset.
    await tab.evaluate(`document.getElementById('address').value = 'Existing address typed by the user'; window.__observed.setterValues = []; true`);
    await tickNames(popup, [['Address']]);
    const summary = await fillSlow(popup);
    const obs = await observed(tab);
    const snap = await pageSnapshot(tab);
    console.log(`      fill: ${summary}\n      page observed: setter=${JSON.stringify(obs.setterValues)} dispatched=${JSON.stringify([...new Set(obs.dispatched)])} eventValues=${JSON.stringify([...new Set(obs.eventValues)])}`);
    const approvedValues = new Set(['Jane', 'jane.doe@example.com', 'Canada', 'Hybrid', 'hybrid', 'Degree A', 'Existing address typed by the user']);
    check(P('8. only approved values entered approved fields'), (await tab.evaluate(`JSON.stringify([first_name.value, email.value, country.value, mode.textContent, degree_a.value, degree_b.value, website.value, years.value])`)) === JSON.stringify(['Jane', 'jane.doe@example.com', 'Canada', 'Hybrid', 'Degree A', '', '', '']));
    check(P('9. an existing page value stays protected'), (await tab.evaluate(`address.value`)) === 'Existing address typed by the user');
    check(P('18. what the page can observe: only the approved values of the approved fields (via events and the DOM)'), [...new Set(obs.eventValues)].every((v) => approvedValues.has(v)), JSON.stringify([...new Set(obs.eventValues)].filter((v) => !approvedValues.has(v))));
    check(P('17. page monkey-patches (value setters, dispatchEvent) never see ApplyOnce: it runs in its own isolated world'), obs.setterValues.length === 0 && !obs.dispatched.some((t) => ['input', 'change', 'pointerdown', 'mousedown', 'keydown'].includes(t)), JSON.stringify(obs.dispatched.slice(0, 10)));
    check(P('4/5/18. no record ids, fingerprints, unrelated values, or hidden attributes anywhere in the page'), !SECRET.test(snap.html) && !NEVER_ON_PAGE.some((v) => snap.html.includes(v) || snap.attrs.includes(v)) && !snap.attrs.includes('jane.doe') && snap.local.length + snap.session.length === 0 && snap.cookie === '' && snap.globals.length === 0 && !obs.mutations.some((m) => /jane|Degree A/i.test(m)), NEVER_ON_PAGE.filter((v) => snap.html.includes(v)).join(', '));
    check(P('11/12. no submit or navigation button clicked'), (await tab.evaluate(`document.getElementById('counters').textContent`)) === '{"submits":0,"nav":{}}');

    // Stale approvals: identity change, assignment changed, record deleted.
    items = await review(popup);
    await untickAll(popup);
    await tickNames(popup, [['Website'], ['Degree', 0], ['Years of Experience']]);
    const before = await scanFromPopup(popup);
    await tab.evaluate(`document.querySelector('section[aria-label=Links]').setAttribute('aria-label', 'Other links'); degree_a.value = ''; true`);
    const degreeA = before.fields.find((f) => f.id.includes('degree_a'));
    await popupMessage(popup, { type: 'applyonce/save-assignment', payload: { page: before.page, field: degreeA, target: `education@${B}.degree` } });
    await editor.evaluate(writeRaw('profile', { ...PROFILE, experience: { ...PROFILE.experience, totalExperienceYears: 7 }, education: [PROFILE.education[0]] }));
    await fillSlow(popup);
    items = await review(popup);
    const s = JSON.parse(await tab.evaluate(`JSON.stringify([website.value, degree_a.value, years.value])`));
    console.log(`      stale: ${JSON.stringify(s)} ${['Website', 'Degree', 'Years of Experience'].map((n) => `${n}: ${byName(items, n)?.note}`).join(' | ')}`);
    check(P('13/16. changed identity refused (section label changed after Analyze)'), s[0] === '' && /changed since Analyze/.test(byName(items, 'Website')?.note ?? ''));
    check(P('14/15. stale assignment refused; the deleted record is not replaced by another'), s[1] === '' && /Failed/.test(byName(items, 'Degree')?.note ?? ''));
    check(P('fresh profile value used (edited after Analyze)'), s[2] === '7');
    await editor.evaluate(writeRaw('profile', PROFILE));
    await popupMessage(popup, { type: 'applyonce/clear-assignments' });
    await popup.close();
    await tab.close();
  }

  // =================== adversarial submission and navigation ===================
  console.log('\n===== adversarial =====');
  let tab = await openPage('/adversarial/apply');
  let popup = await analyzeOn(tab);
  let items = await review(popup);
  for (const r of items) console.log(`        ${r.name} | ${r.mapping}`);
  await untickAll(popup);
  await tickNames(popup, [['City'], ['Email'], ['Work mode'], ['Country']]);
  await fillSlow(popup);
  items = await review(popup);
  const counters = JSON.parse(await tab.evaluate(`document.getElementById('counters').textContent`));
  const notes = Object.fromEntries(['City', 'Email', 'Work mode', 'Country'].map((n) => [n, byName(items, n)?.note]));
  const keys = (await observed(tab)).dispatched;
  console.log(`      notes: ${JSON.stringify(notes)} counters: ${JSON.stringify(counters)}`);
  check('21. input change → requestSubmit: stopped by the page guard, field reported failed', /tried to submit/.test(notes.City ?? '') && counters.submits === 0);
  check('21. a page that submits on Enter or on any key: ApplyOnce sends no keys to text fields and no Enter at all', /^Filled/.test(notes.Email ?? '') && counters.submits === 0);
  check('21/23. a dropdown whose trigger is a submit-type button opens without a click and cannot submit', counters.submits === 0 && Object.keys(counters.nav).length === 0, notes['Work mode']);
  check('23. a matching option that is a submit button is never clicked', /submit or navigation button/.test(notes.Country ?? '') && counters.submits === 0, notes.Country);
  check('11/12. no Next/Continue/Save/Save and Continue/Submit/Apply/Finish/Back clicked', Object.keys(counters.nav).length === 0);
  await popup.close();
  await tab.close();

  tab = await openPage('/nav-onchange/apply');
  popup = await analyzeOn(tab);
  await untickAll(popup);
  await tickNames(popup, [['City'], ['Email']]);
  const navSummary = await fillSlow(popup);
  await sleep(500);
  const landed = await tab.evaluate('location.pathname').catch(() => '?');
  console.log(`      page that navigates on change: ${navSummary} → now at ${landed}`);
  // The page's own change handler assigns location; the navigation happens after the handler
  // returns, so the fill completes and then the page leaves by itself. ApplyOnce cannot stop
  // this (no interceptable event) and does not cause it: it clicked nothing and sent no key.
  check('22. documented limit: a page script that assigns location on change navigates by itself (not interceptable); ApplyOnce clicked nothing', landed === '/navigated', `${navSummary} → ${landed}`);
  await popup.close();
  await tab.close();

  // =================== option spoofing ===================
  tab = await openPage('/spoof/apply');
  popup = await analyzeOn(tab);
  await untickAll(popup);
  await tickNames(popup, [['Country'], ['Work mode'], ['Email']]);
  await fillSlow(popup);
  items = await review(popup);
  const spoofed = JSON.parse(await tab.evaluate(`JSON.stringify([country.value, mode.textContent, email.value])`));
  check('24. spoofed options (value vs visible text; duplicate names) fail safely and stay untouched; other fields fill', spoofed[0] === '' && spoofed[1] === '' && spoofed[2] === 'jane.doe@example.com' && /^Failed/.test(byName(items, 'Country')?.note ?? '') && /^Failed/.test(byName(items, 'Work mode')?.note ?? ''), JSON.stringify([spoofed, byName(items, 'Country')?.note, byName(items, 'Work mode')?.note]));
  await popup.close();
  await tab.close();

  // =================== XSS: hostile profile values and page labels ===================
  const HOSTILE = `<img src=x onerror="document.title='XSS'">`;
  await editor.evaluate(writeRaw('profile', { ...PROFILE, identity: { firstName: HOSTILE, lastName: '<script>document.title="XSS"</script>' }, education: [{ ...PROFILE.education[0], institution: 'javascript:alert(1)' }, PROFILE.education[1]] }));
  await editor.send('Page.reload');
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  const editorState = JSON.parse(await editor.evaluate(`JSON.stringify({ title: document.title, injected: document.querySelectorAll('main img, main script, [onerror]').length, values: [...document.querySelectorAll('input')].map((i) => i.value).filter((v) => /img|script|javascript/.test(v)) })`));
  check('10/26. profile page renders HTML-looking values as plain text (no element, no script)', editorState.title !== 'XSS' && editorState.injected === 0 && editorState.values.includes(HOSTILE), JSON.stringify(editorState));
  tab = await openPage('/labels/apply');
  popup = await analyzeOn(tab);
  items = await review(popup);
  const popupState = JSON.parse(await popup.evaluate(`JSON.stringify({ injected: document.querySelectorAll('.review-list img, .review-list script, [onerror]').length, title: document.title })`));
  check('26. popup renders hostile page labels as text', items.some((i) => i.name.includes('<img src=x onerror=')) && popupState.injected === 0 && popupState.title !== 'XSS', JSON.stringify(popupState));
  await assignVia(popup, indexOf(items, items.find((i) => i.name.includes('Degree'))?.name), `education@${A}.degree`);
  await untickAll(popup);
  await tickNames(popup, [['First Name']]);
  await fillSlow(popup);
  const filledHostile = JSON.parse(await tab.evaluate(`JSON.stringify({ value: fn.value, injected: document.querySelectorAll('body img').length, title: document.title })`));
  check('26. a hostile profile value is filled as literal text into the approved field only', filledHostile.value === HOSTILE && filledHostile.injected === 0 && filledHostile.title !== 'XSS');
  await popup.close();
  await tab.close();
  const manage = await open(`chrome-extension://${id}/profile.html#saved-assignments`);
  await waitFor(manage, `[...document.querySelectorAll('h2')].some((h) => /assignments/i.test(h.textContent))`);
  await sleep(500);
  const manageState = JSON.parse(await manage.evaluate(`JSON.stringify({ text: document.body.innerText.includes('<img src=x onerror='), injected: document.querySelectorAll('main img, [onerror]').length, title: document.title })`));
  check('26. saved-assignment labels (from a hostile page) render as text', manageState.text && manageState.injected === 0 && manageState.title !== 'XSS', JSON.stringify(manageState));
  await manage.close();
  await editor.evaluate(writeRaw('profile', PROFILE));
  await editor.evaluate(deleteRaw('recordAssignments'));

  // =================== storage attacks ===================
  const corruptions = [
    ['profile', 'a wrong-typed section', { ...PROFILE, identity: 'Jane Doe' }],
    ['profile', 'duplicate record ids', { ...PROFILE, education: [PROFILE.education[0], PROFILE.education[0]] }],
    ['profile', 'an unknown version', { ...PROFILE, schemaVersion: 42 }],
    ['savedMappings', 'a mapping with a stored value', { version: 1, mappings: [{ key: 'v1|text|q=x|c=|i=', parts: { fieldType: 'text', question: 'x' }, profileField: 'first_name', value: 'Jane', createdAt: 'x', updatedAt: 'x' }] }],
    ['recordAssignments', 'an assignment to a page with a token', { version: 2, assignments: [{ page: `${ORIGIN}/generic/apply?token=secret`, fieldId: 'id:degree_a', field: { type: 'text', label: 'Degree', repeatedCount: 2 }, target: `education@${A}.degree`, createdAt: 'x', updatedAt: 'x' }] }],
  ];
  for (const [key, label, value] of corruptions) {
    await editor.evaluate(writeRaw(key, value));
    const stored = await editor.evaluate(readRaw(key));
    await editor.send('Page.reload');
    await waitFor(editor, `document.readyState === 'complete' && !!document.querySelector('main')`);
    await sleep(500);
    const editorText = await editor.evaluate(`document.body.innerText`);
    tab = await openPage('/generic/apply');
    popup = await analyzeOn(tab);
    const popupText = await popup.evaluate(`document.querySelector('main').innerText`);
    const safe =
      key === 'profile'
        ? /could not be loaded/.test(editorText) && /could not be loaded/.test(popupText)
        : /could not be loaded/.test(editorText) && (await review(popup)).length > 0;
    check(`11. corrupted ${key} (${label}): refused with a clear message, nothing crashes, stored data unchanged`, safe && (await editor.evaluate(readRaw(key))) === stored && !/TypeError|undefined|stack/i.test(editorText + popupText), (editorText.match(/[^\n]*could not be loaded[^\n]*/) ?? [''])[0]);
    await popup.close();
    await tab.close();
    if (key === 'profile') await editor.evaluate(writeRaw('profile', PROFILE));
    else await editor.evaluate(deleteRaw(key));
  }

  // =================== console, network, build ===================
  const logged = consoleLog.join('\n');
  console.log(`\n      console lines: ${consoleLog.length}${consoleLog.length ? ' → ' + consoleLog.slice(0, 6).join(' || ').slice(0, 500) : ''}`);
  check('17. no sensitive values, ids, or fingerprints in any console', !SECRET.test(logged) && !['jane.doe', 'University A', 'Degree A', 'Springfield', 'Secret Employer', 'Hidden', '1 Example Street'].some((x) => logged.includes(x)));
  console.log(`      blocked external requests: ${blocked.length} ${JSON.stringify(blocked.slice(0, 5))}`);
  check('43. network control: fixtures made no external requests (anything non-local would be blocked and listed)', blocked.length === 0, blocked.join(', '));
  const audit = spawnSync('node', [join(ROOT, 'scripts/security-check.mjs')], { encoding: 'utf8' });
  check('18/32/33. production build: permissions, CSP, no test fixtures or data, no remote code (scripts/security-check.mjs)', audit.status === 0, (audit.stdout + audit.stderr).trim().split('\n').at(-1));
  await shutdown();
} catch (error) {
  check('run completed', false, String(error?.stack ?? error));
  chrome?.kill();
} finally {
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
