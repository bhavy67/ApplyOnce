// Phase 12 (generic repeated-field safety) verification in real Chrome. Fake data only; nothing is submitted.
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

const input = (id, label, type = 'text') => `<p><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}"></p>`;
const shell = (title, body, script = '') => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>
${body}<p id="submitted">false</p><p id="nav">0</p>
<script>
  document.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; }));
  ${script}
</script></body></html>`;
const form = (body, id = 'apply') => `<form id="${id}">${body}<button type="submit">Submit application</button></form>`;

const PAGES = {
  '/dup': shell('Duplicate Degree', form(`${input('fn', 'First Name')}<section><h2>Education</h2>${input('d1', 'Degree')}${input('d2', 'Degree')}${input('uni', 'Institution')}</section>`)),
  '/markers': shell('Marker variants', form(`<section><h2>Education</h2>${input('d1', 'Degree *')}${input('d2', 'Degree (required)')}${input('uni', 'University')}</section>`)),
  '/records': shell('Education 1-3', form([1, 2, 3].map((n) => `<div><h3>Education ${n}</h3>${input(`d${n}`, 'Degree')}</div>`).join(''))),
  '/single': shell('Single Degree', form(`<section><h2>Education</h2>${input('deg', 'Degree')}</section>`)),
  '/single3': shell('Degree, Field, University', form(`<section><h2>Education</h2>${input('deg', 'Degree')}${input('fos', 'Field of Study')}${input('uni', 'University')}</section>`)),
  '/forms': shell('Two forms', `${form(input('e1', 'Email', 'email'), 'newsletter')}${form(`${input('e2', 'Email', 'email')}${input('fn', 'First Name')}`)}`),
  '/sameform': shell('Same form twice', form(`${input('e1', 'Email', 'email')}${input('e2', 'Email', 'email')}${input('fn', 'First Name')}`)),
  '/distinct': shell('Distinct questions', form(`${input('el', 'Education level')}${input('ep', 'Education preferences')}${input('cc', 'Current Company')}${input('pc', 'Previous Company')}`)),
  '/dyn': shell('Dynamic', form(`<section id="edu"><h2>Education</h2>${input('deg', 'Degree')}${input('uni', 'University')}</section><button type="button" id="add">Add degree</button><button type="button" id="del">Remove extra</button>`),
    `document.getElementById('add').addEventListener('click', () => document.getElementById('edu').insertAdjacentHTML('beforeend', ${JSON.stringify(input('deg2', 'Degree'))}));
     document.getElementById('del').addEventListener('click', () => document.getElementById('deg2')?.parentElement.remove());`),
  '/saved-single': shell('Saved single', form(`${input('i1', 'Institution')}`)),
  '/saved-dup': shell('Saved duplicate', form(`${input('i1', 'Institution')}${input('i2', 'Institution')}${input('fn', 'First Name')}`)),
  '/teach-single': shell('Teach single', form(`${input('pc', 'Preferred campus')}`)),
  '/teach-dup': shell('Teach duplicate', form(`${input('pc1', 'Preferred campus')}${input('pc2', 'Preferred campus')}`)),
  '/workday': shell('Careers - Apply', `<form id="apply"><div data-automation-id="applyFlowPage">
      ${[1, 2, 3].map((n) => `<div data-automation-id="education-${n}"><h4>Education ${n}</h4><div data-automation-id="formField-school"><label for="ws${n}">School or University</label><input id="ws${n}" data-automation-id="school"></div></div>`).join('')}
      ${[1, 2].map((n) => `<div data-automation-id="workExperience-${n}"><div data-automation-id="formField-jobTitle"><label for="wt${n}">Job Title</label><input id="wt${n}" data-automation-id="jobTitle"></div></div>`).join('')}
      <button type="button" data-automation-id="pageFooterNextButton" id="next">Save and Continue</button>
    </div></form>`, `document.getElementById('next').addEventListener('click', () => { document.getElementById('nav').textContent = '1'; });`),
};

const server = createServer((req, res) => {
  const page = PAGES[new URL(req.url, 'http://x').pathname];
  res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page ?? '');
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


const now = '2026-09-01T00:00:00.000Z';
const idb = (body) => `new Promise((resolve, reject) => { const r = indexedDB.open('applyonce'); r.onerror = reject; r.onsuccess = () => { const db = r.result; ${body} }; })`;
const writeRaw = (key, value) => idb(`const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(${JSON.stringify(value)}, '${key}'); tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = reject;`);
const readRaw = (key) => idb(`const g = db.transaction('records').objectStore('records').get('${key}'); g.onsuccess = () => { resolve(JSON.stringify(g.result ?? null)); db.close(); }; g.onerror = reject;`);
const PROFILE = {
  schemaVersion: 3, identity: { firstName: 'Jane' }, contact: { email: 'jane.doe@example.com' }, location: {},
  education: [
    { institution: 'University A', degree: 'Degree A', fieldOfStudy: 'Field A' },
    { institution: 'University B', degree: 'Degree B' },
    { institution: 'University C', degree: 'Degree C' },
  ],
  experience: { currentCompany: 'Current Co', currentTitle: 'Current Title' },
  workExperience: [{ company: 'Company A', title: 'Title A' }, { company: 'Company B', title: 'Title B' }],
  certifications: [], links: {}, preferences: {}, authorization: {}, documents: { resumes: [], coverLetters: [] }, customAnswers: [],
};
const MAPPINGS = { version: 1, mappings: [
  { key: 'v1|text|q=institution|c=|i=', parts: { fieldType: 'text', question: 'institution' }, profileField: 'institution', createdAt: now, updatedAt: now },
] };
const REPEATED = "Asked more than once, and ApplyOnce can't tell which profile record each one is for. Will not be filled.";

let id;
let editor;
const values = async (tab) => JSON.parse(await tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('input')].map((e) => [e.id, e.value])))`));
const readReview = async (popup) => JSON.parse(await popup.evaluate(`JSON.stringify([...document.querySelectorAll('.review-item')].map((li) => ({ name: li.querySelector('.field-name').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, teach: !!li.querySelector('button.teach') })))`));
async function analyzePage(path) {
  const tab = await open(`${ORIGIN}${path}`);
  await waitFor(tab, `document.readyState === 'complete'`);
  const before = await tab.evaluate(`document.documentElement.outerHTML + JSON.stringify([...document.querySelectorAll('input')].map((e) => e.value))`);
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  const after = await tab.evaluate(`document.documentElement.outerHTML + JSON.stringify([...document.querySelectorAll('input')].map((e) => e.value))`);
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  const review = await readReview(popup);
  console.log(`      ${path}:`);
  for (const r of review) console.log(`        [${r.checked ? 'x' : r.disabled ? '-' : ' '}] ${r.name} | ${r.mapping} | ${r.note}${r.teach ? ' | teach' : ''}`);
  return { tab, popup, world, review, unchanged: before === after };
}
const fillIfAny = async (popup) => ((await popup.evaluate(`!t.button('Fill ').disabled`)) ? fill(popup) : 'nothing selected');
const selectAll = async (popup) => {
  await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]')].forEach((c) => { if (!c.checked && !c.disabled) c.click(); }); true`);
  await sleep(100);
};
const sentValues = async (p) => JSON.parse(await p.tab.evaluate(`JSON.stringify(globalThis.__recorded)`, p.world.id)).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => [i.fieldId, i.value]));
const close = async (p) => { await p.popup.close(); await p.tab.close(); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byName = (review, name) => review.filter((r) => r.name === name);
const isRepeated = (r) => r.disabled && !r.checked && !r.teach && r.note === REPEATED && r.mapping === 'Repeated question · no record context';

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
  await editor.evaluate(writeRaw('savedMappings', MAPPINGS));

  // =================== A. Education / Degree / Degree / Institution ===================
  let p = await analyzePage('/dup');
  check('Analyze leaves the page unchanged', p.unchanged);
  check('A. both Degree fields: repeated, unsupported, no target, not selected, no Teach', byName(p.review, 'Degree').length === 2 && byName(p.review, 'Degree').every(isRepeated));
  check('A. Institution maps normally (the single saved mapping still applies) and First Name is selected', byName(p.review, 'Institution')[0].mapping === '→ Institution (education[0].institution) · Taught by you' && byName(p.review, 'First Name')[0].checked);
  await selectAll(p.popup);
  let summary = await fill(p.popup);
  let v = await values(p.tab);
  check('A. Institution and First Name fill; neither Degree field fills', v.uni === 'University A' && v.fn === 'Jane' && v.d1 === '' && v.d2 === '', `${summary} ${JSON.stringify(v)}`);
  check('A. no value was sent for the ambiguous fields', (await sentValues(p)).every(([fid]) => !['id:d1', 'id:d2'].includes(fid)) && !(await sentValues(p)).some(([, x]) => /^Degree/.test(String(x))), JSON.stringify(await sentValues(p)));
  check('A. summary counts only what was filled', summary === '2 fields filled', summary);
  let shot = await p.popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase12-duplicates.png'), Buffer.from(shot.data, 'base64'));
  await close(p);

  // =================== B. marker variants ===================
  p = await analyzePage('/markers');
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('B. "Degree *" and "Degree (required)" are one repeated question; University still fills', byName(p.review, 'Degree *').concat(byName(p.review, 'Degree (required)')).every(isRepeated) && v.d1 === '' && v.d2 === '' && v.uni === 'University A', JSON.stringify(v));
  await close(p);

  // =================== C. recognized record sections (Phase 11 unchanged) ===================
  p = await analyzePage('/records');
  const deg = byName(p.review, 'Degree');
  check('C. Education 1–3 Degree map to education[0..2].degree (record context wins)', deg[0].mapping === '→ Highest degree (education[0].degree) · Automatic · High confidence' && deg[0].checked && deg[1].mapping.includes('(education[1].degree)') && !deg[1].checked && deg[2].mapping.includes('(education[2].degree)'));
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('C. each block fills from its own record', eq([v.d1, v.d2, v.d3], ['Degree A', 'Degree B', 'Degree C']), JSON.stringify(v));
  await close(p);

  // =================== D. single field regression ===================
  p = await analyzePage('/single');
  check('D. a single Degree maps normally and is selected', eq(p.review.map((r) => [r.mapping, r.checked, r.teach]), [['→ Highest degree (education[0].degree) · Automatic · High confidence', true, true]]));
  await fill(p.popup);
  check('D. and fills the primary value', (await values(p.tab)).deg === 'Degree A');
  await close(p);
  p = await analyzePage('/single3');
  await fill(p.popup);
  v = await values(p.tab);
  check('D. Degree + Field of Study + University map and fill normally', eq([v.deg, v.fos, v.uni], ['Degree A', 'Field A', 'University A']) && p.review.every((r) => r.checked), JSON.stringify(v));
  await close(p);

  // =================== E/F. distinct questions ===================
  p = await analyzePage('/distinct');
  check('E/F. "Education level"/"Education preferences" and "Current"/"Previous Company" are not repeated', p.review.every((r) => r.note !== REPEATED));
  await close(p);

  // =================== G. forms ===================
  p = await analyzePage('/forms');
  await fill(p.popup);
  v = await values(p.tab);
  check('G. the same question in two separate forms is two independent questions (both fill)', byName(p.review, 'Email').every((r) => r.checked && r.note !== REPEATED) && v.e1 === 'jane.doe@example.com' && v.e2 === 'jane.doe@example.com', JSON.stringify(v));
  await close(p);
  p = await analyzePage('/sameform');
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('G. the same question twice in one form is repeated (neither fills; First Name does)', byName(p.review, 'Email').every(isRepeated) && v.e1 === '' && v.e2 === '' && v.fn === 'Jane', JSON.stringify(v));
  await close(p);

  // =================== Dynamic ===================
  p = await analyzePage('/dyn');
  check('Dynamic: Degree is single at Analyze and selected', byName(p.review, 'Degree')[0].checked);
  await p.tab.evaluate(`document.getElementById('add').click(); true`); // a second Degree appears
  summary = await fill(p.popup);
  v = await values(p.tab);
  const notes = await p.popup.evaluate(`t.item('Degree').note`);
  check('Dynamic: a field that became repeated is refused at fill time; University still fills', v.deg === '' && v.deg2 === '' && v.uni === 'University A' && notes === 'Skipped. This question now appears more than once on the page. Analyze again.', `${summary} | ${notes} | ${JSON.stringify(v)}`);
  await analyze(p.popup);
  let review = await readReview(p.popup);
  check('Dynamic: Analyze again shows both copies as repeated', byName(review, 'Degree').length === 2 && byName(review, 'Degree').every(isRepeated));
  await p.tab.evaluate(`document.getElementById('del').click(); true`); // back to one Degree
  await analyze(p.popup);
  review = await readReview(p.popup);
  await fill(p.popup);
  check('Dynamic: once unique again, a new Analyze maps and fills it', byName(review, 'Degree')[0].checked && (await values(p.tab)).deg === 'Degree A');
  await close(p);

  // =================== Saved mappings ===================
  p = await analyzePage('/saved-single');
  await selectAll(p.popup);
  await fill(p.popup);
  check('Saved: "Institution → institution" still works for a single field', p.review[0].mapping === '→ Institution (education[0].institution) · Taught by you' && (await values(p.tab)).i1 === 'University A');
  await close(p);
  p = await analyzePage('/saved-dup');
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('Saved: the same mapping is not applied to repeated copies; nothing filled there', byName(p.review, 'Institution').every(isRepeated) && v.i1 === '' && v.i2 === '' && v.fn === 'Jane', JSON.stringify(v));
  check('Saved: the stored mapping is untouched', JSON.parse(await editor.evaluate(readRaw('savedMappings'))).mappings.length === 1);
  await close(p);

  // =================== Teach Once ===================
  p = await analyzePage('/teach-single');
  await teach(p.popup, 'Preferred campus', 'education[1].institution');
  let taught = await item(p.popup, 'Preferred campus');
  await p.popup.evaluate(`t.toggle('Preferred campus'); true`);
  await sleep(100);
  await fill(p.popup);
  check('Teach: single unknown field → Teach → Save → approve → Fill still works', taught.mapping.endsWith('Taught by you') && !taught.checked && (await values(p.tab)).pc === 'University B');
  await close(p);
  const mappingsBefore = JSON.parse(await editor.evaluate(readRaw('savedMappings'))).mappings.length;
  p = await analyzePage('/teach-dup');
  const direct = await p.popup.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/save-mapping', payload: { field: { id: 'id:pc1', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, repeatedCount: 2, signals: { htmlId: 'pc1', name: 'pc1', label: 'Preferred campus' } }, profileField: 'institution' } }).then((r) => JSON.stringify(r))`);
  const fillDisabled = await p.popup.evaluate(`t.button('Fill ').disabled`);
  check('Teach: repeated unknown fields show no Teach action and cannot be selected', p.review.length === 2 && p.review.every(isRepeated) && fillDisabled);
  check('Teach: saving a mapping for them is refused; no mapping created; nothing filled', direct === JSON.stringify({ ok: false, error: 'invalid-mapping' }) && JSON.parse(await editor.evaluate(readRaw('savedMappings'))).mappings.length === mappingsBefore && Object.values(await values(p.tab)).every((x) => x === ''), direct);
  await close(p);

  // =================== Workday ===================
  p = await analyzePage('/workday');
  const schools = byName(p.review, 'School or University');
  const titles = byName(p.review, 'Job Title');
  check('Workday: headed Education 1–3 map positionally; unheaded repeated Job Title stays unsupported', schools.map((r) => /\(([^()]+)\) ·/.exec(r.mapping)?.[1]).join() === 'education[0].institution,education[1].institution,education[2].institution' && titles.length === 2 && titles.every(isRepeated));
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('Workday: records fill positionally, Job Title untouched, no navigation', eq([v.ws1, v.ws2, v.ws3, v.wt1, v.wt2], ['University A', 'University B', 'University C', '', '']) && (await p.tab.evaluate(`document.getElementById('nav').textContent`)) === '0', JSON.stringify(v));
  await close(p);

  // =================== Privacy / safety ===================
  const logged = consoleLog.join('\n');
  console.log(`      console lines captured: ${consoleLog.length}`);
  check('Privacy: no profile value in any console', !['University', 'Degree A', 'Jane', 'jane.doe', 'Company A', 'Current Co'].some((x) => logged.includes(x)));
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
