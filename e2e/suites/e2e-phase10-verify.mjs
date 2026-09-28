// Phase 10 final verification in real Chrome via the DevTools pipe. Fake data only; nothing is submitted.
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

const row = (id, label, type = 'text') => `<p><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}"></p>`;
const APPLY = `<!doctype html><html lang="en"><head><title>Verification form</title></head><body>
<form id="apply">
${row('uni', 'University')}
${row('s2', 'Second school')}${row('s2d', 'Second school degree')}
${row('ec', 'Earlier company')}${row('et', 'Earlier title')}${row('ch', 'Certificate held')}
${row('am', 'Alma mater')}${row('qe', 'Qualification earned')}${row('sm', 'Subject majored in')}${row('yc', 'Year completed', 'number')}
${row('rh', 'Role you hold now')}${row('ow', 'Organisation you work for')}${row('yw', 'Years worked in total', 'number')}
<button type="submit">Submit application</button>
</form><p id="submitted">false</p>
<script>document.getElementById('apply').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });</script>
</body></html>`;

const server = createServer((req, res) => {
  const ok = new URL(req.url, 'http://x').pathname === '/apply';
  res.writeHead(ok ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(ok ? APPLY : '');
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
const oldMapping = (question, fieldType, profileField) => ({ key: `v1|${fieldType}|q=${question}|c=|i=`, parts: { fieldType, question }, profileField, site: '127.0.0.1', createdAt: now, updatedAt: now });
// Saved exactly as Phases 4–9 stored them: scalar profile field keys only.
const OLD_MAPPINGS = { version: 1, mappings: [
  oldMapping('alma mater', 'text', 'institution'),
  oldMapping('qualification earned', 'text', 'highest_degree'),
  oldMapping('subject majored in', 'text', 'field_of_study'),
  oldMapping('year completed', 'number', 'graduation_year'),
  oldMapping('role you hold now', 'text', 'current_title'),
  oldMapping('organisation you work for', 'text', 'current_company'),
  oldMapping('years worked in total', 'number', 'experience_years'),
] };
const idb = (body) => `new Promise((resolve, reject) => { const r = indexedDB.open('applyonce'); r.onerror = reject; r.onsuccess = () => { const db = r.result; ${body} }; })`;
const readRaw = (key) => idb(`const g = db.transaction('records').objectStore('records').get('${key}'); g.onsuccess = () => { resolve(JSON.stringify(g.result ?? null)); db.close(); }; g.onerror = reject;`);
const writeRaw = (key, value) => idb(`const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(${JSON.stringify(value)}, '${key}'); tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = reject;`);
const stored = async (page, key = 'profile') => JSON.parse(await page.evaluate(readRaw(key)));

const HELPERS = `
  window.r = {
    rec: (title) => [...document.querySelectorAll('.record')].find((x) => x.querySelector('h3')?.textContent === title),
    input: (title, label) => { const rec = r.rec(title); if (!rec) throw new Error('no record ' + title); const l = [...rec.querySelectorAll('label')].find((x) => x.textContent.trim() === label); if (!l) throw new Error('no field ' + label + ' in ' + title); return document.getElementById(l.htmlFor); },
    scalar: (label) => { const l = [...document.querySelectorAll('form label')].find((x) => !x.closest('.record') && x.textContent.trim() === label); return document.getElementById(l.htmlFor); },
    write: (el, value) => {
      if (el.type === 'checkbox') { if (el.checked !== value) el.click(); return true; }
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      return true;
    },
    set: (title, label, value) => r.write(r.input(title, label), value),
    get: (title, label) => { const el = r.input(title, label); return el.type === 'checkbox' ? el.checked : el.value; },
    button: (name) => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === name || x.getAttribute('aria-label') === name),
    click: (name) => { const b = r.button(name); if (!b) throw new Error('no button ' + name); b.click(); return true; },
    titles: (prefix = '') => [...document.querySelectorAll('.record h3')].map((h) => h.textContent).filter((t) => t.startsWith(prefix)),
    errorsIn: (title) => [...(r.rec(title)?.querySelectorAll('.field-error') ?? [])].map((e) => e.textContent),
    errors: () => [...document.querySelectorAll('form .field-error')].map((e) => e.textContent),
    text: (section) => [...document.querySelectorAll('form section')].find((s) => s.querySelector('h2')?.textContent === section)?.innerText ?? '',
    status: () => document.querySelector('.save-bar [role=status]')?.textContent ?? '',
  };
  true`;
let id;
async function openEditor() {
  const editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9 || !!document.querySelector('.status-error')`);
  await editor.evaluate(HELPERS);
  return editor;
}
async function reloadEditor(editor) {
  await editor.send('Page.reload');
  await sleep(300);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9 || !!document.querySelector('.status-error')`);
  await editor.evaluate(HELPERS);
}
const E = (editor, expr) => editor.evaluate(expr);
const set = (editor, title, label, value) => E(editor, `r.set(${JSON.stringify(title)}, ${JSON.stringify(label)}, ${JSON.stringify(value)})`);
const get = (editor, title, label) => E(editor, `r.get(${JSON.stringify(title)}, ${JSON.stringify(label)})`);
const click = (editor, name) => E(editor, `r.click(${JSON.stringify(name)})`);
const titles = async (editor, prefix) => E(editor, `JSON.stringify(r.titles(${JSON.stringify(prefix)}))`);
async function save(editor) {
  await click(editor, 'Save profile');
  await waitFor(editor, `r.status() === 'Profile saved' || r.status().startsWith('Fix')`, 5000);
  return E(editor, 'r.status()');
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const YEAR_MAX = new Date().getFullYear() + 10;

try {
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')));
  ({ id } = await send('Extensions.loadUnpacked', { path: DIST }));
  // Service worker console, for the log check.
  for (let i = 0; i < 30; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(id));
    if (worker) { await attach(worker.targetId); break; }
    await sleep(100);
  }
  let editor = await openEditor();
  await E(editor, writeRaw('savedMappings', OLD_MAPPINGS));

  // =================== 3. Education ===================
  check('Edu 1. empty profile shows Education 1 (primary)', (await titles(editor, 'Education')) === JSON.stringify(['Education 1 (primary)']));
  await click(editor, '+ Add education');
  check('Edu 2. "+ Add education" on an empty profile shows Education 2', (await titles(editor, 'Education')) === JSON.stringify(['Education 1 (primary)', 'Education 2']), await titles(editor, 'Education'));
  await click(editor, '+ Add education');
  check('Edu 3. Education 3 added', (await titles(editor, 'Education')) === JSON.stringify(['Education 1 (primary)', 'Education 2', 'Education 3']));
  const EDU = [
    ['Education 1 (primary)', { Institution: 'University A', 'Highest degree': 'BSc', 'Field of study': 'Physics', 'Start year': 2010, 'Graduation year': 2014 }],
    ['Education 2', { Institution: 'University B', Degree: 'MSc', 'Field of study': 'Chemistry', 'Start year': 2014, 'Graduation year': 2016 }],
    ['Education 3', { Institution: "Université d'Exemple", Degree: 'PhD', 'Field of study': 'Biology', 'Start year': 1949, 'Graduation year': YEAR_MAX + 1 }],
  ];
  for (const [title, values] of EDU) for (const [label, value] of Object.entries(values)) await set(editor, title, label, value);
  check('Edu 13–14. invalid years block saving with inline errors on Education 3', (await save(editor)).startsWith('Fix') && eq(JSON.parse(await E(editor, `JSON.stringify(r.errorsIn('Education 3'))`)), [`Enter a year between 1950 and ${YEAR_MAX}.`, `Enter a year between 1950 and ${YEAR_MAX}.`]) && (await stored(editor)) === null, await E(editor, `JSON.stringify(r.errors())`));
  await set(editor, 'Education 3', 'Start year', 1950);
  await set(editor, 'Education 3', 'Graduation year', YEAR_MAX);
  check('Edu 13. boundary years (1950 and +10 years) are valid; errors clear live', (await E(editor, `r.errorsIn('Education 3').length`)) === 0);
  await set(editor, 'Education 3', 'Start year', 2016);
  await set(editor, 'Education 3', 'Graduation year', 2020);
  await click(editor, '+ Add education');
  await set(editor, 'Education 4', 'Institution', 'To Be Removed U');
  await click(editor, 'Remove Education 4');
  check('Edu 5. entry removed', (await titles(editor, 'Education')) === JSON.stringify(['Education 1 (primary)', 'Education 2', 'Education 3']));
  await click(editor, 'Move Education 3 up');
  const movedUp = [await get(editor, 'Education 2', 'Institution'), await get(editor, 'Education 2', 'Degree'), await get(editor, 'Education 3', 'Institution'), await get(editor, 'Education 3', 'Degree')];
  check('Edu 6–7. reorder moves every value with its entry', eq(movedUp, ["Université d'Exemple", 'PhD', 'University B', 'MSc']), JSON.stringify(movedUp));
  await click(editor, 'Move Education 2 up');
  const promoted = [await get(editor, 'Education 1 (primary)', 'Institution'), await get(editor, 'Education 1 (primary)', 'Highest degree'), await get(editor, 'Education 2', 'Institution')];
  check('Edu 8. the first entry is the primary one (labels and position)', eq(promoted, ["Université d'Exemple", 'PhD', 'University A']), JSON.stringify(promoted));
  await click(editor, 'Move Education 1 (primary) down');
  await click(editor, 'Move Education 3 up');
  const back = await E(editor, `JSON.stringify(['Education 1 (primary)', 'Education 2', 'Education 3'].map((t) => r.get(t, 'Institution')))`);
  check('Edu 7. order restored', back === JSON.stringify(['University A', 'University B', "Université d'Exemple"]), back);
  check('Edu 8. no separate Institution field outside the records (one source of truth)', (await E(editor, `[...document.querySelectorAll('form label')].filter((l) => !l.closest('.record') && ['Institution', 'Highest degree', 'Field of study', 'Graduation year'].includes(l.textContent.trim())).length`)) === 0);
  await click(editor, '+ Add education'); // Education 4: blank
  await click(editor, '+ Add education'); // Education 5: partial
  await set(editor, 'Education 5', 'Field of study', 'Mathematics');

  // =================== 3. Work experience ===================
  for (let i = 0; i < 4; i++) await click(editor, '+ Add work experience');
  const WORK = [
    ['Work experience 1', { Company: 'Company A', 'Job title': 'Title A', Location: 'Springfield', 'Start (YYYY-MM)': '2021-06', 'I currently work here': true, Description: 'Current role.' }],
    ['Work experience 2', { Company: 'Company B', 'Job title': 'Title B', Location: 'Shelbyville', 'Start (YYYY-MM)': '2018-01', 'End (YYYY-MM)': '2021-05-31', Description: 'Previous role.' }],
    ['Work experience 3', { Company: 'Company C', 'Job title': 'Title C', 'Start (YYYY-MM)': '2016-09', 'End (YYYY-MM)': '2017-12' }],
    ['Work experience 4', { Company: 'Remove Me Co' }],
  ];
  for (const [title, values] of WORK) for (const [label, value] of Object.entries(values)) await set(editor, title, label, value);
  await set(editor, 'Work experience 1', 'End (YYYY-MM)', '2024-02');
  check('Work 4–5. current role with an end date blocks saving', (await save(editor)).startsWith('Fix') && eq(JSON.parse(await E(editor, `JSON.stringify(r.errorsIn('Work experience 1'))`)), ['Leave the end date blank for a role you currently have.']));
  await set(editor, 'Work experience 1', 'End (YYYY-MM)', '');
  for (const [bad, ok] of [['2021-13', false], ['21-06', false], ['2021/06', false], ['June 2021', false], ['2021-06', true], ['2021-06-15', true]]) {
    await set(editor, 'Work experience 3', 'End (YYYY-MM)', bad);
    const errs = await E(editor, `r.errorsIn('Work experience 3').length`);
    check(`Validation: month "${bad}" ${ok ? 'accepted' : 'rejected'}`, ok ? errs === 0 : errs === 1);
  }
  await set(editor, 'Work experience 3', 'End (YYYY-MM)', '2017-12');
  await click(editor, 'Remove Work experience 4');
  await click(editor, 'Move Work experience 3 up');
  const w = [await get(editor, 'Work experience 2', 'Company'), await get(editor, 'Work experience 2', 'End (YYYY-MM)'), await get(editor, 'Work experience 3', 'Company')];
  await click(editor, 'Move Work experience 2 down');
  check('Work 6–7. remove and reorder', eq(w, ['Company C', '2017-12', 'Company B']) && (await titles(editor, 'Work')) === JSON.stringify(['Work experience 1', 'Work experience 2', 'Work experience 3']) && (await get(editor, 'Work experience 2', 'Company')) === 'Company B');
  await click(editor, '+ Add work experience'); // 4: blank
  await click(editor, '+ Add work experience'); // 5: partial
  await set(editor, 'Work experience 5', 'Location', 'Remote');
  await click(editor, '+ Add work experience'); // 6: checkbox toggled on then off → blank
  await set(editor, 'Work experience 6', 'I currently work here', true);
  await set(editor, 'Work experience 6', 'I currently work here', false);
  await E(editor, `r.write(r.scalar('Current company'), 'Current Co'); r.write(r.scalar('Current job title'), 'Staff Engineer'); r.write(r.scalar('Years of experience'), '6'); r.write(r.scalar('First name'), 'Jane'); true`);

  // =================== 3. Certifications ===================
  for (let i = 0; i < 3; i++) await click(editor, '+ Add certification');
  await set(editor, 'Certification 1', 'Name', 'Certification A');
  await set(editor, 'Certification 1', 'Issuer', 'Issuer A');
  await set(editor, 'Certification 1', 'Issue year', 2020);
  await set(editor, 'Certification 1', 'Credential URL', 'https://cert.example.com/a');
  await set(editor, 'Certification 2', 'Name', 'Certification B');
  await set(editor, 'Certification 2', 'Issuer', 'Issuer B');
  await set(editor, 'Certification 2', 'Issue year', 2021);
  await set(editor, 'Certification 3', 'Name', 'Remove Me Cert');
  for (const [url, ok] of [['htp:/bad', false], ['not a url', false], ['javascript:alert(1)', false], ['cert.example.com/b', true], ['https://cert.example.com/b?id=7', true]]) {
    await set(editor, 'Certification 2', 'Credential URL', url);
    const errs = await E(editor, `r.errorsIn('Certification 2').length`);
    check(`Validation: URL "${url}" ${ok ? 'accepted' : 'rejected'}`, ok ? errs === 0 : errs === 1);
  }
  await click(editor, 'Remove Certification 3');
  await click(editor, 'Move Certification 2 up');
  const c = [await get(editor, 'Certification 1', 'Name'), await get(editor, 'Certification 1', 'Credential URL')];
  await click(editor, 'Move Certification 1 down');
  check('Cert 6–7. remove and reorder', eq(c, ['Certification B', 'https://cert.example.com/b?id=7']) && (await get(editor, 'Certification 1', 'Name')) === 'Certification A');
  await click(editor, '+ Add certification'); // 3: blank
  await click(editor, '+ Add certification'); // 4: partial
  await set(editor, 'Certification 4', 'Issuer', 'Issuer Z');

  check('save', (await save(editor)) === 'Profile saved', await E(editor, `JSON.stringify(r.errors())`));
  const saved = await stored(editor);
  // Phase 13: records carry stable ids; compare values without them, and check the ids.
  const stripIds = (list) => list.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'id')));
  const idsOk = (list) => list.every((x) => /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|m-[0-9a-f]{16})$/.test(x.id)) && new Set(list.map((x) => x.id)).size === list.length;
  check('Edu 9–12. blank Education 4 removed, partial kept, order and values stored', eq(stripIds(saved.education), [
    { institution: 'University A', degree: 'BSc', fieldOfStudy: 'Physics', startYear: 2010, graduationYear: 2014 },
    { institution: 'University B', degree: 'MSc', fieldOfStudy: 'Chemistry', startYear: 2014, graduationYear: 2016 },
    { institution: "Université d'Exemple", degree: 'PhD', fieldOfStudy: 'Biology', startYear: 2016, graduationYear: 2020 },
    { fieldOfStudy: 'Mathematics' },
  ]), JSON.stringify(saved.education));
  check('Phase 13: every saved record has a unique stable id', idsOk(saved.education) && idsOk(saved.workExperience) && idsOk(saved.certifications));
  const byKey = (list) => stripIds(list).map((x) => Object.fromEntries(Object.entries(x).sort()));
  check('Edu values exact', eq(byKey(saved.education), byKey([
    { institution: 'University A', degree: 'BSc', fieldOfStudy: 'Physics', startYear: 2010, graduationYear: 2014 },
    { institution: 'University B', degree: 'MSc', fieldOfStudy: 'Chemistry', startYear: 2014, graduationYear: 2016 },
    { institution: "Université d'Exemple", degree: 'PhD', fieldOfStudy: 'Biology', startYear: 2016, graduationYear: 2020 },
    { fieldOfStudy: 'Mathematics' },
  ])));
  check('Work 8–9. blank records (incl. one with the checkbox unticked again) removed; partial kept; current flag stored', eq(byKey(saved.workExperience), byKey([
    { company: 'Company A', title: 'Title A', location: 'Springfield', startDate: '2021-06', current: true, description: 'Current role.' },
    { company: 'Company B', title: 'Title B', location: 'Shelbyville', startDate: '2018-01', endDate: '2021-05-31', description: 'Previous role.' },
    { company: 'Company C', title: 'Title C', startDate: '2016-09', endDate: '2017-12' },
    { location: 'Remote' },
  ])), JSON.stringify(saved.workExperience));
  check('Cert 8. blank removed, partial kept', eq(byKey(saved.certifications), byKey([
    { name: 'Certification A', issuer: 'Issuer A', issueYear: 2020, credentialUrl: 'https://cert.example.com/a' },
    { name: 'Certification B', issuer: 'Issuer B', issueYear: 2021, credentialUrl: 'https://cert.example.com/b?id=7' },
    { issuer: 'Issuer Z' },
  ])), JSON.stringify(saved.certifications));
  check('Work 11. current employment stays independent scalar fields', eq(saved.experience, { currentCompany: 'Current Co', currentTitle: 'Staff Engineer', totalExperienceYears: 6 }) && saved.schemaVersion === 4, JSON.stringify(saved.experience));

  // =================== 4. Record limit ===================
  let clicks = 0;
  while ((await E(editor, `!r.button('+ Add certification').disabled`)) && clicks < 30) { await click(editor, '+ Add certification'); clicks++; }
  check('Limit: at most 20 certifications; "+ Add" disabled with a note', (await E(editor, `r.titles('Certification').length`)) === 20 && clicks === 17 && (await E(editor, `r.text('Certifications').includes('At most 20 entries.')`)));
  check('Limit: extra blank entries dropped on save', (await save(editor)) === 'Profile saved' && (await stored(editor)).certifications.length === 3);

  // =================== 10. Persistence (page reload and extension reload) ===================
  const snapshot = JSON.stringify(await stored(editor));
  await reloadEditor(editor);
  const shown = await E(editor, `JSON.stringify([r.titles(), r.get('Education 3', 'Institution'), r.get('Education 4', 'Field of study'), r.get('Work experience 1', 'I currently work here'), r.get('Work experience 2', 'End (YYYY-MM)'), r.get('Work experience 4', 'Location'), r.get('Certification 2', 'Credential URL'), r.get('Certification 3', 'Issuer')])`);
  check('Persistence: all records shown after page reload', shown === JSON.stringify([['Work experience 1', 'Work experience 2', 'Work experience 3', 'Work experience 4', 'Education 1 (primary)', 'Education 2', 'Education 3', 'Education 4', 'Certification 1', 'Certification 2', 'Certification 3'], "Université d'Exemple", 'Mathematics', true, '2021-05-31', 'Remote', 'https://cert.example.com/b?id=7', 'Issuer Z']), shown);
  await editor.close();
  await send('Extensions.loadUnpacked', { path: DIST });
  await sleep(1000);
  editor = await openEditor();
  check('Persistence: unchanged after reloading the extension', JSON.stringify(await stored(editor)) === snapshot && (await get(editor, 'Education 2', 'Institution')) === 'University B');
  check('Persistence: saved mappings intact', (await stored(editor, 'savedMappings')).mappings.length === 7);

  // =================== 8. Backward compatibility: old scalar mappings ===================
  let tab = await open(`${ORIGIN}/apply`);
  await waitFor(tab, `document.readyState === 'complete'`);
  let popup = await openPopupFor(id, tab);
  await analyze(popup);
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  const baseline = await tab.evaluate('document.documentElement.outerHTML');
  const names = await popup.evaluate('t.items()');
  const review = {};
  for (const n of names) review[n] = await item(popup, n);
  console.log('      review:');
  for (const n of names) console.log(`        [${review[n].checked ? 'x' : review[n].disabled ? '-' : ' '}] ${n} | ${review[n].mapping} | ${review[n].note}`);
  const OLD = [
    ['Alma mater', 'Institution (education[0].institution)'],
    ['Qualification earned', 'Highest degree (education[0].degree)'],
    ['Subject majored in', 'Field of study (education[0].fieldOfStudy)'],
    ['Year completed', 'Graduation year (education[0].graduationYear)'],
    ['Role you hold now', 'Current job title (experience.currentTitle)'],
    ['Organisation you work for', 'Current company (experience.currentCompany)'],
    ['Years worked in total', 'Years of experience (experience.totalExperienceYears)'],
  ];
  for (const [name, target] of OLD) check(`Compat: old mapping "${name}" → ${target}, taught, unticked`, review[name]?.mapping === `→ ${target} · Taught by you` && !review[name].checked && !review[name].disabled, review[name]?.mapping);

  // =================== 5. Teach Once selector ===================
  const S2 = 'Second school';
  await popup.evaluate(`t.li(${JSON.stringify(S2)}).querySelector('button.teach').click(); true`);
  await waitFor(popup, `!!t.li(${JSON.stringify(S2)}).querySelector('.teach-editor select')`);
  const selector = JSON.parse(await popup.evaluate(`JSON.stringify([...t.li(${JSON.stringify(S2)}).querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => [o.value, o.textContent])]))`));
  const groupLabels = selector.map(([g]) => g);
  check('Teach: grouped by section and by existing record only', eq(groupLabels, ['Personal information', 'Location', 'Professional', 'Employment', 'Work experience 1', 'Work experience 2', 'Work experience 3', 'Work experience 4', 'Job preferences', 'Education 1 (primary)', 'Education 2', 'Education 3', 'Education 4', 'Certification 1', 'Certification 2', 'Certification 3', 'Authorization']), groupLabels.join(' | '));
  const optionText = JSON.stringify(selector);
  check('Teach: options show labels only, never record contents', !['University A', 'University B', 'Company A', 'Company B', 'Certification A', 'Issuer A', 'Issuer Z', 'cert.example.com', 'Physics', 'Remote'].some((v) => optionText.includes(v)) && optionText.includes('"education[1].degree","Education 2 → Degree"') && optionText.includes('"workExperience[1].title","Work experience 2 → Job title"'));
  check('Teach: no duplicate Education 1 targets (primary uses the scalar keys)', !/education\[0\]\.(institution|degree|fieldOfStudy|graduationYear)/.test(optionText) && optionText.includes('"institution","Institution"'));
  await popup.evaluate(`t.li(${JSON.stringify(S2)}).querySelector('.teach-actions .secondary').click(); true`);
  await sleep(100);

  const TARGETS = [
    [S2, 'education[1].institution', 'Education 2 → Institution', 'University B', 's2'],
    ['Second school degree', 'education[1].degree', 'Education 2 → Degree', 'MSc', 's2d'],
    ['Earlier company', 'workExperience[1].company', 'Work experience 2 → Company', 'Company B', 'ec'],
    ['Earlier title', 'workExperience[1].title', 'Work experience 2 → Job title', 'Title B', 'et'],
    ['Certificate held', 'certifications[0].name', 'Certification 1 → Name', 'Certification A', 'ch'],
  ];
  const pageValues = () => tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#apply input')].map((e) => [e.id, e.value])))`);
  const empty = await pageValues();
  // Start from nothing selected, so only what is approved below is filled.
  await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]:checked')].forEach((c) => c.click()); true`);
  for (const [name, target, label] of TARGETS) {
    await teach(popup, name, target);
    const taught = await item(popup, name);
    check(`Teach ${label}: saved, taught, unticked`, taught.mapping === `→ ${label} (${target}) · Taught by you` && !taught.checked && !taught.disabled, taught.mapping);
  }
  const savedTargets = (await stored(editor, 'savedMappings')).mappings.map((m) => m.profileField);
  check('Teach: mappings stored with their record targets', TARGETS.every(([, target]) => savedTargets.includes(target)));
  check('Teach: teaching filled nothing', (await pageValues()) === empty);
  for (const [name, target, label, value, fieldId] of TARGETS) {
    await popup.evaluate(`t.toggle(${JSON.stringify(name)}); true`);
    await sleep(80);
    const summary = await fill(popup);
    const values = JSON.parse(await pageValues());
    const others = Object.entries(values).filter(([k, v]) => v !== '' && !TARGETS.slice(0, TARGETS.findIndex((x) => x[0] === name) + 1).some((x) => x[4] === k));
    check(`Teach ${label}: approve + Fill fills only "${value}"`, values[fieldId] === value && others.length === 0 && summary.startsWith('1 field filled'), `${summary} ${JSON.stringify(values)}`);
    await popup.evaluate(`t.toggle(${JSON.stringify(name)}); true`);
    await sleep(80);
  }
  // Old scalar mappings fill the primary record / current employment.
  for (const [name] of OLD) await popup.evaluate(`t.toggle(${JSON.stringify(name)}); true`);
  await sleep(80);
  await fill(popup);
  const compat = JSON.parse(await pageValues());
  check('Compat: old mappings fill Education 1 and the independent current-employment fields', compat.am === 'University A' && compat.qe === 'BSc' && compat.sm === 'Physics' && compat.yc === '2014' && compat.rh === 'Staff Engineer' && compat.ow === 'Current Co' && compat.yw === '6', JSON.stringify(compat));
  check('no submission', (await tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');

  // =================== 11. Privacy ===================
  const raw = await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id);
  const crossed = JSON.parse(raw).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => i.value));
  console.log('      values sent to the content script: ' + JSON.stringify(crossed));
  check('Privacy: exactly the approved values crossed, in order', eq(crossed, ['University B', 'MSc', 'Company B', 'Title B', 'Certification A', 'University A', 'BSc', 'Physics', 2014, 'Staff Engineer', 'Current Co', 6]), JSON.stringify(crossed));
  const page = JSON.parse(await tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce/i.test(k)) })`));
  const UNRELATED = ["Université d'Exemple", 'Chemistry', 'Company A', 'Company C', 'Title A', 'Certification B', 'Issuer A', 'Issuer Z', 'cert.example.com', 'Previous role.', 'Springfield', 'Mathematics', 'Remote'];
  const leaked = UNRELATED.filter((v) => raw.includes(v) || (page.html.includes(v) && !baseline.includes(v)));
  check('Privacy: unrelated records never reach messages, the page, storage, or globals', leaked.length === 0 && !/workExperience|certifications|"education"|schemaVersion/.test(raw) && page.local.length === 0 && page.session.length === 0 && page.globals.length === 0, leaked.join(', '));
  const popupMessages = await popup.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/map-fields', payload: { fields: [] } }).then((r) => JSON.stringify(r))`);
  check('Privacy: the popup gets record counts, not record contents', popupMessages === JSON.stringify({ ok: true, data: { mappings: [], records: { education: 4, workExperience: 4, certifications: 3 } } }), popupMessages);
  const status = await tab.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/get-profile-status' }).then((r) => JSON.stringify(r))`, world.id);
  const profileFromPage = await tab.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }).then((r) => JSON.stringify(r))`, world.id);
  check('Privacy: the content script gets a status only, and is refused the profile', /^\{"ok":true,"data":\{"hasData":true,"valueCount":\d+\}\}$/.test(status) && profileFromPage === JSON.stringify({ ok: false, error: 'forbidden' }), `${status} ${profileFromPage}`);
  await popup.close();

  // =================== 6. Position-based mapping ===================
  await reloadEditor(editor);
  await click(editor, 'Move Education 2 up');
  check('Position: Education 1 ↔ 2 swapped and saved', (await save(editor)) === 'Profile saved' && (await stored(editor)).education[1].institution === 'University A');
  await tab.send('Page.reload');
  await sleep(500);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]:checked')].forEach((c) => c.click()); t.toggle(${JSON.stringify(S2)}); t.toggle('University'); true`);
  await sleep(80);
  await fill(popup);
  const pos = JSON.parse(await pageValues());
  check('Position: "Education 2 → Institution" now resolves to University A; the primary (University) to University B', pos.s2 === 'University A' && pos.uni === 'University B', JSON.stringify(pos));
  await popup.close();

  // =================== 7. Deleted records ===================
  await reloadEditor(editor);
  for (let i = 0; i < 3; i++) await click(editor, 'Remove Education 2');
  await click(editor, 'Remove Certification 1');
  await click(editor, 'Remove Certification 1');
  await click(editor, 'Remove Certification 1');
  check('Deleted: Education 2–4 and all certifications removed and saved', (await save(editor)) === 'Profile saved' && (await stored(editor)).education.length === 1 && (await stored(editor)).certifications.length === 0);
  await tab.send('Page.reload');
  await sleep(500);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  const gone = [await item(popup, S2), await item(popup, 'Second school degree'), await item(popup, 'Certificate held')];
  check('Deleted: mappings to removed records show "No value in your profile" and are not selectable', gone.every((g) => g.note === 'No value in your profile.' && g.disabled && !g.checked && g.mapping.endsWith('Taught by you')), JSON.stringify(gone));
  await popup.evaluate(`t.li(${JSON.stringify(S2)}).querySelector('button.teach').click(); true`);
  await waitFor(popup, `!!t.li(${JSON.stringify(S2)}).querySelector('.teach-editor select')`);
  const after = await popup.evaluate(`JSON.stringify([...t.li(${JSON.stringify(S2)}).querySelectorAll('optgroup')].map((g) => g.label).filter((l) => /Education|Certification/.test(l)))`);
  check('Deleted: selector offers only the remaining records', after === JSON.stringify(['Education 1 (primary)']), after);
  await popup.close();
  const approveGone = await editor.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/fill-page', payload: { tabId: 1, approvals: [{ field: { id: 'id:s2', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, signals: { htmlId: 's2', name: 's2', label: 'Second school' } }, profileField: 'education[1].institution' }] } }).then((r) => JSON.stringify(r))`);
  check('Deleted: a forced approval is skipped, never resolved to another record', approveGone.includes('"status":"skipped"') && approveGone.includes('no value'), approveGone);

  // =================== 13 / 14. Mapping deletion and clearing ===================
  const before = JSON.stringify(await stored(editor));
  await reloadEditor(editor);
  await waitFor(editor, `document.querySelectorAll('.mapping-list li').length === 12`);
  await editor.evaluate(`[...document.querySelectorAll('.mapping-list li')].find((li) => li.innerText.includes('Work experience 2 → Company')).querySelector('button').click(); true`);
  await waitFor(editor, `document.querySelectorAll('.mapping-list li').length === 11`);
  check('Deleting a mapping never changes the profile', JSON.stringify(await stored(editor)) === before && (await stored(editor, 'savedMappings')).mappings.length === 11);
  await click(editor, 'Clear profile…');
  await sleep(100);
  await click(editor, 'Clear Profile');
  await waitFor(editor, `r.status() === 'Profile cleared'`);
  check('Clear profile removes every record but keeps saved mappings', (await stored(editor)) === null && (await stored(editor, 'savedMappings')).mappings.length === 11 && (await titles(editor, '')) === JSON.stringify(['Education 1 (primary)']));

  // =================== 9. Migration ===================
  const v2 = (extra = {}) => ({
    schemaVersion: 2,
    identity: { firstName: 'Mig' }, contact: {}, location: { city: 'Springfield' },
    education: { institution: 'Primary U', degree: 'MSc', fieldOfStudy: 'Physics', graduationYear: 2019 },
    experience: { currentCompany: 'Current Co', currentTitle: 'Lead', totalExperienceYears: 8, noticePeriod: '30 days', workHistory: [{ company: 'Hist Co', title: 'Dev', startDate: '2015-01', endDate: '2017-06', description: 'd' }, {}] },
    links: {}, preferences: { workMode: 'remote' }, authorization: {}, documents: { resumes: [], coverLetters: [] }, customAnswers: [],
    legacy: { education: [{ institution: 'Legacy One', degree: 'BSc' }, { institution: 'Legacy Two' }], workModes: ['hybrid'] },
    ...extra,
  });
  const scenarios = [
    ['v2 with legacy education and work history', v2(), (p) =>
      eq(p.education, [{ institution: 'Primary U', degree: 'MSc', fieldOfStudy: 'Physics', graduationYear: 2019 }, { institution: 'Legacy One', degree: 'BSc' }, { institution: 'Legacy Two' }]) &&
      eq(p.workExperience, [{ company: 'Hist Co', title: 'Dev', startDate: '2015-01', endDate: '2017-06', description: 'd' }]) &&
      eq(p.experience, { currentCompany: 'Current Co', currentTitle: 'Lead', totalExperienceYears: 8, noticePeriod: '30 days' }) &&
      eq(p.certifications, []) && eq(p.legacy, { workModes: ['hybrid'] }) && p.identity.firstName === 'Mig'],
    ['v2 with a blank primary: no record invented, legacy not promoted', v2({ education: { institution: '  ' } }), (p) =>
      eq(p.education, []) && eq(p.legacy.education, [{ institution: 'Legacy One', degree: 'BSc' }, { institution: 'Legacy Two' }])],
    ['v1 (Phases 1–4) via v2', {
      schemaVersion: 1, identity: { firstName: 'Old' }, contact: { email: 'old@example.com' }, location: {},
      education: [{ institution: 'First U', degree: 'MSc' }, { institution: 'Second U', degree: 'BSc' }],
      experience: { currentCompany: 'Old Co', workHistory: [{ company: 'Earlier Co' }] },
      links: {}, preferences: { workModes: ['hybrid', 'remote'], employmentTypes: ['contract'] }, authorization: {}, documents: { resumes: [], coverLetters: [] }, customAnswers: [],
    }, (p) =>
      eq(p.education, [{ institution: 'First U', degree: 'MSc' }, { institution: 'Second U', degree: 'BSc' }]) &&
      eq(p.workExperience, [{ company: 'Earlier Co' }]) && eq(p.experience, { currentCompany: 'Old Co' }) &&
      p.preferences.workMode === 'hybrid' && p.preferences.employmentType === 'contract' && eq(p.legacy, { workModes: ['remote'] }) && p.contact.email === 'old@example.com'],
  ];
  for (const [label, seed, verify] of scenarios) {
    await E(editor, writeRaw('profile', seed));
    await reloadEditor(editor);
    const loaded = JSON.parse(await E(editor, `chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }).then((r) => JSON.stringify(r.data))`));
    const values = { ...loaded, education: stripIds(loaded.education), workExperience: stripIds(loaded.workExperience), certifications: stripIds(loaded.certifications) };
    check(`Migration ${label}: migrated correctly (values unchanged, every record has a stable id)`, loaded.schemaVersion === 4 && verify(values) && idsOk(loaded.education) && idsOk(loaded.workExperience), JSON.stringify(loaded));
    check(`Migration ${label}: loading is read-only`, eq(await stored(editor), seed));
    check(`Migration ${label}: persisted as the current version (4) only after Save`, (await save(editor)) === 'Profile saved' && (await stored(editor)).schemaVersion === 4);
    const first = JSON.stringify(await stored(editor));
    await reloadEditor(editor);
    await save(editor);
    check(`Migration ${label}: idempotent (load + save again is identical)`, JSON.stringify(await stored(editor)) === first);
  }
  const shownLegacy = await (async () => { await E(editor, writeRaw('profile', v2({ education: {} }))); await reloadEditor(editor); return E(editor, `document.querySelector('.legacy')?.innerText ?? ''`); })();
  check('Migration: legacy education without a primary stays visible read-only', shownLegacy.includes('Legacy One') && shownLegacy.includes('Legacy Two'));
  for (const bad of [{ schemaVersion: 5, identity: { firstName: 'Future' } }, { schemaVersion: 99 }]) {
    await E(editor, writeRaw('profile', bad));
    await reloadEditor(editor);
    const text = await E(editor, `document.body.innerText`);
    check(`Migration: schema ${bad.schemaVersion} refused and left untouched`, !text.includes('Profile saved') && (await E(editor, `!!document.querySelector('.status-error') && document.querySelectorAll('form section').length === 0`)) && eq(await stored(editor), bad), text.slice(0, 120));
  }

  // =================== 11. Logs ===================
  const logged = consoleLog.join('\n');
  const FAKE = ['University A', 'University B', 'Company A', 'Company B', 'Certification A', 'cert.example.com', 'Current Co', 'Staff Engineer', 'Primary U', 'Legacy One', 'Hist Co', 'Jane', 'Mig', 'Old Co'];
  console.log(`      console lines captured: ${consoleLog.length}${consoleLog.length ? ' → ' + consoleLog.slice(0, 5).join(' || ') : ''}`);
  check('Privacy: no profile value in any console (page, popup, editor, service worker)', FAKE.every((v) => !logged.includes(v)));

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
