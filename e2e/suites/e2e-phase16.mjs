// Phase 16 (cross-ATS hardening) in real Chrome: one fixture matrix (the same questions on a
// generic, a Workday-structured, and a Greenhouse-structured page), stale approvals, failure
// isolation, privacy, submission safety, the build handshake per platform, and read-only real
// sites. Fake data only. Nothing is submitted, nobody signs in, nothing is uploaded.
import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

// Repo-relative paths: suites live in e2e/suites, output goes to e2e/.out (git-ignored).
const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const SCRATCH = join(E2E, '.out');
e2eMkdir(SCRATCH, { recursive: true });
const DIST = join(ROOT, 'apps/chrome-extension/dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL_WORKDAY = 'https://workday.wd5.myworkdayjobs.com/Workday';
const REAL_GREENHOUSE = 'https://job-boards.greenhouse.io/anthropic/jobs/4461450008';

// ---------------- shared fixture matrix ----------------
// The same questions on every platform; only the wrapper and control attributes differ.
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
const page = (platform) => {
  const f = FIXTURES[platform];
  return `<!doctype html><html lang="en"><head><title>${platform} fixture</title></head><body>
<h1>Apply</h1><p>We use Workday and Greenhouse for hiring.</p>
${platform === 'workday' ? f.wrap(questions(f.attrs)) : f.wrap(questions(f.attrs)).replace(/ data-automation-id="formField-[^"]*"/g, '').replace('<input type="text" name="country_helper" style="display:none">', '')}
<button type="button" id="add">Add a question</button><button type="button" id="rerender">Re-render</button>
<p id="counters">{"submits":0,"nav":{}}</p>
<script>${PAGE_SCRIPT}</script></body></html>`;
};

const server = createServer((req, res) => {
  const platform = new URL(req.url, 'http://x').pathname.split('/')[1];
  if (!FIXTURES[platform]) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(platform));
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


const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idb = (body) => `new Promise((resolve, reject) => { const r = indexedDB.open('applyonce'); r.onerror = reject; r.onsuccess = () => { const db = r.result; ${body} }; })`;
const writeRaw = (key, value) => idb(`const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(${JSON.stringify(value)}, '${key}'); tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = reject;`);
const PROFILE = {
  schemaVersion: 4,
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '+1 555 010 0199' },
  location: { address: '1 Example Street', city: 'Springfield', country: 'Canada' },
  links: { linkedin: 'https://www.linkedin.com/in/jane-doe-example', website: 'https://jane.example.com', portfolio: 'https://portfolio.example.com' },
  experience: { totalExperienceYears: 6 },
  preferences: { workMode: 'hybrid', openToRelocation: true },
  authorization: { requiresSponsorship: false },
  education: [
    { id: A, institution: 'University A', degree: 'Degree A', fieldOfStudy: 'Physics' },
    { id: B, institution: 'University B', degree: 'Degree B', fieldOfStudy: 'Chemistry' },
  ],
  workExperience: [], certifications: [], documents: { resumes: [], coverLetters: [] }, customAnswers: [],
};
const SECRET = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|fp-[0-9a-f]{16}|m-[0-9a-f]{16}/;

let id;
let editor;
const review = async (popup) => JSON.parse(await popup.evaluate(`JSON.stringify([...document.querySelectorAll('.review-item')].map((li) => ({ name: li.querySelector('.field-name').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, teach: !!li.querySelector('button.teach'), assign: li.querySelector('button.assign')?.textContent ?? null })))`));
const platformNote = (popup) => popup.evaluate(`[...document.querySelectorAll('.analysis .note')].map((n) => n.textContent).find((t) => /page:/.test(t)) ?? ''`);
const byName = (items, name, n = 0) => items.filter((i) => i.name === name)[n];
const indexOf = (items, name, n = 0) => items.map((it, i) => [it, i]).filter(([it]) => it.name === name)[n]?.[1];
const readPage = async (tab) => JSON.parse(await tab.evaluate(`JSON.stringify(read())`));
const counters = async (tab) => JSON.parse(await tab.evaluate(`document.getElementById('counters').textContent`));
async function openPage(platform, query = '') {
  const tab = await open(`${ORIGIN}/${platform}/apply${query}`);
  await waitFor(tab, `document.readyState === 'complete' && typeof read === 'function'`);
  return tab;
}
const recorders = new Map();
async function analyzeTab(tab) {
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  if (!recorders.has(tab.sessionId)) {
    const world = isolatedWorld(tab);
    await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
    recorders.set(tab.sessionId, world.id);
  }
  return popup;
}
const recorded = (tab) => tab.evaluate(`JSON.stringify(globalThis.__recorded)`, recorders.get(tab.sessionId));
async function fillSlow(popup) {
  await popup.evaluate(`t.button('Fill ').click(); true`);
  await sleep(200);
  await waitFor(popup, `!t.button('Filling') && !!document.querySelector('.fill-summary, .analysis .message.error')`, 60000);
  return popup.evaluate(`document.querySelector('.fill-summary')?.textContent ?? document.querySelector('.analysis .message.error')?.textContent ?? ''`);
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
const untickAll = async (popup) => {
  await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]:checked')].forEach((c) => c.click()); true`);
  await sleep(100);
};
async function tickNames(popup, names) {
  const items = await review(popup);
  const indexes = names.map(([name, n = 0]) => indexOf(items, name, n)).filter((i) => i !== undefined);
  await popup.evaluate(`(() => { const items = [...document.querySelectorAll('.review-item')]; for (const i of ${JSON.stringify(indexes)}) { const c = items[i].querySelector('input[type=checkbox]'); if (!c.checked && !c.disabled) c.click(); } return true; })()`);
  await sleep(100);
  return indexes.length;
}
/** Extension-page messages, sent from the popup (an extension page), like the profile page does. */
const popupMessage = async (popup, message) => JSON.parse(await popup.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => JSON.stringify(r))`));
/** The page's current fields as the popup would get them (to address one field in a message). */
const scanFromPopup = async (popup) => JSON.parse(await popup.evaluate(`(async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const r = await chrome.tabs.sendMessage(tab.id, { type: 'applyonce/scan-page' }); const u = new URL(tab.url); return JSON.stringify({ page: u.origin + u.pathname, fields: r.data.fields }); })()`));
const pageLeaks = async (tab) => {
  const state = JSON.parse(await tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce|profile|assign/i.test(k)) })`));
  return SECRET.test(state.html) || state.local.length + state.session.length + state.globals.length > 0;
};

