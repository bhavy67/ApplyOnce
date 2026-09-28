// Phase 14 (stable generic field identity + assignment management) in real Chrome. Fake data only.
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

const row = (attrs, label, id) => `<p id="${id}"><label>${label} <input ${attrs}></label></p>`;
const shell = (title, body, script = '') => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>
<form id="apply">${body}<button type="submit">Submit application</button></form>
<button type="button" id="swap">Swap</button><button type="button" id="rename">Rename</button><button type="button" id="clear">Clear</button>
<p id="submitted">false</p>
<script>
  document.getElementById('apply').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
  document.getElementById('clear').addEventListener('click', () => document.querySelectorAll('#apply input').forEach((i) => { i.value = ''; }));
  ${script}
</script></body></html>`;
const swapScript = (a, b) => `document.getElementById('swap').addEventListener('click', () => { const x = document.getElementById('${a}'); const y = document.getElementById('${b}'); const marker = document.createElement('span'); x.replaceWith(marker); y.replaceWith(x); marker.replaceWith(y); });`;

const PAGES = {
  '/stable': shell('Distinct names', `<section><h2>Education</h2>${row('name="degree_undergrad"', 'Degree', 'ug')}${row('name="degree_postgrad"', 'Degree', 'pg')}${row('name="institution"', 'Institution', 'in')}</section>`,
    `${swapScript('ug', 'pg')} document.getElementById('rename').addEventListener('click', () => { document.querySelector('[name=degree_undergrad]').name = 'degree_changed'; });`),
  '/containers': shell('Same name, different labeled sections', `<section id="fug" aria-label="Undergraduate">${row('name="degree"', 'Degree', 'x1')}</section><section id="fpg" aria-label="Postgraduate">${row('name="degree"', 'Degree', 'x2')}</section>`, swapScript('fug', 'fpg')),
  '/identical': shell('Identical copies', `<section><h2>Education</h2>${row('', 'Degree', 'c1')}${row('', 'Degree', 'c2')}</section>`, swapScript('c1', 'c2')),
  '/repeated-saved': shell('Repeated with saved mapping', `${row('name="inst_a"', 'Institution', 'r1')}${row('name="inst_b"', 'Institution', 'r2')}${row('name="first"', 'First Name', 'r3')}`),
  '/teach-single': shell('Teach single', row('name="campus"', 'Preferred campus', 't1')),
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const page = PAGES[url.pathname];
  if (page) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page); }
  const match = url.pathname.match(/^\/(react|vue|angular)\/(.*)$/);
  if (match) {
    const file = join(FW, `${match[1]}-assign/dist`, match[2] || 'index.html');
    if (existsSync(file)) {
      res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'text/html; charset=utf-8' });
      return res.end(readFileSync(file));
    }
  }
  res.writeHead(404); res.end();
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
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idb = (body) => `new Promise((resolve, reject) => { const r = indexedDB.open('applyonce'); r.onerror = reject; r.onsuccess = () => { const db = r.result; ${body} }; })`;
const writeRaw = (key, value) => idb(`const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(${JSON.stringify(value)}, '${key}'); tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = reject;`);
const readRaw = (key) => idb(`const g = db.transaction('records').objectStore('records').get('${key}'); g.onsuccess = () => { resolve(JSON.stringify(g.result ?? null)); db.close(); }; g.onerror = reject;`);
const PROFILE = {
  schemaVersion: 4, identity: { firstName: 'Jane' }, contact: { email: 'jane.doe@example.com' }, location: {},
  education: [{ id: A, institution: 'University A', degree: 'Degree A' }, { id: B, institution: 'University B', degree: 'Degree B' }],
  experience: {}, workExperience: [], certifications: [], links: {}, preferences: {}, authorization: {}, documents: { resumes: [], coverLetters: [] }, customAnswers: [],
};
const MAPPINGS = { version: 1, mappings: [
  { key: 'v1|text|q=institution|c=|i=', parts: { fieldType: 'text', question: 'institution' }, profileField: 'institution', createdAt: now, updatedAt: now },
] };
const SECRET = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|fp-[0-9a-f]{16}|m-[0-9a-f]{16}/;

let id;
let editor;
const EDITOR_HELPERS = `window.r = {
  click: (name) => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === name || x.getAttribute('aria-label') === name).click(); return true; },
  status: () => document.querySelector('.save-bar [role=status]')?.textContent ?? '',
  assignments: () => [...document.querySelectorAll('.saved-assignments .assignment-list li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim()),
  heading: () => document.querySelector('.saved-assignments h2')?.textContent ?? '',
}; true`;
async function reloadEditor() {
  await editor.send('Page.reload');
  await sleep(300);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9 && !!document.querySelector('.saved-assignments')`);
  await editor.evaluate(EDITOR_HELPERS);
  await waitFor(editor, `!document.querySelector('.saved-assignments').innerText.includes('Loading')`);
}
const stored = async (key) => JSON.parse(await editor.evaluate(readRaw(key)));
const review = async (popup) => JSON.parse(await popup.evaluate(`JSON.stringify([...document.querySelectorAll('.review-item')].map((li) => ({ name: li.querySelector('.field-name').textContent, meta: li.querySelector('.field-meta').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, teach: !!li.querySelector('button.teach'), assign: li.querySelector('button.assign')?.textContent ?? null })))`));
const values = async (tab) => JSON.parse(await tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#apply input')].map((e, i) => [e.name || 'copy' + (i + 1), e.value])))`));
async function analyzePage(path) {
  const tab = await open(`${ORIGIN}${path}`);
  await waitFor(tab, `document.readyState === 'complete' && document.querySelectorAll('#apply input').length > 0`, 15000);
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  return { tab, popup, world };
}
/** Opens Assign record on the item whose meta contains `metaIncludes` (or index), picks target, saves. */
async function assignVia(popup, index, target) {
  const item = `document.querySelectorAll('.review-item')[${index}]`;
  await popup.evaluate(`${item}.querySelector('button.assign').click(); true`);
  await waitFor(popup, `!!${item}.querySelector('.assign-editor select')`);
  const warning = await popup.evaluate(`${item}.querySelector('.assign-editor .note.warning')?.textContent ?? ''`);
  await popup.evaluate(`(() => { const s = ${item}.querySelector('.assign-editor select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(target)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(50);
  await popup.evaluate(`[...${item}.querySelectorAll('button')].find((b) => b.textContent === 'Save assignment').click(); true`);
  await waitFor(popup, `!${item}.querySelector('.assign-editor')`);
  return warning;
}
const indexWithMeta = (items, text) => items.findIndex((i) => i.meta.includes(text));
const selectAllAssignable = async (popup) => {
  await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]')].forEach((c) => { if (!c.checked && !c.disabled) c.click(); }); true`);
  await sleep(100);
};
const fillIfAny = async (popup) => ((await popup.evaluate(`!t.button('Fill ').disabled`)) ? fill(popup) : 'nothing selected');
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
  await editor.evaluate(writeRaw('profile', PROFILE));
  await editor.evaluate(writeRaw('savedMappings', MAPPINGS));
  await reloadEditor();

  // =================== 38. stable-field assignment ===================
  let p = await analyzePage('/stable');
  let items = await review(p.popup);
  check('38.1–2 both Degree fields detected; both require Assign record', items.filter((i) => i.name === 'Degree').every((i) => i.mapping === 'Repeated question · no record context' && i.assign === 'Assign record'));
  const before = await p.tab.evaluate('document.documentElement.outerHTML');
  const w1 = await assignVia(p.popup, indexWithMeta(items, 'degree_undergrad'), `education@${A}.degree`);
  const w2 = await assignVia(p.popup, indexWithMeta(items, 'degree_postgrad'), `education@${B}.degree`);
  check('stable fields: no "identical copies" warning (the names tell them apart)', w1 === '' && w2 === '');
  items = await review(p.popup);
  const ug = () => items[indexWithMeta(items, 'degree_undergrad')];
  const pg = () => items[indexWithMeta(items, 'degree_postgrad')];
  check('38.3–6 assigned to Education 1 / Education 2, unchecked, page unchanged, saved', ug().mapping === '→ Education 1 → Degree · Assigned by you' && pg().mapping === '→ Education 2 → Degree · Assigned by you' && !ug().checked && !pg().checked && (await p.tab.evaluate('document.documentElement.outerHTML')) === before && (await stored('recordAssignments')).assignments.length === 2);
  await selectAllAssignable(p.popup);
  await fill(p.popup);
  let v = await values(p.tab);
  check('38.7–9 Fill: each value to its own field', v.degree_undergrad === 'Degree A' && v.degree_postgrad === 'Degree B' && v.institution === 'University A', JSON.stringify(v));

  // =================== 39. field reorder ===================
  await p.tab.evaluate(`document.getElementById('swap').click(); document.getElementById('clear').click(); true`);
  await analyze(p.popup);
  items = await review(p.popup);
  check('39. after swapping the fields, each assignment follows its field (not the position)', items[0].meta.includes('degree_postgrad') && items[0].mapping === '→ Education 2 → Degree · Assigned by you' && items[1].meta.includes('degree_undergrad') && items[1].mapping === '→ Education 1 → Degree · Assigned by you');
  await selectAllAssignable(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('39. Fill after the swap: still the right value in each field', v.degree_undergrad === 'Degree A' && v.degree_postgrad === 'Degree B', JSON.stringify(v));

  // =================== 36. changed field ===================
  await p.tab.evaluate(`document.getElementById('rename').click(); document.getElementById('clear').click(); true`);
  await analyze(p.popup);
  items = await review(p.popup);
  const changed = items[indexWithMeta(items, 'degree_changed')];
  check('36. a renamed field does not inherit the old assignment', changed.mapping === 'Repeated question · no record context' && changed.disabled && items[indexWithMeta(items, 'degree_postgrad')].mapping.includes('Assigned by you'));
  await selectAllAssignable(p.popup);
  await fillIfAny(p.popup);
  v = await values(p.tab);
  const msgs = JSON.parse(await p.tab.evaluate(`JSON.stringify(globalThis.__recorded)`, p.world.id));
  const sentToChanged = msgs.filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions).filter((i) => i.expected.name === 'degree_changed');
  check('36. no value is sent to the changed field', v.degree_changed === '' && sentToChanged.length === 0, JSON.stringify(v));
  await close(p);

  // =================== E. same name, different labeled sections (positional field ids) ===================
  p = await analyzePage('/containers');
  items = await review(p.popup);
  await assignVia(p.popup, 0, `education@${A}.degree`); // Undergraduate
  await assignVia(p.popup, 1, `education@${B}.degree`); // Postgraduate
  await p.tab.evaluate(`document.getElementById('swap').click(); true`);
  await analyze(p.popup);
  items = await review(p.popup);
  check('containers: same name (ids name:degree / name:degree~2 are positional); after swapping, assignments follow the section', items[0].mapping === '→ Education 2 → Degree · Assigned by you' && items[1].mapping === '→ Education 1 → Degree · Assigned by you');
  await selectAllAssignable(p.popup);
  await fill(p.popup);
  const sections = JSON.parse(await p.tab.evaluate(`JSON.stringify([...document.querySelectorAll('section')].map((f) => [f.getAttribute('aria-label'), f.querySelector('input').value]))`));
  check('containers: Fill puts A in Undergraduate and B in Postgraduate', eq(sections, [['Postgraduate', 'Degree B'], ['Undergraduate', 'Degree A']]), JSON.stringify(sections));
  await close(p);

  // =================== 40. identical fields ===================
  const savedBefore = (await stored('recordAssignments')).assignments.length;
  p = await analyzePage('/identical');
  items = await review(p.popup);
  check('40. identical copies stay ambiguous; Assign record is offered', items.length === 2 && items.every((i) => i.mapping === 'Repeated question · no record context' && i.assign === 'Assign record' && i.disabled));
  const warning = await assignVia(p.popup, 0, `education@${A}.degree`);
  items = await review(p.popup);
  check('40. with a clear warning; the assignment is not saved ("for now only")', warning.includes('won’t be saved') && items[0].note.startsWith('Assigned for now only') && (await stored('recordAssignments')).assignments.length === savedBefore, warning);
  await selectAllAssignable(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('40. explicit approval fills the current copy only; nothing automatic', v.copy1 === 'Degree A' && v.copy2 === '', JSON.stringify(v));
  await p.tab.evaluate(`document.getElementById('swap').click(); document.getElementById('clear').click(); true`);
  await analyze(p.popup);
  items = await review(p.popup);
  check('40. after the page changes and Analyze runs again, nothing carries over (no stable identity)', items.every((i) => i.mapping === 'Repeated question · no record context'));
  await close(p);

  // =================== 33. React / Vue / Angular re-render ===================
  for (const fw of ['react', 'vue', 'angular']) {
    p = await analyzePage(`/${fw}/`);
    items = await review(p.popup);
    console.log(`      ${fw} fields: ` + items.map((i) => `${i.name} [${i.meta}] ${i.mapping}`).join(' | '));
    await assignVia(p.popup, indexWithMeta(items, 'degree_undergrad'), `education@${A}.degree`);
    await assignVia(p.popup, indexWithMeta(items, 'degree_postgrad'), `education@${B}.degree`);
    const idsBefore = await p.tab.evaluate(`JSON.stringify([...document.querySelectorAll('input[name^=degree]')].map((i) => i.id))`);
    await p.tab.evaluate(`document.getElementById('swap').click(); true`);
    await sleep(200);
    await p.tab.evaluate(`document.getElementById('rerender').click(); true`);
    await sleep(300);
    const idsAfter = await p.tab.evaluate(`JSON.stringify([...document.querySelectorAll('input[name^=degree]')].map((i) => i.id))`);
    await analyze(p.popup);
    items = await review(p.popup);
    const ok = items[indexWithMeta(items, 'degree_undergrad')]?.mapping === '→ Education 1 → Degree · Assigned by you' && items[indexWithMeta(items, 'degree_postgrad')]?.mapping === '→ Education 2 → Degree · Assigned by you' && items[0].meta.includes('degree_postgrad');
    await selectAllAssignable(p.popup);
    await fill(p.popup);
    const state = JSON.parse(await p.tab.evaluate(`document.getElementById('state').textContent`));
    check(`33. ${fw}: swapped + re-rendered with new generated ids (${idsBefore} → ${idsAfter}); assignments resolve and fill framework state`, ok && idsBefore !== idsAfter && state.degree_undergrad === 'Degree A' && state.degree_postgrad === 'Degree B' && (await p.tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false', JSON.stringify(state));
    await close(p);
  }

  // =================== 22 / 26. Teach Once and saved mappings ===================
  p = await analyzePage('/repeated-saved');
  items = await review(p.popup);
  await selectAllAssignable(p.popup);
  await fillIfAny(p.popup);
  v = await values(p.tab);
  check('22. the saved "Institution → institution" mapping never fills the repeated copies', items.filter((i) => i.name === 'Institution').every((i) => i.mapping === 'Repeated question · no record context' && !i.teach) && v.inst_a === '' && v.inst_b === '' && v.first === 'Jane', JSON.stringify(v));
  await close(p);
  p = await analyzePage('/teach-single');
  await teach(p.popup, 'Preferred campus', 'institution');
  await p.popup.evaluate(`t.toggle('Preferred campus'); true`);
  await sleep(100);
  await fill(p.popup);
  check('26. single unknown field: Teach → Save → approve → Fill still works', (await values(p.tab)).campus === 'University A');
  await close(p);

  // =================== 37 / 41. management UI, 17 reorder, 19 delete ===================
  await reloadEditor();
  let list = await editor.evaluate('JSON.stringify(r.assignments())');
  console.log('      saved assignments: ' + list);
  const listed = JSON.parse(list);
  check('37. Saved assignments lists them with site, path, question, and record labels', listed.length >= 7 && (await editor.evaluate('r.heading()')) === `Saved assignments (${listed.length})` && listed.some((t) => t.includes('“Degree”') && t.includes('→ Education 1 · Degree') && t.includes('text field · 127.0.0.1/stable')));
  check('37. no raw ids, fingerprints, field ids, or profile values in the list', !SECRET.test(list) && !/University|Degree A|Degree B|name:|index:|jane/.test(list));
  await editor.evaluate(`r.click('Move Education 2 up')`);
  await editor.evaluate(`r.click('Save profile')`);
  await waitFor(editor, `r.status() === 'Profile saved'`);
  await reloadEditor();
  list = JSON.parse(await editor.evaluate('JSON.stringify(r.assignments())'));
  check('17. after reordering records, A shows as "Education 2 · Degree" (still record A)', list.some((t) => t.includes('/stable') && t.includes('→ Education 2 · Degree')) && (await stored('recordAssignments')).assignments.some((a) => a.target === `education@${A}.degree`));
  await editor.evaluate(`r.click('Remove Education 2')`); // A (now second)
  await editor.evaluate(`r.click('Save profile')`);
  await waitFor(editor, `r.status() === 'Profile saved'`);
  await reloadEditor();
  list = JSON.parse(await editor.evaluate('JSON.stringify(r.assignments())'));
  check('19/35. deleting record A: its assignments show "Unavailable", are kept (not retargeted)', list.filter((t) => t.includes('Unavailable (record deleted)')).length >= 3 && (await stored('recordAssignments')).assignments.every((a) => a.target.startsWith(`education@${A}`) || a.target.startsWith(`education@${B}`)));
  p = await analyzePage('/stable');
  items = await review(p.popup);
  await selectAllAssignable(p.popup);
  await fillIfAny(p.popup);
  v = await values(p.tab);
  check('35. the unavailable assignment cannot be selected and nothing falls back to B', items[indexWithMeta(items, 'degree_undergrad')].mapping === 'Assigned record no longer exists · Assigned by you' && items[indexWithMeta(items, 'degree_undergrad')].disabled && v.degree_undergrad === '' && v.degree_postgrad === 'Degree B', JSON.stringify(v));
  await close(p);
  await reloadEditor();
  const countBefore = (await stored('recordAssignments')).assignments.length;
  await editor.evaluate(`[...document.querySelectorAll('.saved-assignments .assignment-list li')].find((li) => li.innerText.includes('Unavailable')).querySelector('button').click(); true`);
  await waitFor(editor, `document.querySelectorAll('.saved-assignments .assignment-list li').length === ${countBefore - 1}`);
  await reloadEditor();
  check('41. Remove one; after reload only the others remain', (await stored('recordAssignments')).assignments.length === countBefore - 1 && JSON.parse(await editor.evaluate('JSON.stringify(r.assignments())')).length === countBefore - 1);
  // Clear Profile does not delete assignments.
  const mappingsBefore = JSON.stringify(await stored('savedMappings'));
  await editor.evaluate(`r.click('Clear profile…')`);
  await sleep(100);
  await editor.evaluate(`r.click('Clear Profile')`);
  await waitFor(editor, `r.status() === 'Profile cleared'`);
  await reloadEditor();
  list = JSON.parse(await editor.evaluate('JSON.stringify(r.assignments())'));
  check('26. Clear Profile keeps assignments (now unavailable), and saved mappings', list.length === countBefore - 1 && list.every((t) => t.includes('Unavailable')) && JSON.stringify(await stored('savedMappings')) === mappingsBefore);
  await editor.evaluate(writeRaw('profile', PROFILE));
  await reloadEditor();
  const profileBefore = JSON.stringify(await stored('profile'));
  await editor.evaluate(`r.click('Clear all assignments…')`);
  await sleep(100);
  check('41. Clear all asks for confirmation', await editor.evaluate(`!!document.querySelector('dialog[open]') && document.querySelector('dialog[open]').innerText.includes('Clear all saved assignments?')`));
  await editor.evaluate(`r.click('Clear all assignments')`);
  await waitFor(editor, `document.querySelector('.saved-assignments').innerText.includes('No saved assignments.')`);
  check('41. Clear all removes every assignment; profile and saved mappings unchanged', (await stored('recordAssignments')) === null && JSON.stringify(await stored('profile')) === profileBefore && JSON.stringify(await stored('savedMappings')) === mappingsBefore && (await editor.evaluate('r.heading()')) === 'Saved assignments (0)');
  let shot = await editor.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(SCRATCH, 'phase14-profile.png'), Buffer.from(shot.data, 'base64'));
  p = await analyzePage('/stable');
  items = await review(p.popup);
  check('13. after clearing, Analyze shows the repeated fields as unassigned', items.filter((i) => i.name === 'Degree').every((i) => i.mapping === 'Repeated question · no record context'));

  // =================== 42. privacy ===================
  const fromPage = await p.tab.evaluate(`Promise.all(['applyonce/list-assignments', 'applyonce/clear-assignments', 'applyonce/get-record-choices'].map((type) => chrome.runtime.sendMessage({ type }))).then((r) => JSON.stringify(r))`, p.world.id);
  check('42. the page cannot list or clear assignments or read records', fromPage === JSON.stringify([{ ok: false, error: 'forbidden' }, { ok: false, error: 'forbidden' }, { ok: false, error: 'forbidden' }]), fromPage);
  const pageState = JSON.parse(await p.tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce|assign|record|profile|fp/i.test(k)) })`));
  check('42. no ids, fingerprints, assignments, or profile values in the page DOM, storage, or globals', !SECRET.test(pageState.html) && !/University|Degree [AB]/.test(pageState.html) && pageState.local.length + pageState.session.length + pageState.globals.length === 0);
  await close(p);
  const logged = consoleLog.join('\n');
  console.log(`      console lines captured: ${consoleLog.length} → ${consoleLog.join(' || ')}`);
  check('42. no profile values, ids, or fingerprints in any console', !SECRET.test(logged) && !['University', 'Degree A', 'Degree B', 'jane.doe'].some((x) => logged.includes(x)));
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
