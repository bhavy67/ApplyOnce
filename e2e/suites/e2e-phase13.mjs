// Phase 13 (explicit record assignment + stable record ids) in real Chrome. Fake data only; nothing is submitted.
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

const input = (id, label) => `<p><label for="${id}">${label}</label><input id="${id}" name="${id}"></p>`;
const shell = (title, body) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>
<form id="apply">${body}<button type="submit">Submit application</button></form><p id="submitted">false</p><p id="nav">0</p>
<script>document.getElementById('apply').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
document.getElementById('next')?.addEventListener('click', () => { document.getElementById('nav').textContent = '1'; });</script></body></html>`;

const PAGES = {
  '/dup': shell('Duplicate Degree', `<section><h2>Education</h2>${input('d1', 'Degree')}${input('d2', 'Degree')}${input('uni', 'Institution')}</section>`),
  '/three': shell('Three Degrees', `<section><h2>Education</h2>${input('f1', 'Degree')}${input('f2', 'Degree')}${input('f3', 'Degree')}</section>`),
  '/single': shell('Single Degree', `<section><h2>Education</h2>${input('deg', 'Degree')}</section>`),
  '/teach-single': shell('Teach single', input('pc', 'Preferred campus')),
  '/teach-dup': shell('Teach duplicate', `${input('pc1', 'Preferred campus')}${input('pc2', 'Preferred campus')}`),
  '/workday': shell('Careers - Apply', `<div data-automation-id="applyFlowPage">
    ${[1, 2].map((n) => `<div data-automation-id="education-${n}"><h4>Education ${n}</h4><div data-automation-id="formField-school"><label for="ws${n}">School or University</label><input id="ws${n}" data-automation-id="school"></div></div>`).join('')}
    ${[1, 2].map((n) => `<div data-automation-id="workExperience-${n}"><div data-automation-id="formField-jobTitle"><label for="wt${n}">Job Title</label><input id="wt${n}" data-automation-id="jobTitle"></div></div>`).join('')}
    <button type="button" data-automation-id="pageFooterNextButton" id="next">Save and Continue</button></div>`),
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
/** A Phase 12-compatible (schema 3) profile: records without ids. */
const PHASE12_PROFILE = {
  schemaVersion: 3, identity: { firstName: 'Jane' }, contact: { email: 'jane.doe@example.com', phone: '+1 555 010 0199' }, location: {},
  education: [{ institution: 'University A', degree: 'Degree A' }, { institution: 'University B', degree: 'Degree B' }],
  experience: { currentCompany: 'Current Co', currentTitle: 'Current Title' },
  workExperience: [{ company: 'Company A', title: 'Title A' }, { company: 'Company B', title: 'Title B' }],
  certifications: [{ name: 'Certification A', issuer: 'Issuer A' }, { name: 'Certification B' }],
  links: {}, preferences: {}, authorization: {}, documents: { resumes: [], coverLetters: [] }, customAnswers: [],
};
const MAPPINGS = { version: 1, mappings: [
  { key: 'v1|text|q=institution|c=|i=', parts: { fieldType: 'text', question: 'institution' }, profileField: 'institution', createdAt: now, updatedAt: now },
] };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|m-[0-9a-f]{16}/;

let id;
let editor;
const EDITOR_HELPERS = `window.r = {
  rec: (title) => [...document.querySelectorAll('.record')].find((x) => x.querySelector('h3')?.textContent === title),
  input: (title, label) => { const l = [...r.rec(title).querySelectorAll('label')].find((x) => x.textContent.trim() === label); return document.getElementById(l.htmlFor); },
  set: (title, label, value) => { const el = r.input(title, label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value)); el.dispatchEvent(new Event('input', { bubbles: true })); return true; },
  click: (name) => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === name || x.getAttribute('aria-label') === name).click(); return true; },
  status: () => document.querySelector('.save-bar [role=status]')?.textContent ?? '',
}; true`;
async function reloadEditor() {
  await editor.send('Page.reload');
  await sleep(300);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(EDITOR_HELPERS);
}
async function saveEditor() {
  await editor.evaluate(`r.click('Save profile')`);
  return waitFor(editor, `r.status() === 'Profile saved'`, 5000);
}
const profileViaWorker = async () => JSON.parse(await editor.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }).then((r) => JSON.stringify(r.data))`));
const stored = async (key = 'profile') => JSON.parse(await editor.evaluate(readRaw(key)));
const ids = (list) => list.map((x) => x.id);
const values = async (tab) => JSON.parse(await tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#apply input')].map((e) => [e.id, e.value])))`));
const review = async (popup) => JSON.parse(await popup.evaluate(`JSON.stringify([...document.querySelectorAll('.review-item')].map((li) => ({ name: li.querySelector('.field-name').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, teach: !!li.querySelector('button.teach'), assign: li.querySelector('button.assign')?.textContent ?? null, unassign: !!li.querySelector('button.unassign') })))`));
async function analyzePage(path) {
  const tab = await open(`${ORIGIN}${path}`);
  await waitFor(tab, `document.readyState === 'complete'`);
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  return { tab, popup, world };
}
async function reanalyze(p) {
  await p.popup.close();
  await p.tab.send('Page.reload');
  await sleep(400);
  await waitFor(p.tab, `document.readyState === 'complete'`);
  p.popup = await openPopupFor(id, p.tab);
  await analyze(p.popup);
  p.world = isolatedWorld(p.tab);
  await p.tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, p.world.id);
}
/** Opens "Assign record" on the index-th item, picks the option with this value, saves. */
async function assignVia(popup, index, target) {
  const item = `document.querySelectorAll('.review-item')[${index}]`;
  await popup.evaluate(`${item}.querySelector('button.assign').click(); true`);
  await waitFor(popup, `!!${item}.querySelector('.assign-editor select')`);
  const shown = await popup.evaluate(`JSON.stringify({ groups: [...${item}.querySelectorAll('optgroup')].map((g) => g.label), options: [...${item}.querySelectorAll('option')].map((o) => o.textContent) })`);
  await popup.evaluate(`(() => { const s = ${item}.querySelector('.assign-editor select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(target)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(50);
  await popup.evaluate(`[...${item}.querySelectorAll('button')].find((b) => b.textContent === 'Save assignment').click(); true`);
  await waitFor(popup, `!${item}.querySelector('.assign-editor')`);
  return JSON.parse(shown);
}
const toggleIndex = async (popup, indexes) => {
  await popup.evaluate(`(() => { const items = [...document.querySelectorAll('.review-item')]; for (const i of ${JSON.stringify(indexes)}) items[i].querySelector('input[type=checkbox]').click(); return true; })()`);
  await sleep(100);
};
const sent = async (p) => JSON.parse(await p.tab.evaluate(`JSON.stringify(globalThis.__recorded)`, p.world.id));
const close = async (p) => { await p.popup.close(); await p.tab.close(); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
  await editor.evaluate(writeRaw('profile', PHASE12_PROFILE));
  await editor.evaluate(writeRaw('savedMappings', MAPPINGS));
  await reloadEditor();

  // =================== 46. migration ===================
  const first = await profileViaWorker();
  const second = await profileViaWorker();
  const allIds = (p) => [...ids(p.education), ...ids(p.workExperience), ...ids(p.certifications)];
  check('46. every record of a Phase 12 profile receives a stable id; values unchanged; nothing lost', allIds(first).length === 6 && allIds(first).every((x) => UUID.test(x)) && new Set(allIds(first)).size === 6 && eq(first.education.map((e) => [e.institution, e.degree]), [['University A', 'Degree A'], ['University B', 'Degree B']]) && first.certifications.length === 2);
  check('46. the ids are the same on every load before saving; loading does not write', eq(allIds(first), allIds(second)) && (await stored()).schemaVersion === 3);
  check('46. saving persists schema 4 with the same ids; reload keeps them', (await saveEditor()) && (await stored()).schemaVersion === 4 && eq(allIds(await stored()), allIds(first)) && (await reloadEditor(), eq(allIds(await profileViaWorker()), allIds(first))));
  const [A, B] = ids(first.education);
  const [W1, W2] = ids(first.workExperience);

  // =================== 38. repeated generic fields → explicit assignment ===================
  let p = await analyzePage('/dup');
  let items = await review(p.popup);
  check('38. both Degree fields: repeated, "Assign record", no Teach; Institution maps normally (saved mapping)', items[0].mapping === 'Repeated question · no record context' && items[0].assign === 'Assign record' && !items[0].teach && items[1].assign === 'Assign record' && items[2].mapping.startsWith('→ Institution') && items[2].assign === null);
  const before = await p.tab.evaluate('document.documentElement.outerHTML');
  const shown = await assignVia(p.popup, 0, `education@${A}.degree`);
  await assignVia(p.popup, 1, `education@${B}.degree`);
  console.log('      assign choices: ' + JSON.stringify(shown));
  check('38. the record picker shows readable records, never ids or contact details', shown.groups.includes('Education 1 — University A · Degree A') && shown.groups.includes('Education 2 — University B · Degree B') && shown.options.includes('Education 1 → Degree') && !UUID.test(JSON.stringify(shown)) && !/jane\.doe|555 010/.test(JSON.stringify(shown)));
  items = await review(p.popup);
  check('38. after assignment: "Education n → Degree · Assigned by you", unticked, page unchanged', items[0].mapping === '→ Education 1 → Degree · Assigned by you' && items[1].mapping === '→ Education 2 → Degree · Assigned by you' && !items[0].checked && !items[1].checked && items[0].note === 'Assigned by you. Select to fill.' && (await p.tab.evaluate('document.documentElement.outerHTML')) === before && !UUID.test(JSON.stringify(items)));
  await toggleIndex(p.popup, [0, 1, 2]);
  let summary = await fill(p.popup);
  let v = await values(p.tab);
  let msgs = await sent(p);
  let crossed = msgs.filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions);
  check('38. Fill: Degree #1 ← Education A, Degree #2 ← Education B, Institution ← primary', eq([v.d1, v.d2, v.uni], ['Degree A', 'Degree B', 'University A']), `${summary} ${JSON.stringify(v)}`);
  check('38/45. only those values crossed; no record ids, collections, or assignments reach the page', eq(crossed.map((i) => [i.fieldId, i.value]), [['id:d1', 'Degree A'], ['id:d2', 'Degree B'], ['id:uni', 'University A']]) && !UUID.test(JSON.stringify(msgs)) && !/education@|recordId|"education":|assignments/.test(JSON.stringify(msgs)), JSON.stringify(crossed));
  check('no submission', (await p.tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  let shot = await p.popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase13-assigned.png'), Buffer.from(shot.data, 'base64'));

  // =================== 39. reorder: assignments follow the stable id ===================
  await reloadEditor();
  await editor.evaluate(`r.click('Move Education 2 up')`);
  check('39. reorder in the profile (B first) keeps ids with their records', (await saveEditor()) && eq(ids((await stored()).education), [B, A]));
  await reanalyze(p);
  items = await review(p.popup);
  check('39. assignments now read "Education 2 → Degree" for A and "Education 1 → Degree" for B', items[0].mapping === '→ Education 2 → Degree · Assigned by you' && items[1].mapping === '→ Education 1 → Degree · Assigned by you');
  await toggleIndex(p.popup, [0, 1]);
  await fill(p.popup);
  v = await values(p.tab);
  check('39. Fill still resolves Degree #1 → A and Degree #2 → B (identity, not position)', v.d1 === 'Degree A' && v.d2 === 'Degree B', JSON.stringify(v));

  // =================== 41. change a record value ===================
  await reloadEditor();
  await editor.evaluate(`r.set('Education 2', 'Degree', 'Degree A2')`);
  check('41. Education A edited (id unchanged)', (await saveEditor()) && eq(ids((await stored()).education), [B, A]) && (await stored()).education[1].degree === 'Degree A2');
  await reanalyze(p);
  await toggleIndex(p.popup, [0]);
  await fill(p.popup);
  check('41. the assignment stays valid and the new value is used', (await values(p.tab)).d1 === 'Degree A2');

  // =================== 42. remapping ===================
  await reanalyze(p);
  await assignVia(p.popup, 0, `education@${B}.degree`);
  items = await review(p.popup);
  check('42. remapping replaces the assignment and leaves the field unticked', items[0].mapping === '→ Education 1 → Degree · Assigned by you' && !items[0].checked && (await stored('recordAssignments')).assignments.filter((a) => a.fieldId === 'id:d1').length === 1);
  await toggleIndex(p.popup, [0]);
  await fill(p.popup);
  msgs = await sent(p);
  check('42. only B\'s value can be sent afterwards', (await values(p.tab)).d1 === 'Degree B' && !JSON.stringify(msgs).includes('Degree A2'));
  // Remove, then assign back to A
  await p.popup.evaluate(`document.querySelectorAll('.review-item')[0].querySelector('button.unassign').click(); true`);
  await waitFor(p.popup, `document.querySelectorAll('.review-item')[0].querySelector('.mapping').textContent === 'Repeated question · no record context'`);
  check('35. an assignment can be removed (back to "Repeated question", not selectable)', (await review(p.popup))[0].disabled);
  await assignVia(p.popup, 0, `education@${A}.degree`);

  // =================== 40. delete an assigned record ===================
  await reloadEditor();
  await editor.evaluate(`r.click('Remove Education 2')`); // A (now second)
  check('40. Education A deleted', (await saveEditor()) && eq(ids((await stored()).education), [B]));
  await reanalyze(p);
  items = await review(p.popup);
  check('40. the assignment is unavailable and the field cannot be selected', items[0].mapping === 'Assigned record no longer exists · Assigned by you' && items[0].disabled && items[0].note.startsWith('The profile record this field was assigned to no longer exists'));
  await toggleIndex(p.popup, [1]);
  await fill(p.popup);
  v = await values(p.tab);
  msgs = await sent(p);
  check('40. Fill never falls back to Education B for the deleted assignment', v.d1 === '' && v.d2 === 'Degree B' && !JSON.stringify(msgs).includes('"id:d1"'), JSON.stringify(v));
  await reloadEditor();
  await editor.evaluate(`r.click('+ Add education')`);
  await editor.evaluate(`r.set('Education 2', 'Institution', 'University C')`);
  await editor.evaluate(`r.set('Education 2', 'Degree', 'Degree C')`);
  await saveEditor();
  const C = ids((await stored()).education)[1];
  await reanalyze(p);
  check('40. a new record gets a new id and does not inherit the deleted assignment', C !== A && UUID.test(C) && (await review(p.popup))[0].mapping === 'Assigned record no longer exists · Assigned by you');
  await close(p);

  // =================== 43. failure isolation ===================
  p = await analyzePage('/three');
  await assignVia(p.popup, 0, `education@${B}.degree`);
  await assignVia(p.popup, 1, `education@${C}.degree`);
  await assignVia(p.popup, 2, `education@${B}.institution`);
  await toggleIndex(p.popup, [0, 1, 2]);
  const approvedProfile = await stored();
  await editor.evaluate(writeRaw('profile', { ...approvedProfile, education: approvedProfile.education.filter((e) => e.id !== C) })); // C deleted after approval
  summary = await fill(p.popup);
  v = await values(p.tab);
  const notes = await p.popup.evaluate(`[...document.querySelectorAll('.review-item .note')].map((n) => n.textContent)`);
  check('43. A fills, B (deleted record) is refused, C fills', eq([v.f1, v.f2, v.f3], ['Degree B', '', 'University B']) && notes[1].startsWith('Failed.') && summary.includes('2 fields filled'), `${summary} ${JSON.stringify(notes)} ${JSON.stringify(v)}`);
  await close(p);

  // =================== 13. single fields ===================
  p = await analyzePage('/single');
  items = await review(p.popup);
  check('13. a single Degree maps as before: selected, Teach available, no Assign', items[0].checked && items[0].teach && items[0].assign === null && items[0].mapping.startsWith('→ Highest degree'));
  await close(p);

  // =================== 44. Teach Once regression ===================
  p = await analyzePage('/teach-single');
  await teach(p.popup, 'Preferred campus', 'institution');
  await p.popup.evaluate(`t.toggle('Preferred campus'); true`);
  await sleep(100);
  await fill(p.popup);
  check('44. single unknown field: Teach → Save → approve → Fill works', (await values(p.tab)).pc === 'University B');
  await close(p);
  const savedBefore = (await stored('savedMappings')).mappings.length;
  p = await analyzePage('/teach-dup');
  items = await review(p.popup);
  check('44. repeated unknown fields: no Teach, Assign record instead, nothing filled', items.length === 2 && items.every((i) => !i.teach && i.assign === 'Assign record' && i.disabled) && (await stored('savedMappings')).mappings.length === savedBefore && Object.values(await values(p.tab)).every((x) => x === ''));
  await assignVia(p.popup, 0, `education@${B}.institution`);
  await toggleIndex(p.popup, [0]);
  await fill(p.popup);
  v = await values(p.tab);
  check('44. after explicit assignment and approval only that copy fills', v.pc1 === 'University B' && v.pc2 === '');
  await close(p);

  // =================== 37. Workday ===================
  p = await analyzePage('/workday');
  items = await review(p.popup);
  check('37. headed Education 1/2 blocks keep positional mapping; unheaded Job Title ×2 is unsupported until assigned', items[0].mapping.includes('(education[0].institution)') && items[1].mapping.includes('(education[1].institution)') && items.slice(2).every((i) => i.mapping === 'Repeated question · no record context' && i.assign === 'Assign record'));
  await assignVia(p.popup, 2, `workExperience@${W1}.title`);
  await assignVia(p.popup, 3, `workExperience@${W2}.title`);
  items = await review(p.popup);
  await toggleIndex(p.popup, [1, 2, 3]);
  await fill(p.popup);
  v = await values(p.tab);
  // The profile has one education record left (C was deleted in 43): block 2 has no value.
  check('37. after assignment + approval: Job Title #1 ← Work experience A, #2 ← B; schools by position', eq([v.ws1, v.ws2, v.wt1, v.wt2], ['University B', '', 'Title A', 'Title B']) && items[1].disabled && items[1].note === 'No value in your profile.' && !items[2].checked && (await p.tab.evaluate(`document.getElementById('nav').textContent`)) === '0', JSON.stringify(v));
  await close(p);

  // =================== 45. privacy ===================
  p = await analyzePage('/dup');
  const fromPage = await p.tab.evaluate(`Promise.all(['applyonce/get-record-choices', 'applyonce/get-profile'].map((type) => chrome.runtime.sendMessage({ type }))).then((r) => JSON.stringify(r))`, p.world.id);
  const saveFromPage = await p.tab.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/save-assignment', payload: { page: location.origin + location.pathname, field: { id: 'id:d1', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, repeatedCount: 2, signals: { htmlId: 'd1', name: 'd1', label: 'Degree' } }, target: 'education@${B}.degree' } }).then((r) => JSON.stringify(r))`, p.world.id);
  check('45. the page cannot read record choices, the profile, or write assignments', fromPage === JSON.stringify([{ ok: false, error: 'forbidden' }, { ok: false, error: 'forbidden' }]) && saveFromPage === JSON.stringify({ ok: false, error: 'forbidden' }));
  const pageState = JSON.parse(await p.tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce|record|profile/i.test(k)) })`));
  check('45. no profile data or record ids in page DOM, storage, or globals', !UUID.test(pageState.html) && !/University|Degree [ABC]|Company|Certification/.test(pageState.html) && pageState.local.length + pageState.session.length + pageState.globals.length === 0);
  await close(p);
  const logged = consoleLog.join('\n');
  console.log(`      console lines captured: ${consoleLog.length}`);
  check('45. no profile values or record ids in any console', !UUID.test(logged) && !['University', 'Degree A', 'Degree B', 'Company A', 'Title A', 'Certification', 'jane.doe', 'Current Co'].some((x) => logged.includes(x)));
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