const allRecorded = [];
const SHARED = ['First Name', 'Email', 'Website', 'Years of Experience', 'Address', 'City', 'Country', 'Willing to relocate', 'Will you require visa sponsorship?', 'Work mode', 'What name should we use?', 'Degree', 'Degree'];
const EXPECTED_NAMES = {
  generic: SHARED,
  workday: ['School or University', 'Field of Study', 'School or University', 'Field of Study', ...SHARED],
  greenhouse: ['LinkedIn Profile', ...SHARED],
};
const MAPPED = ['First Name', 'Email', 'Website', 'Years of Experience', 'Address', 'City', 'Country', 'Willing to relocate', 'Will you require visa sponsorship?', 'Work mode'];

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

  for (const platform of ['generic', 'workday', 'greenhouse']) {
    const P = (s) => `[${platform}] ${s}`;
    console.log(`\n===== ${platform} =====`);

    // ---------- detection, scan, mapping, fill ----------
    let tab = await openPage(platform);
    const baseline = JSON.stringify(await readPage(tab));
    let popup = await analyzeTab(tab);
    check(P('detection: expected adapter'), (await platformNote(popup)) === FIXTURES[platform].note, (await platformNote(popup)) || 'generic (no platform note)');
    check(P('Analyze leaves the page unchanged'), JSON.stringify(await readPage(tab)) === baseline);
    let items = await review(popup);
    for (const r of items) console.log(`        [${r.checked ? 'x' : r.disabled ? '-' : ' '}] ${r.name} | ${r.mapping} | ${r.note}`);
    check(P('scan: one field per question, the same shared questions; no buttons, file, EEO, or helpers'), JSON.stringify(items.map((i) => i.name)) === JSON.stringify(EXPECTED_NAMES[platform]), items.map((i) => i.name).join(' | '));
    check(P('map: shared questions map through the same mapper'), MAPPED.every((n) => byName(items, n)?.mapping.startsWith('→ ')), MAPPED.filter((n) => !byName(items, n)?.mapping.startsWith('→ ')).join(', '));
    check(P('repeated question: both copies "Repeated question", Assign record, never selected'), [0, 1].every((n) => byName(items, 'Degree', n)?.mapping === 'Repeated question · no record context' && byName(items, 'Degree', n)?.assign === 'Assign record' && !byName(items, 'Degree', n)?.checked));
    check(P('unknown question offers Teach Once'), byName(items, 'What name should we use?')?.mapping === 'No match' && byName(items, 'What name should we use?')?.teach);

    await untickAll(popup);
    await tickNames(popup, [...MAPPED.map((n) => [n]), ...(platform === 'workday' ? [['School or University', 0], ['School or University', 1], ['Field of Study', 0], ['Field of Study', 1]] : []), ...(platform === 'greenhouse' ? [['LinkedIn Profile']] : [])]);
    let summary = await fillSlow(popup);
    let s = await readPage(tab);
    let c = await counters(tab);
    items = await review(popup);
    console.log(`      fill: ${summary} ${JSON.stringify(s)} ${JSON.stringify(c)}`);
    check(P('fill: text, email, url, number, textarea'), s.first_name === 'Jane' && s.email === 'jane.doe@example.com' && s.website === 'https://jane.example.com' && s.years === '6' && s.address === '1 Example Street');
    check(P('fill: native select, checkbox, radio, custom select'), s.country === 'Canada' && s.relocate === true && s.sponsor === 'no' && s.mode === 'Hybrid');
    if (platform === 'workday') check(P('fill: Workday autocomplete in repeated records (selected-item pills) + record text fields'), JSON.stringify(s.pills) === JSON.stringify(['education-1:University A', 'education-2:University B']) && s.fos1 === 'Physics' && s.fos2 === 'Chemistry', JSON.stringify([s.pills, s.fos1, s.fos2]));
    if (platform === 'greenhouse') check(P('fill: Greenhouse custom question filled; EEO untouched'), s.linkedin === 'https://www.linkedin.com/in/jane-doe-example' && s.gender === '');
    check(P('submission safety: a page that submits when City changes is stopped and reported; no submit, no nav button clicked'), c.submits === 0 && Object.keys(c.nav).length === 0 && /tried to submit the form or leave the page/.test(byName(items, 'City')?.note ?? ''), byName(items, 'City')?.note);

    // ---------- explicit record assignment ----------
    items = await review(popup);
    const d = indexOf(items, 'Degree');
    await assignVia(popup, d, `education@${A}.degree`);
    await assignVia(popup, d + 1, `education@${B}.degree`);
    items = await review(popup);
    check(P('assignment: "Education n → Degree · Assigned by you", unticked'), items[d].mapping === '→ Education 1 → Degree · Assigned by you' && items[d + 1].mapping === '→ Education 2 → Degree · Assigned by you' && !items[d].checked && !items[d + 1].checked);
    await untickAll(popup);
    await tickNames(popup, [['Degree', 0], ['Degree', 1]]);
    await fillSlow(popup);
    s = await readPage(tab);
    check(P('assignment: each Degree from its record'), s.degree_a === 'Degree A' && s.degree_b === 'Degree B', JSON.stringify([s.degree_a, s.degree_b]));

    // ---------- Teach Once ----------
    await teach(popup, 'What name should we use?', 'first_name');
    items = await review(popup);
    check(P('Teach: "Taught by you", unticked, nothing filled'), byName(items, 'What name should we use?')?.mapping.endsWith('Taught by you') && !byName(items, 'What name should we use?')?.checked && (await readPage(tab)).nick === '');
    await untickAll(popup);
    await tickNames(popup, [['What name should we use?']]);
    await fillSlow(popup);
    check(P('Teach: approve + Fill fills the taught question'), (await readPage(tab)).nick === 'Jane');

    // ---------- dynamic question + re-render ----------
    await tab.evaluate(`document.getElementById('add').click(); true`);
    await analyze(popup);
    items = await review(popup);
    check(P('dynamic: a question added after Analyze is found by Analyze again'), byName(items, 'Portfolio')?.mapping.startsWith('→ Portfolio'));
    await untickAll(popup);
    await tickNames(popup, [['Portfolio'], ['Email']]);
    await tab.evaluate(`document.getElementById('rerender').click(); true`);
    await sleep(200);
    summary = await fillSlow(popup);
    s = await readPage(tab);
    check(P('re-render: new DOM nodes, Fill rediscovers the fields'), s.portfolio === 'https://portfolio.example.com' && s.email === 'jane.doe@example.com', summary);
    check(P('privacy: nothing unapproved in the page (no ids, fingerprints, storage, globals)'), !(await pageLeaks(tab)));
    allRecorded.push(await recorded(tab));
    await popup.close();
    await tab.close();

    // ---------- existing values (text, select, custom select, radio, checkbox, pill, re-rendered) ----------
    tab = await openPage(platform, '?prefill=1');
    popup = await analyzeTab(tab);
    await untickAll(popup);
    const EXISTING = [['First Name'], ['Country'], ['Address'], ['Willing to relocate'], ['Will you require visa sponsorship?'], ['Work mode'], ...(platform === 'workday' ? [['School or University', 0]] : [])];
    await tickNames(popup, EXISTING);
    await fillSlow(popup);
    s = await readPage(tab);
    items = await review(popup);
    console.log('      existing: ' + EXISTING.map(([n]) => `${n}: ${byName(items, n)?.note}`).join(' | '));
    check(P('existing values are never overwritten'), s.first_name === 'Kept Name' && s.country === 'India' && s.address === 'Kept address' && s.relocate === true && s.sponsor === 'yes' && s.mode === 'On-site' && (platform !== 'workday' || JSON.stringify(s.pills) === JSON.stringify(['education-1:University B'])), JSON.stringify(s));
    await tab.evaluate(`document.getElementById('rerender').click(); true`);
    await sleep(200);
    await fillSlow(popup);
    check(P('a re-rendered control that shows a selection is still kept'), (await readPage(tab)).mode === 'On-site' && (platform !== 'workday' || (await readPage(tab)).pills.length === 1));
    allRecorded.push(await recorded(tab));
    await popup.close();
    await tab.close();

    // ---------- stale approvals: Analyze → page and data change → Fill ----------
    tab = await openPage(platform);
    popup = await analyzeTab(tab);
    await teach(popup, 'What name should we use?', 'first_name');
    items = await review(popup);
    const dd = indexOf(items, 'Degree');
    await assignVia(popup, dd, `education@${A}.degree`);
    await assignVia(popup, dd + 1, `education@${B}.degree`);
    await untickAll(popup);
    await tickNames(popup, [...MAPPED.map((n) => [n]), ['What name should we use?'], ['Degree', 0], ['Degree', 1]]);
    const before = await scanFromPopup(popup);
    // Page changes.
    await tab.evaluate(`(() => {
      document.getElementById('first_name').parentElement.remove();                          // removed
      document.querySelector('label[for=email]').textContent = 'Work email';                 // question changed
      document.querySelector('section[aria-label=Links]').setAttribute('aria-label', 'Other links'); // identity only
      document.getElementById('years').disabled = true;                                        // disabled
      document.getElementById('city').readOnly = true;                                         // read-only
      const address = document.getElementById('address');                                       // type changed
      address.replaceWith(Object.assign(document.createElement('input'), { id: 'address', name: 'address' }));
      document.getElementById('country').parentElement.insertAdjacentHTML('afterend', '<div><label>Country <select><option value=""></option><option>Canada</option></select></label></div>'); // now repeated
      return true; })()`);
    // Data changes (extension side): mapping deleted, assignment changed or deleted, record deleted, profile edited.
    await popupMessage(popup, { type: 'applyonce/clear-mappings' });
    const degreeA = before.fields.find((f) => f.id.includes('degree_a'));
    const degreeB = before.fields.find((f) => f.id.includes('degree_b'));
    const changed = await popupMessage(popup, { type: 'applyonce/save-assignment', payload: { page: before.page, field: degreeA, target: `education@${B}.degree` } });
    if (platform === 'generic') await popupMessage(popup, { type: 'applyonce/delete-assignment', payload: { page: before.page, field: degreeB } });
    const edited = { ...PROFILE, preferences: { ...PROFILE.preferences, workMode: 'remote' }, education: platform === 'generic' ? PROFILE.education : [PROFILE.education[0]] };
    await editor.evaluate(writeRaw('profile', edited));
    summary = await fillSlow(popup);
    s = await readPage(tab);
    items = await review(popup);
    const notes = Object.fromEntries(items.filter((i) => i.note.includes('.')).map((i, n) => [`${i.name}${i.name === 'Degree' ? n : ''}`, i.note]));
    console.log(`      stale fill: ${summary} ${JSON.stringify(s)}\n      notes: ${JSON.stringify(notes)}`);
    check(P('stale: removed / relabeled / identity-changed / type-changed / disabled / read-only / now-repeated fields all refused'), s.first_name === null && s.email === '' && s.website === '' && s.address === '' && s.years === '' && s.city === '' && s.country === '', JSON.stringify(s));
    check(P('stale: an identity-only change (section label) is caught by the service worker re-scan'), /changed since Analyze/.test(byName(items, 'Website')?.note ?? ''), byName(items, 'Website')?.note);
    check(P('stale: mapping deleted, assignment changed/deleted, record deleted → refused'), changed.ok === true && s.nick === '' && s.degree_a === '' && s.degree_b === '');
    check(P('stale: profile edited after Analyze → the current value is filled (Work mode: Remote)'), s.mode === 'Remote' && s.relocate === true && s.sponsor === 'no', JSON.stringify([s.mode, s.relocate, s.sponsor]));
    check(P('stale: no submission, no navigation'), (await counters(tab)).submits === 0 && Object.keys((await counters(tab)).nav).length === 0);
    await editor.evaluate(writeRaw('profile', PROFILE));
    await popupMessage(popup, { type: 'applyonce/clear-assignments' });
    allRecorded.push(await recorded(tab));
    await popup.close();
    await tab.close();

    // ---------- failure isolation: A valid, B invalid, C valid ----------
    tab = await openPage(platform);
    popup = await analyzeTab(tab);
    await untickAll(popup);
    await tickNames(popup, [['First Name'], ['Country'], ['Website']]);
    await tab.evaluate(`document.querySelector('#country option:nth-child(2)').remove(); true`); // no "Canada" any more
    await fillSlow(popup);
    s = await readPage(tab);
    items = await review(popup);
    check(P('failure isolation: A fills, B fails, C fills'), s.first_name === 'Jane' && s.country === '' && s.website === 'https://jane.example.com' && /^Failed\./.test(byName(items, 'Country')?.note ?? ''), byName(items, 'Country')?.note);
    allRecorded.push(await recorded(tab));
    await popup.close();
    await tab.close();
  }

  // ---------- privacy across all platforms ----------
  const raw = allRecorded.join('\n');
  const messages = allRecorded.flatMap((r) => JSON.parse(r));
  const fills = messages.filter((m) => m.type === 'applyonce/fill-fields');
  const values = fills.flatMap((m) => m.payload.instructions.map((i) => i.value));
  const approved = new Set(['Jane', 'jane.doe@example.com', 'https://jane.example.com', 6, '1 Example Street', 'Springfield', 'Canada', true, false, 'hybrid', 'remote', 'University A', 'University B', 'Physics', 'Chemistry', 'https://www.linkedin.com/in/jane-doe-example', 'Degree A', 'Degree B', 'https://portfolio.example.com']);
  console.log(`\n      messages to content scripts: ${messages.length} (${[...new Set(messages.map((m) => m.type))].join(', ')}); values: ${JSON.stringify([...new Set(values)])}`);
  check('privacy: content scripts received only approved field/value pairs (no profile, records, record ids, assignments, mappings, schema)', fills.length > 0 && values.every((v) => approved.has(v)) && !/schemaVersion|"education":|workExperience|recordAssignments|savedMappings|education@|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/.test(raw), JSON.stringify(values.filter((v) => !approved.has(v))));
  check('privacy: no field fingerprints reach any content script (all adapters)', !/fp-[0-9a-f]{16}/.test(raw) && fills.every((m) => m.payload.instructions.every((i) => !('identity' in i.expected))));
  check('privacy: the only other message a content script received was a scan request', messages.every((m) => ['applyonce/fill-fields', 'applyonce/scan-page', 'applyonce/ping'].includes(m.type)));

  // ---------- build handshake, per platform ----------
  const extDir = join(SCRATCH, 'ext-p16');
  rmSync(extDir, { recursive: true, force: true });
  cpSync(DIST, extDir, { recursive: true });
  const second = await send('Extensions.loadUnpacked', { path: extDir });
  await sleep(500);
  // The popup on disk now belongs to another build than the running service worker.
  const popupFile = readdirSync(join(extDir, 'assets')).find((f) => /^popup-.*\.js$/.test(f));
  const code = readFileSync(join(extDir, 'assets', popupFile), 'utf8');
  const buildId = code.match(/\d+\.\d+\.\d+\+[a-z0-9]+/)?.[0];
  writeFileSync(join(extDir, 'assets', popupFile), code.replaceAll(buildId, `${buildId.split('+')[0]}+stale00`));
  for (const platform of ['generic', 'workday', 'greenhouse']) {
    const tab = await openPage(platform);
    const baseline = JSON.stringify(await readPage(tab));
    const popup = await openPopupFor(second.id, tab);
    await analyze(popup);
    const message = await popup.evaluate(`document.querySelector('.message.error')?.textContent ?? ''`);
    const injected = (contexts.get(tab.sessionId) ?? []).some((ctx) => ctx.auxData?.type === 'isolated');
    check(`[${platform}] handshake: stale build → reload message; nothing scanned or injected`, message.startsWith('ApplyOnce was updated. Reload the extension') && !injected && JSON.stringify(await readPage(tab)) === baseline, message);
    await popup.close();
    await tab.close();
  }

  // ---------- real sites, read-only ----------
  const realWorkday = await open(REAL_WORKDAY);
  if (!(await waitFor(realWorkday, `!!document.querySelector('[data-automation-id="jobSearchPage"], [data-automation-id="jobPostingPage"]')`, 60000))) {
    console.log('      REAL Workday: the job board did not load in time; not verified');
  } else {
    await sleep(2000);
    const snap = () => realWorkday.evaluate(`JSON.stringify([location.href, ...[...document.querySelectorAll('input, select, textarea')].map((e) => e.value)])`);
    const before = await snap();
    const popup = await openPopupFor(id, realWorkday);
    await analyze(popup);
    const note = await platformNote(popup);
    check('REAL Workday job board (read-only Analyze): detected as Workday, nothing changed', note === FIXTURES.workday.note && (await snap()) === before, note);
    await popup.close();
  }
  await realWorkday.close();

  const real = await open('about:blank');
  let blockedWrites = 0;
  const writeMethods = [];
  await real.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  globalThis.__onRequestPaused = (msg) => {
    if (msg.sessionId !== real.sessionId) return;
    const { requestId, request } = msg.params;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      send('Fetch.continueRequest', { requestId }, real.sessionId).catch(() => undefined);
    } else {
      blockedWrites += 1;
      writeMethods.push(`${request.method} ${new URL(request.url).hostname}`);
      send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, real.sessionId).catch(() => undefined);
    }
  };
  await real.send('Page.navigate', { url: REAL_GREENHOUSE });
  const loaded = await waitFor(real, `!!document.querySelector('form#application-form .application--questions')`, 60000);
  if (!loaded) {
    console.log('      REAL Greenhouse: the job page did not load in time; not verified');
  } else {
    await sleep(3000);
    const snapshot = () => real.evaluate(`JSON.stringify([location.href, ...[...document.querySelectorAll('#application-form input, #application-form textarea')].map((e) => [e.id, e.value])])`);
    const before = await snapshot();
    const popup = await openPopupFor(id, real);
    await analyze(popup);
    const realItems = await review(popup);
    check('REAL Greenhouse (read-only Analyze): detected as Greenhouse; standard questions mapped; nothing changed', (await platformNote(popup)) === FIXTURES.greenhouse.note && ['First Name', 'Last Name', 'Email'].every((n) => byName(realItems, n)?.mapping.startsWith('→ ')) && (await snapshot()) === before);
    // Safe fake-data fill: every write request from the page is blocked, so nothing can reach
    // Greenhouse; nothing is submitted; the tab is closed afterwards without saving anything.
    const selected = realItems.filter((r) => r.checked).map((r) => r.name);
    const fillSummary = await fillSlow(popup);
    const after = JSON.parse(await real.evaluate(`JSON.stringify({ url: location.href, first: document.getElementById('first_name')?.value, last: document.getElementById('last_name')?.value, email: document.getElementById('email')?.value, phone: document.getElementById('phone')?.value, submitted: !!document.querySelector('[class*=confirmation], #application_confirmation') })`));
    const resultNotes = (await review(popup)).filter((r) => selected.includes(r.name)).map((r) => `${r.name}: ${r.note}`);
    console.log(`      REAL Greenhouse fake-data fill: ${fillSummary}; selected: ${selected.join(', ')}\n        ${resultNotes.join('\n        ')}\n      blocked page write requests: ${blockedWrites} ${JSON.stringify([...new Set(writeMethods)])}`);
    check('REAL Greenhouse fake-data fill (all page writes blocked): standard fields filled, same URL, not submitted', after.first === 'Jane' && after.last === 'Doe' && after.email === 'jane.doe@example.com' && after.phone?.replace(/\D/g, '') === '15550100199' && after.url === REAL_GREENHOUSE && !after.submitted, JSON.stringify(after));
    const shot = await popup.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SCRATCH, 'phase16-real-greenhouse-fill.png'), Buffer.from(shot.data, 'base64'));
    await popup.close();
  }
  await real.send('Fetch.disable').catch(() => undefined);
  globalThis.__onRequestPaused = undefined;
  await real.close();

  const logged = consoleLog.join('\n');
  console.log(`      console lines captured: ${consoleLog.length}${consoleLog.length ? ' → ' + consoleLog.slice(0, 4).join(' || ').slice(0, 300) : ''}`);
  check('logging: no profile values, ids, or fingerprints in any console', !SECRET.test(logged) && !['jane.doe', 'Degree A', 'University A', 'Springfield', '1 Example Street', 'portfolio.example'].some((x) => logged.includes(x)));
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
