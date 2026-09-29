import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Phase 15 (Greenhouse adapter) in real Chrome. Fake data only; nothing is submitted, no sign-in,
// no uploads. The real Greenhouse check is a read-only Analyze of a public job page.
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
const FIXTURE = join(SCRATCH, 'fixtures/fw/react-greenhouse/dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL_GREENHOUSE = 'https://job-boards.greenhouse.io/anthropic/jobs/4461450008';
const GH_HOST = 'job-boards.greenhouse.io';

const PAGES = {
  '/generic/mention': `<!doctype html><title>Careers</title><body><p>We use Greenhouse (greenhouse.io) for hiring. Greenhouse Greenhouse.</p><form><label for="n">Full Name</label><input id="n" name="name"><label for="e">Email</label><input id="e" type="email"></form></body>`,
  '/generic/form': `<!doctype html><title>Contact</title><body><form id="application-form"><label for="f">First Name</label><input id="f" name="first"></form></body>`,
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (PAGES[url.pathname]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGES[url.pathname]); }
  // The fixture is served for any job path (local path or the mapped Greenhouse host).
  const asset = url.pathname.match(/\/assets\/(.+)$/);
  const file = asset ? join(FIXTURE, 'assets', asset[1]) : url.pathname.startsWith('/example/jobs/') || url.pathname === '/apply/' ? join(FIXTURE, 'index.html') : undefined;
  if (file && existsSync(file)) {
    res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'text/html; charset=utf-8' });
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;

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


const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idb = (body) => `new Promise((resolve, reject) => { const r = indexedDB.open('applyonce'); r.onerror = reject; r.onsuccess = () => { const db = r.result; ${body} }; })`;
const writeRaw = (key, value) => idb(`const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(${JSON.stringify(value)}, '${key}'); tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = reject;`);
const PROFILE = {
  schemaVersion: 4,
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '+1 555 010 0199' },
  location: { city: 'Springfield', state: 'Quebec', country: 'Canada' },
  links: { linkedin: 'https://www.linkedin.com/in/jane-doe-example', github: 'https://github.com/jane-doe-example', website: 'https://jane.example.com', portfolio: 'https://portfolio.example.com' },
  experience: { currentCompany: 'Example Co', currentTitle: 'Staff Engineer', totalExperienceYears: 6 },
  preferences: { workMode: 'hybrid', employmentType: 'full-time', openToRelocation: true },
  authorization: { workAuthorization: 'Authorized to work in Canada', requiresSponsorship: false },
  education: [{ id: A, institution: 'University A', degree: 'Degree A' }, { id: B, institution: 'University B', degree: 'Degree B' }],
  workExperience: [], certifications: [], documents: { resumes: [], coverLetters: [] }, customAnswers: [],
};
const SECRET = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|fp-[0-9a-f]{16}|m-[0-9a-f]{16}/;
const NOTE = 'Greenhouse page: ApplyOnce fills this form only. Voluntary self-identification questions are never filled.';

let id;
const review = async (popup) => JSON.parse(await popup.evaluate(`JSON.stringify([...document.querySelectorAll('.review-item')].map((li) => ({ name: li.querySelector('.field-name').textContent, meta: li.querySelector('.field-meta').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, teach: !!li.querySelector('button.teach'), assign: li.querySelector('button.assign')?.textContent ?? null })))`));
const platformNote = (popup) => popup.evaluate(`[...document.querySelectorAll('.analysis .note')].map((n) => n.textContent).find((t) => /page/.test(t)) ?? ''`);
const state = async (tab) => JSON.parse(await tab.evaluate(`document.getElementById('state').textContent`));
const byName = (items, name, n = 0) => items.filter((i) => i.name === name)[n];
async function analyzeTab(url) {
  const tab = await open(url);
  await waitFor(tab, `document.readyState === 'complete' && !!document.getElementById('application-form')`, 20000);
  await sleep(300);
  const before = await tab.evaluate(`document.getElementById('state')?.textContent ?? document.documentElement.outerHTML`);
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  const after = await tab.evaluate(`document.getElementById('state')?.textContent ?? document.documentElement.outerHTML`);
  return { tab, popup, world, unchanged: before === after };
}
async function fillSlow(popup) {
  await popup.evaluate(`t.button('Fill ').click(); true`);
  await sleep(200);
  await waitFor(popup, `!t.button('Filling') && !!document.querySelector('.fill-summary')`, 60000);
  return popup.evaluate(`document.querySelector('.fill-summary')?.textContent ?? ''`);
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
const tick = async (popup, indexes) => {
  await popup.evaluate(`(() => { const items = [...document.querySelectorAll('.review-item')]; for (const i of ${JSON.stringify(indexes)}) { const c = items[i].querySelector('input[type=checkbox]'); if (!c.checked && !c.disabled) c.click(); } return true; })()`);
  await sleep(100);
};
const untickAll = async (popup) => {
  await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]:checked')].forEach((c) => c.click()); true`);
  await sleep(100);
};
const close = async (p) => { await p.popup.close(); await p.tab.close(); };

try {
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')), [`--host-resolver-rules=MAP ${GH_HOST}:80 127.0.0.1:${PORT}`]);
  ({ id } = await send('Extensions.loadUnpacked', { path: DIST }));
  for (let i = 0; i < 30; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(id));
    if (worker) { await attach(worker.targetId); break; }
    await sleep(100);
  }
  const editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(writeRaw('profile', PROFILE));

  // =================== 1. detection ===================
  let p = await analyzeTab(`${ORIGIN}/apply/`);
  check('1. Greenhouse application form on a non-Greenhouse URL → Greenhouse (DOM evidence)', (await platformNote(p.popup)) === NOTE, await platformNote(p.popup));
  check('3. Analyze leaves the page unchanged', p.unchanged);
  let items = await review(p.popup);
  console.log('      review:');
  for (const r of items) console.log(`        [${r.checked ? 'x' : r.disabled ? '-' : ' '}] ${r.name} | ${r.mapping} | ${r.note}${r.teach ? ' | teach' : ''}${r.assign ? ' | assign' : ''}`);
  const names = items.map((i) => i.name);
  check('2/4. one field per question; no EEO / demographic, file, navigation, or helper inputs', !names.some((n) => /Gender|Hispanic|Veteran|Resume|Attach|Next|Submit/.test(n)) && names.filter((n) => n === 'Country').length === 1 && names.length === 23, `${names.length}: ${names.join(' | ')}`);
  const expectMap = {
    'First Name': '→ First name (identity.firstName) · Automatic · High confidence',
    Email: '→ Email (contact.email) · Automatic · High confidence',
    Country: '→ Country (location.country) · Automatic · High confidence',
    'LinkedIn Profile': '→ LinkedIn (links.linkedin) · Automatic · High confidence',
    'Current Company': '→ Current company (experience.currentCompany) · Automatic · High confidence',
    'Employment Type': '→ Employment type (preferences.employmentType) · Automatic · High confidence',
    'Work Mode': '→ Work mode (preferences.workMode) · Automatic · High confidence',
    'Willing to relocate': '→ Willing to relocate (preferences.openToRelocation) · Automatic · High confidence',
  };
  check('4. deterministic mappings through the existing mapper (text, react-select, native select, checkbox)', Object.entries(expectMap).every(([n, m]) => byName(items, n)?.mapping === m), JSON.stringify(Object.keys(expectMap).map((n) => byName(items, n)?.mapping)));
  check('4. the location lookup is not fillable; custom questions are "No match"', byName(items, 'Location (City)')?.disabled && byName(items, 'Why do you want to work at Example Co?')?.mapping === 'No match' && byName(items, 'What name should we use?')?.teach);
  check('9. repeated "Degree" questions: repeated, Assign record, no Teach', [0, 1].every((n) => byName(items, 'Degree', n)?.mapping === 'Repeated question · no record context' && byName(items, 'Degree', n)?.assign === 'Assign record' && !byName(items, 'Degree', n)?.teach));
  const recorded = () => p.tab.evaluate(`JSON.stringify(globalThis.__recorded)`, p.world.id);

  // =================== 5–8. explicit approval and fill (default selection) ===================
  let summary = await fillSlow(p.popup);
  let s = await state(p.tab);
  console.log(`      after Fill: ${summary} ${JSON.stringify(s)}`);
  check('7. text questions filled', s.first_name === 'Jane' && s.last_name === 'Doe' && s.email === 'jane.doe@example.com' && s.q_linkedin === 'https://www.linkedin.com/in/jane-doe-example' && s.q_github === 'https://github.com/jane-doe-example' && s.q_website === 'https://jane.example.com' && s.q_company === 'Example Co' && s.q_title === 'Staff Engineer' && s.q_years === '6');
  check('7/12. react-select questions filled through the generic engine and confirmed (real react-select)', s.country === 'Canada' && s.q_employment === 'Full-time' && s.q_auth === 'Authorized to work in Canada');
  check('7. native select and checkbox filled', s.q_workmode === 'hybrid' && s.q_relocate === true);
  check('8. existing values kept: text ("Kept City") and react-select selection ("Ontario", profile says Quebec)', s.q_city === 'Kept City' && s.q_state === 'Ontario' && byName(await review(p.popup), 'State')?.note === 'Skipped. The field already has a value.');
  check('EEO / demographic selects never touched', s.gender === null && s.hispanic === null && s.veteran === null && s.demo_gender === null);
  check('15. no navigation, no submission', (await p.tab.evaluate(`document.getElementById('nav').textContent`)) === '0' && (await p.tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  let shot = await p.popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase15-greenhouse.png'), Buffer.from(shot.data, 'base64'));

  // Radio group (review-level) after explicit approval
  items = await review(p.popup);
  const sponsor = items.findIndex((i) => i.name === 'Will you require visa sponsorship?');
  console.log(`      sponsorship: ${items[sponsor]?.mapping} | ${items[sponsor]?.note}`);
  if (items[sponsor] && !items[sponsor].disabled) {
    await untickAll(p.popup);
    await tick(p.popup, [sponsor]);
    await fillSlow(p.popup);
    check('radio group: approved sponsorship answer selected ("No")', (await state(p.tab)).q_sponsor === 'No');
  } else {
    check('radio group: sponsorship question detected as one field', !!items[sponsor], items[sponsor]?.mapping);
  }

  // =================== 10. record assignment on repeated questions ===================
  items = await review(p.popup);
  const d1 = items.findIndex((i) => i.name === 'Degree');
  await assignVia(p.popup, d1, `education@${A}.degree`);
  await assignVia(p.popup, d1 + 1, `education@${B}.degree`);
  items = await review(p.popup);
  check('10. assigned: "Education n → Degree · Assigned by you", unticked', items[d1].mapping === '→ Education 1 → Degree · Assigned by you' && items[d1 + 1].mapping === '→ Education 2 → Degree · Assigned by you' && !items[d1].checked && !items[d1 + 1].checked);
  await untickAll(p.popup);
  await tick(p.popup, [d1, d1 + 1]);
  await fillSlow(p.popup);
  s = await state(p.tab);
  check('10. approve + Fill: each Degree from its assigned record', s.q_degree1 === 'Degree A' && s.q_degree2 === 'Degree B', JSON.stringify([s.q_degree1, s.q_degree2]));

  // =================== 13. Teach Once ===================
  await teach(p.popup, 'What name should we use?', 'first_name');
  items = await review(p.popup);
  const named = items.findIndex((i) => i.name === 'What name should we use?');
  check('13. Teach: saved, "Taught by you", unticked, nothing filled', items[named].mapping.endsWith('Taught by you') && !items[named].checked && (await state(p.tab)).q_name === '');
  await untickAll(p.popup);
  await tick(p.popup, [named]);
  await fillSlow(p.popup);
  check('13. approve + Fill fills the taught question', (await state(p.tab)).q_name === 'Jane');

  // =================== 11. dynamic fields and re-render ===================
  await p.tab.evaluate(`document.getElementById('add-link').click(); true`);
  await analyze(p.popup);
  items = await review(p.popup);
  const portfolio = items.findIndex((i) => i.name === 'Portfolio');
  check('11. a question added after Analyze is found by Analyze again', portfolio >= 0 && items[portfolio].mapping.startsWith('→ Portfolio'));
  await untickAll(p.popup);
  await tick(p.popup, [portfolio]);
  await p.tab.evaluate(`document.getElementById('rerender').click(); true`); // new DOM nodes
  await sleep(300);
  summary = await fillSlow(p.popup);
  check('11. after a re-render with new nodes, Fill rediscovers the question', (await state(p.tab)).q_portfolio === 'https://portfolio.example.com', summary);

  // =================== 14. privacy ===================
  const raw = await recorded();
  const values = JSON.parse(raw).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => i.value));
  console.log('      values sent: ' + JSON.stringify(values));
  const allowed = new Set(['Jane', 'Doe', 'jane.doe@example.com', '+1 555 010 0199', 'Canada', 'https://www.linkedin.com/in/jane-doe-example', 'https://github.com/jane-doe-example', 'https://jane.example.com', 'Example Co', 'Staff Engineer', 6, 'full-time', 'Authorized to work in Canada', 'hybrid', true, false, 'Springfield', 'Quebec', 'Degree A', 'Degree B', 'https://portfolio.example.com']);
  // Since Phase 16 no fingerprint reaches the content script: the service worker checks field
  // identities against a fresh scan before sending anything.
  const fingerprints = [...new Set(raw.match(/fp-[0-9a-f]{16}/g) ?? [])];
  const RECORD_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|m-[0-9a-f]{16}/;
  check('14. only approved values reached the page: no record ids, profile, mappings, or assignments', values.every((v) => allowed.has(v)) && !RECORD_ID.test(raw) && !/schemaVersion|"education":|workExperience|recordAssignments|savedMappings|education@/.test(raw), JSON.stringify(values.filter((v) => !allowed.has(v))));
  const assignedInstructions = JSON.parse(raw).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions).filter((i) => i.expected.repeatedCount);
  check('14. no field fingerprints reach the page (Phase 16); assigned fields carry only their repeat count', fingerprints.length === 0 && assignedInstructions.length === 2 && assignedInstructions.every((i) => i.expected.repeatedCount === 2 && ['id:question_116', 'id:question_117'].includes(i.fieldId)), JSON.stringify(assignedInstructions.map((i) => i.fieldId)));
  const pageState = JSON.parse(await p.tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce|profile|assign/i.test(k)) })`));
  const unapproved = ['University A', 'University B', 'Springfield', 'Quebec', 'https://www.linkedin.com/in/jane-doe-example-other'];
  const leakedToDom = unapproved.filter((v) => pageState.html.includes(v));
  check('14. nothing unapproved written into the page DOM; no ids or fingerprints; no storage or globals', leakedToDom.length === 0 && !SECRET.test(pageState.html) && pageState.local.length + pageState.session.length + pageState.globals.length === 0, leakedToDom.join(', '));
  check('15. still no navigation or submission', (await p.tab.evaluate(`document.getElementById('nav').textContent`)) === '0' && (await p.tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  await close(p);

  // =================== detection: host and generic ===================
  const hostTab = await open(`http://${GH_HOST}/example/jobs/1234567`);
  const reached = await waitFor(hostTab, `location.hostname === '${GH_HOST}' && !!document.getElementById('application-form')`, 15000);
  if (reached) {
    const popup = await openPopupFor(id, hostTab);
    await analyze(popup);
    check('1. Greenhouse job-board host → Greenhouse', (await platformNote(popup)) === NOTE);
    await popup.close();
  } else {
    console.log('      host check: could not load a page on the Greenhouse host locally: ' + (await hostTab.evaluate('location.href').catch(() => '?')));
  }
  await hostTab.close();
  for (const [path, label] of [['/generic/mention', 'a page mentioning "Greenhouse"'], ['/generic/form', 'a generic form with id "application-form"']]) {
    const tab = await open(`${ORIGIN}${path}`);
    await waitFor(tab, `document.readyState === 'complete'`);
    const popup = await openPopupFor(id, tab);
    await analyze(popup);
    const note = await platformNote(popup);
    check(`1. ${label} stays generic`, note === '' && (await review(popup)).length > 0, note);
    await popup.close();
    await tab.close();
  }

  // =================== real Greenhouse (read-only) ===================
  const real = await open(REAL_GREENHOUSE);
  const loaded = await waitFor(real, `!!document.querySelector('form#application-form .application--questions')`, 60000);
  if (!loaded) {
    console.log('      real Greenhouse page did not load in time; not verified');
  } else {
    await sleep(3000); // let the live page finish hydrating before taking the baseline
    const snapshot = () => real.evaluate(`JSON.stringify([...document.querySelectorAll('#application-form input, #application-form textarea')].map((e) => [e.id, e.value]))`);
    const before = await snapshot();
    const popup = await openPopupFor(id, real);
    await analyze(popup);
    const realItems = await review(popup);
    console.log('      real Greenhouse fields: ' + realItems.map((r) => `${r.name} → ${r.mapping}`).join(' | '));
    check('REAL Greenhouse (read-only Analyze): detected as Greenhouse', (await platformNote(popup)) === NOTE);
    check('REAL Greenhouse: standard questions mapped; EEO, resume, and helpers not listed', ['First Name', 'Last Name', 'Email', 'Phone'].every((n) => byName(realItems, n)?.mapping.startsWith('→ ')) && !realItems.some((r) => /Gender|Hispanic|Veteran|Resume|Attach/.test(r.name)));
    const after = await snapshot();
    if (after !== before) console.log(`      real page values before: ${before}\n      after: ${after}`);
    check('REAL Greenhouse: Analyze changed nothing (no fill, no submit)', after === before);
    shot = await popup.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SCRATCH, 'phase15-real-greenhouse.png'), Buffer.from(shot.data, 'base64'));
    await popup.close();
  }
  await real.close();

  const logged = consoleLog.join('\n');
  console.log(`      console lines captured: ${consoleLog.length}${consoleLog.length ? ' → ' + consoleLog.slice(0, 4).join(' || ').slice(0, 400) : ''}`);
  check('14. no profile values, ids, or fingerprints in any console', !SECRET.test(logged) && !['Jane', 'jane.doe', 'Degree A', 'Example Co', 'Staff Engineer', 'Springfield'].some((x) => logged.includes(x)));
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
