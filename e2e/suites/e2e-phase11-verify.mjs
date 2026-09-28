// Phase 11 final verification in real Chrome. Fake data only; nothing is submitted.
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

const input = (id, label, type = 'text') =>
  type === 'checkbox' ? `<p><label><input type="checkbox" id="${id}" name="${id}"> ${label}</label></p>`
  : type === 'textarea' ? `<p><label for="${id}">${label}</label><textarea id="${id}" name="${id}"></textarea></p>`
  : `<p><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}"></p>`;
const eduFields = (n) => `${input(`inst${n}`, 'Institution')}${input(`deg${n}`, 'Degree')}${input(`fos${n}`, 'Field of Study')}${input(`grad${n}`, 'Graduation Year', 'number')}${input(`gpa${n}`, 'GPA')}${input(`hon${n}`, 'Honors')}${input(`awd${n}`, 'Awards')}`;
const workFields = (n) => `${input(`co${n}`, 'Company')}${input(`ti${n}`, 'Job Title')}${input(`lo${n}`, 'Location')}${input(`sd${n}`, 'Start Date')}${input(`ed${n}`, 'End Date')}${input(`cur${n}`, 'I currently work here', 'checkbox')}${input(`de${n}`, 'Description', 'textarea')}${input(`mgr${n}`, 'Manager')}${input(`rfl${n}`, 'Reason for leaving')}${input(`mon${n}`, 'Start month', 'month')}${input(`dat${n}`, 'End date picker', 'date')}`;
const certFields = (n) => `${input(`cn${n}`, 'Name')}${input(`ci${n}`, 'Issuer')}${input(`cy${n}`, 'Issue Year', 'number')}${input(`cu${n}`, 'Credential URL')}${input(`cs${n}`, 'Certification score')}`;
const div = (heading, body, cls = '') => `<div class="${cls}"><h3>${heading}</h3>${body}</div>`;
const shell = (title, body) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>
<form id="apply">${body}<button type="submit">Submit application</button></form>
<p id="submitted">false</p><p id="adds">0</p>
<script>
  document.getElementById('apply').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
  const block = (n) => '<div class="edu"><h3>Education ' + n + '</h3>' + ${JSON.stringify(input('instN', 'Institution'))}.replaceAll('instN', 'inst' + n + 'x') + '</div>';
  document.querySelector('[data-add-end]')?.addEventListener('click', () => {
    document.getElementById('adds').textContent = String(Number(document.getElementById('adds').textContent) + 1);
    document.querySelector('[data-add-end]').insertAdjacentHTML('beforebegin', block(document.querySelectorAll('.edu').length + 1));
  });
  document.querySelector('[data-add-top]')?.addEventListener('click', () => {
    document.getElementById('adds').textContent = String(Number(document.getElementById('adds').textContent) + 1);
    document.querySelector('.edu').insertAdjacentHTML('beforebegin', block(0));
    document.querySelectorAll('.edu h3').forEach((h, i) => { h.textContent = 'Education ' + (i + 1); });
  });
</script></body></html>`;

const eduOnly = (n) => `${input(`inst${n}`, 'Institution')}${input(`deg${n}`, 'Degree')}`;
const PAGES = {
  '/all': shell('All sections', `${input('fn', 'First Name')}${input('cc', 'Current Company')}${input('ct', 'Current Job Title')}
    <section><h2>Education</h2>${[1, 2, 3].map((n) => div(`Education ${n}`, eduFields(n))).join('')}</section>
    <section><h2>Work history</h2>${[1, 2].map((n) => `<fieldset><legend>Work Experience ${n}</legend>${workFields(n)}</fieldset>`).join('')}</section>
    ${[1, 2].map((n) => `<div role="group" aria-label="Certification ${n}">${certFields(n)}</div>`).join('')}
    ${input('am', 'Alma mater')}`),
  '/edu2': shell('Two blocks', [1, 2].map((n) => div(`Education ${n}`, eduOnly(n))).join('')),
  '/edu2add': shell('Add at end', `${[1, 2].map((n) => div(`Education ${n}`, input(`inst${n}`, 'Institution'), 'edu')).join('')}<button type="button" data-add-end>Add Education</button>`),
  '/edutop': shell('Add at top', `${[1, 2].map((n) => div(`Education ${n}`, input(`inst${n}`, 'Institution'), 'edu')).join('')}<button type="button" data-add-top>Add Education at top</button>`),
  // Conservative detection
  '/c-baseline': shell('Baseline', `${eduOnly('a')}${eduOnly('b')}`),
  '/c-labels': shell('Repeated labels in one section', `<section><h2>Education</h2>${eduOnly('a')}${eduOnly('b')}</section>`),
  '/c-prefs': shell('Education preferences', `${div('Education preferences', eduOnly('a'))}${div('Education preferences', eduOnly('b'))}`),
  '/c-related': shell('Related headings', `${div('Education level', eduOnly('a'))}${div('Education requirements', eduOnly('b'))}`),
  '/c-similar': shell('Similar words', `${div('Experience with our products', input('xa', 'Company'))}${div('Experience with our products', input('xb', 'Company'))}${div('Certification requirements', input('ya', 'Name'))}${div('Certification requirements', input('yb', 'Name'))}`),
  '/c-order': shell('Out of order', `${div('Education 2', eduOnly('a'))}${div('Education 1', eduOnly('b'))}`),
  '/c-dup': shell('Duplicate numbers', `${div('Education 1', eduOnly('a'))}${div('Education 1', eduOnly('b'))}`),
  '/c-gap': shell('Gap', `${div('Education 1', eduOnly('a'))}${div('Education 3', eduOnly('b'))}`),
  '/c-mixed': shell('Mixed', `${div('Education 1', eduOnly('a'))}${div('Education', eduOnly('b'))}`),
  // Single-block regression: identical fields with and without a single record heading
  '/s-edu': shell('Single education', div('Education 1', `${input('i', 'Institution')}${input('d', 'Degree')}${input('f', 'Field of Study')}${input('g', 'Graduation Year', 'number')}`)),
  '/s-edu-plain': shell('Single education (plain)', `${input('i', 'Institution')}${input('d', 'Degree')}${input('f', 'Field of Study')}${input('g', 'Graduation Year', 'number')}`),
  '/s-work': shell('Single work', `<fieldset><legend>Work Experience 1</legend>${input('c', 'Company')}${input('t', 'Job Title')}</fieldset>`),
  '/s-work-plain': shell('Single work (plain)', `<fieldset><legend>Your job</legend>${input('c', 'Company')}${input('t', 'Job Title')}</fieldset>`),
  '/s-cert': shell('Single certification', `<div role="group" aria-label="Certification 1">${input('n', 'Certification')}${input('s', 'Issuer')}</div>`),
  '/s-cert-plain': shell('Single certification (plain)', `<div role="group" aria-label="Qualifications">${input('n', 'Certification')}${input('s', 'Issuer')}</div>`),
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
const E = {
  A: { institution: 'University A', degree: 'Degree A', fieldOfStudy: 'Field A', graduationYear: 2014 },
  B: { institution: 'University B', degree: 'Degree B', fieldOfStudy: 'Field B', graduationYear: 2016 },
  C: { institution: 'University C', degree: 'Degree C', fieldOfStudy: 'Field C', graduationYear: 2020 },
};
const profile = (overrides = {}) => ({
  schemaVersion: 3,
  identity: { firstName: 'Jane' }, contact: {}, location: {},
  education: [E.A, E.B, E.C],
  experience: { currentCompany: 'Current Co', currentTitle: 'Current Title' },
  workExperience: [
    { company: 'Company A', title: 'Title A', location: 'Springfield', startDate: '2021-06', current: true, description: 'Role A.' },
    { company: 'Company B', title: 'Title B', location: 'Shelbyville', startDate: '2018-01', endDate: '2021-05', description: 'Role B.' },
  ],
  certifications: [
    { name: 'Certification A', issuer: 'Issuer A', issueYear: 2020, credentialUrl: 'https://cert.example.com/a' },
    { name: 'Certification B', issuer: 'Issuer B', issueYear: 2022, credentialUrl: 'https://cert.example.com/b' },
  ],
  links: {}, preferences: {}, authorization: {}, documents: { resumes: [], coverLetters: [] }, customAnswers: [],
  ...overrides,
});
// A generic saved mapping for the question "Institution" (scalar → primary record), plus Alma mater.
const MAPPINGS = { version: 1, mappings: [
  { key: 'v1|text|q=institution|c=|i=', parts: { fieldType: 'text', question: 'institution' }, profileField: 'institution', createdAt: now, updatedAt: now },
  { key: 'v1|text|q=alma mater|c=|i=', parts: { fieldType: 'text', question: 'alma mater' }, profileField: 'institution', createdAt: now, updatedAt: now },
] };

let id;
let editor;
const seed = (value) => editor.evaluate(writeRaw('profile', value));
const values = async (tab) => JSON.parse(await tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#apply input, #apply textarea')].map((e) => [e.id, e.type === 'checkbox' ? e.checked : e.value])))`));
const readReview = async (popup) => JSON.parse(await popup.evaluate(`JSON.stringify([...document.querySelectorAll('.review-item')].map((li) => ({ name: li.querySelector('.field-name').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, teach: !!li.querySelector('button.teach') })))`));
async function analyzePage(path) {
  const tab = await open(`${ORIGIN}${path}`);
  await waitFor(tab, `document.readyState === 'complete'`);
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  return { tab, popup, world, review: await readReview(popup) };
}
async function reanalyze(p) {
  await analyze(p.popup);
  p.review = await readReview(p.popup);
}
/** Clicks Fill only when something is selected (the button is disabled otherwise). */
const fillIfAny = async (popup) => ((await popup.evaluate(`!t.button('Fill ').disabled`)) ? fill(popup) : 'nothing selected');
const close = async (p) => { await p.popup.close(); await p.tab.close(); };
const nth = (review) => (name, n = 0) => review.filter((r) => r.name === name)[n];
const select = async (popup, indexes) => {
  await popup.evaluate(`(() => { const items = [...document.querySelectorAll('.review-item')]; for (const i of ${JSON.stringify(indexes)}) { const c = items[i].querySelector('input[type=checkbox]'); if (!c.checked && !c.disabled) c.click(); } return true; })()`);
  await sleep(100);
};
const selectAll = async (popup) => {
  const count = await popup.evaluate(`document.querySelectorAll('.review-item').length`);
  await select(popup, [...Array(count).keys()]);
};
const indexOf = (review, name, n = 0) => review.map((r, i) => [r, i]).filter(([r]) => r.name === name)[n][1];
const crossed = async (p) => JSON.parse(await p.tab.evaluate(`JSON.stringify(globalThis.__recorded)`, p.world.id)).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The target path is the last parenthesised part ("Start (YYYY-MM) (workExperience[0].startDate)").
const targetOf = (r) => [...r.mapping.matchAll(/\(([^()]+)\)/g)].at(-1)?.[1];
const REPEATED_NOTE = "Asked more than once, and ApplyOnce can't tell which profile record each one is for. Will not be filled.";

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
  await editor.evaluate(writeRaw('savedMappings', MAPPINGS));
  await seed(profile());

  // =================== 1, 3–7, 14–15: the full page ===================
  let p = await analyzePage('/all');
  let at = nth(p.review);
  console.log('      /all review:');
  for (const r of p.review) console.log(`        [${r.checked ? 'x' : r.disabled ? '-' : ' '}] ${r.name} | ${r.mapping} | ${r.note}${r.teach ? ' | teach' : ''}`);
  const EDU_FIELDS = { Institution: 'institution', Degree: 'degree', 'Field of Study': 'fieldOfStudy', 'Graduation Year': 'graduationYear' };
  const PRIMARY = { institution: 'institution', degree: 'highest_degree', fieldOfStudy: 'field_of_study', graduationYear: 'graduation_year' };
  const eduOk = [0, 1, 2].every((i) => Object.entries(EDU_FIELDS).every(([label, f]) => targetOf(at(label, i)) === `education[${i}].${f}`));
  check('1/3. Education 1–3 detected in page order; each field targets its own block', eduOk, p.review.filter((r) => EDU_FIELDS[r.name]).map(targetOf).join(', '));
  const WORK = { Company: 'company', 'Job Title': 'title', Location: 'location', 'Start Date': 'startDate', 'End Date': 'endDate', 'I currently work here': 'current', Description: 'description' };
  check('1/4. Work Experience 1–2 detected; every field targets workExperience[n], never current employment', [0, 1].every((i) => Object.entries(WORK).every(([label, f]) => targetOf(at(label, i)) === `workExperience[${i}].${f}`)));
  const CERT = { Name: 'name', Issuer: 'issuer', 'Issue Year': 'issueYear', 'Credential URL': 'credentialUrl' };
  check('1/5. Certification 1–2 detected; every field targets certifications[n]', [0, 1].every((i) => Object.entries(CERT).every(([label, f]) => targetOf(at(label, i)) === `certifications[${i}].${f}`)));
  check('1. fields outside the blocks are unaffected', targetOf(at('First Name')) === 'identity.firstName' && targetOf(at('Current Company')) === 'experience.currentCompany' && targetOf(at('Current Job Title')) === 'experience.currentTitle' && at('Alma mater').mapping === '→ Institution (education[0].institution) · Taught by you');
  check('6. Education 1 keeps primary automatic behavior (high, selected)', Object.keys(EDU_FIELDS).every((l) => at(l, 0).checked && at(l, 0).mapping.includes('Automatic · High confidence')));
  const historical = p.review.filter((r) => /education\[[12]\]|workExperience\[|certifications\[/.test(targetOf(r) ?? ''));
  check('6. Education 2+, work, and certification blocks are unticked (review, or no value)', historical.length === 8 + 14 + 8 && historical.every((r) => !r.checked && (r.note === 'Needs review. Select to fill.' || (r.disabled && r.note === 'No value in your profile.'))));
  check('7. the generic saved "Institution" mapping is not used inside blocks', [0, 1, 2].every((i) => !at('Institution', i).mapping.includes('Taught by you')) && [0, 1, 2].every((i) => !at('Institution', i).teach));
  const UNKNOWN = ['GPA', 'Honors', 'Awards', 'Manager', 'Reason for leaving', 'Certification score'];
  check('14. unknown questions inside blocks stay unsupported (no target)', p.review.filter((r) => UNKNOWN.includes(r.name)).length === 3 * 3 + 2 * 2 + 2 && p.review.filter((r) => UNKNOWN.includes(r.name)).every((r) => r.disabled && !r.checked && r.note === REPEATED_NOTE && r.mapping.startsWith('No match')));
  check('15. month and date pickers are not scanned', !p.review.some((r) => /Start month|End date picker/.test(r.name)));

  // 6. mapping exists → unticked → Fill → nothing from other records
  let summary = await fill(p.popup);
  let v = await values(p.tab);
  check('6. default Fill: Education 1 and outside fields only', eq([v.inst1, v.deg1, v.fos1, v.grad1, v.fn, v.cc, v.ct], ['University A', 'Degree A', 'Field A', '2014', 'Jane', 'Current Co', 'Current Title']) && ['inst2', 'deg2', 'inst3', 'co1', 'co2', 'ti1', 'cn1', 'cn2', 'am'].every((k) => v[k] === '') && v.cur1 === false, `${summary} ${JSON.stringify(v)}`);
  // user approves exactly one: Education 2 → Institution
  await select(p.popup, [indexOf(p.review, 'Institution', 1)]);
  summary = await fill(p.popup);
  v = await values(p.tab);
  check('6. approving one field fills exactly that field from its record', v.inst2 === 'University B' && v.deg2 === '' && v.inst3 === '' && v.co1 === '', `${summary} ${JSON.stringify(v)}`);
  await selectAll(p.popup);
  summary = await fill(p.popup);
  v = await values(p.tab);
  check('3. each education field got its own record (no cross-record filling)', eq([1, 2, 3].map((n) => [v[`inst${n}`], v[`deg${n}`], v[`fos${n}`], v[`grad${n}`]]), [['University A', 'Degree A', 'Field A', '2014'], ['University B', 'Degree B', 'Field B', '2016'], ['University C', 'Degree C', 'Field C', '2020']]), JSON.stringify(v));
  check('4. work fields: company, title, location, dates, current, description', eq([1, 2].map((n) => [v[`co${n}`], v[`ti${n}`], v[`lo${n}`], v[`sd${n}`], v[`ed${n}`], v[`cur${n}`], v[`de${n}`]]), [['Company A', 'Title A', 'Springfield', '2021-06', '', true, 'Role A.'], ['Company B', 'Title B', 'Shelbyville', '2018-01', '2021-05', false, 'Role B.']]), JSON.stringify(v));
  check('4. repeated work blocks never received current employment values', ![1, 2].some((n) => v[`co${n}`] === 'Current Co' || v[`ti${n}`] === 'Current Title'));
  check('5. certification fields: name, issuer, year, URL', eq([1, 2].map((n) => [v[`cn${n}`], v[`ci${n}`], v[`cy${n}`], v[`cu${n}`]]), [['Certification A', 'Issuer A', '2020', 'https://cert.example.com/a'], ['Certification B', 'Issuer B', '2022', 'https://cert.example.com/b']]));
  check('15. YYYY-MM values written exactly; pickers untouched', v.sd1 === '2021-06' && v.ed2 === '2021-05' && [1, 2].every((n) => v[`mon${n}`] === '' && v[`dat${n}`] === ''));
  check('14. unknown fields untouched after approving everything', [1, 2, 3].every((n) => v[`gpa${n}`] === '' && v[`hon${n}`] === '' && v[`awd${n}`] === '') && [1, 2].every((n) => v[`mgr${n}`] === '' && v[`rfl${n}`] === '' && v[`cs${n}`] === ''));
  // 16. privacy on the message level
  const instructions = await crossed(p);
  const pairs = instructions.map((i) => [i.fieldId, i.value, i.expected.record ? `${i.expected.record.collection}[${i.expected.record.index}]` : '-']);
  const recordOf = { inst: 'education', deg: 'education', fos: 'education', grad: 'education', co: 'workExperience', ti: 'workExperience', lo: 'workExperience', sd: 'workExperience', ed: 'workExperience', cur: 'workExperience', de: 'workExperience', cn: 'certifications', ci: 'certifications', cy: 'certifications', cu: 'certifications' };
  const wellTied = pairs.every(([fid, , rec]) => { const m = /^id:([a-z]+)(\d)$/.exec(fid); return m ? rec === `${recordOf[m[1]]}[${Number(m[2]) - 1}]` : rec === '-'; });
  // Each Fill re-sends the fields still ticked, so a field may appear in several fills; it must
  // always carry the same value and record.
  const perField = new Map();
  const consistent = pairs.every(([f, value, rec]) => { const seen = perField.get(f); perField.set(f, `${value}|${rec}`); return !seen || seen === `${value}|${rec}`; });
  check('16. every value crossed is tied to its own block, consistently across fills', wellTied && consistent, JSON.stringify([...perField]));
  const raw = await p.tab.evaluate(`JSON.stringify(globalThis.__recorded)`, p.world.id);
  check('16. messages to the page carry no profile, record lists, or schema', !/schemaVersion|"(education|workExperience|certifications)":\[|legacy/.test(raw));
  const pageState = JSON.parse(await p.tab.evaluate(`JSON.stringify({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce|profile/i.test(k)) })`));
  check('16. no page storage or globals', pageState.local.length + pageState.session.length + pageState.globals.length === 0);
  const counts = await p.popup.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/map-fields', payload: { fields: [] } }).then((r) => JSON.stringify(r))`);
  check('16. popup receives record counts only', counts === JSON.stringify({ ok: true, data: { mappings: [], records: { education: 3, workExperience: 2, certifications: 2 } } }), counts);
  const fromPage = await p.tab.evaluate(`Promise.all([chrome.runtime.sendMessage({ type: 'applyonce/get-profile' }), chrome.runtime.sendMessage({ type: 'applyonce/map-fields', payload: { fields: [] } })]).then((r) => JSON.stringify(r))`, p.world.id);
  check('16. the page (content script) cannot get the profile or record counts', fromPage === JSON.stringify([{ ok: false, error: 'forbidden' }, { ok: false, error: 'forbidden' }]), fromPage);
  check('16. no submission', (await p.tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  await close(p);

  // =================== 2. conservative detection ===================
  p = await analyzePage('/c-baseline');
  const baseline = p.review.map((r) => [r.name, r.mapping, r.checked]);
  await close(p);
  for (const [path, label] of [['/c-labels', 'repeated labels inside one section'], ['/c-prefs', '"Education preferences" ×2'], ['/c-related', '"Education level" / "Education requirements"']]) {
    p = await analyzePage(path);
    check(`2. ${label}: not a repeated section (maps exactly like the same fields without headings)`, eq(p.review.map((r) => [r.name, r.mapping, r.checked]), baseline), p.review.map((r) => r.mapping).join(' | '));
    await close(p);
  }
  p = await analyzePage('/c-similar');
  check('2. unrelated sections with similar words: no record targets', p.review.every((r) => !/workExperience\[|certifications\[/.test(r.mapping)), p.review.map((r) => r.mapping).join(' | '));
  await close(p);
  for (const [path, label] of [['/c-order', 'out-of-order numbering'], ['/c-dup', 'duplicated numbering'], ['/c-gap', 'a gap (1, 3)'], ['/c-mixed', 'mixed numbered/unnumbered']]) {
    p = await analyzePage(path);
    await selectAll(p.popup);
    const filled = await p.popup.evaluate(`!!document.querySelector('button.primary') && !document.querySelector('button.primary').disabled`);
    if (filled) await fill(p.popup);
    const pv = await values(p.tab);
    check(`2. ${label}: every field unsupported and left untouched`, p.review.every((r) => r.disabled && r.note === REPEATED_NOTE) && Object.values(pv).every((x) => x === ''), JSON.stringify(pv));
    await close(p);
  }

  // =================== 13. single-block regression ===================
  for (const [single, plain, label] of [['/s-edu', '/s-edu-plain', 'Education 1'], ['/s-work', '/s-work-plain', 'Work Experience 1'], ['/s-cert', '/s-cert-plain', 'Certification 1']]) {
    // One extension popup at a time: analyze and fill each page in turn.
    const a = await analyzePage(single);
    await fillIfAny(a.popup);
    const va = await values(a.tab);
    await a.popup.close();
    const b = await analyzePage(plain);
    await fillIfAny(b.popup);
    const vb = await values(b.tab);
    const same = eq(a.review.map((r) => [r.name, r.mapping, r.checked, r.disabled, r.teach]), b.review.map((r) => [r.name, r.mapping, r.checked, r.disabled, r.teach]));
    check(`13. a single ${label} block behaves exactly like Phase 10 (mapping, selection, Teach, fill)`, same && eq(Object.values(va), Object.values(vb)) && a.review.every((r) => !/\[[1-9]|workExperience\[|certifications\[/.test(r.mapping)), `${a.review.map((r) => r.mapping).join(' | ')} → ${JSON.stringify(va)}`);
    if (label === 'Education 1') check('13. single Education 1: primary mapping, auto-selected, saved scalar mapping applies', nth(a.review)('Institution').mapping === '→ Institution (education[0].institution) · Taught by you' && nth(a.review)('Degree').checked && !nth(a.review)('Institution').checked && va.i === '' && va.d === 'Degree A' && va.f === 'Field A', JSON.stringify(va));
    await a.tab.close(); await close(b);
  }

  // =================== 8. position-based ===================
  await seed(profile({ education: [E.B, E.A] }));
  p = await analyzePage('/edu2');
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('8. after reordering the profile, Education 2 → Institution resolves to University A (no identity matching)', v.insta === undefined && v.inst2 === 'University A' && v.inst1 === 'University B' && v.deg2 === 'Degree A', JSON.stringify(v));
  await close(p);

  // =================== 9. missing records, both directions ===================
  await seed(profile({ education: [E.A, E.B] }));
  p = await analyzePage('/all');
  let r3 = nth(p.review)('Institution', 2);
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('9. profile 2 / page 3: Education 3 cannot be selected and stays untouched', r3.disabled && r3.note === 'No value in your profile.' && v.inst1 === 'University A' && v.inst2 === 'University B' && v.inst3 === '' && v.deg3 === '', JSON.stringify([v.inst1, v.inst2, v.inst3]));
  await close(p);
  await seed(profile());
  p = await analyzePage('/edu2');
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  const sent = (await crossed(p)).map((i) => i.value);
  check('9. profile 3 / page 2: blocks 1–2 filled, Education 3 ignored (never sent)', v.inst1 === 'University A' && v.inst2 === 'University B' && !sent.includes('University C'), JSON.stringify(sent));
  await close(p);

  // =================== 10. partial records ===================
  await seed(profile({ education: [E.A, { institution: 'University B', degree: '', fieldOfStudy: 'Computer Science', graduationYear: undefined }] }));
  p = await analyzePage('/all');
  at = nth(p.review);
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('10. partial record: Institution and Field of Study filled; Degree and Graduation Year untouched and unselectable', v.inst2 === 'University B' && v.fos2 === 'Computer Science' && v.deg2 === '' && v.grad2 === '' && at('Degree', 1).disabled && at('Graduation Year', 1).disabled, JSON.stringify([v.inst2, v.deg2, v.fos2, v.grad2]));
  await close(p);

  // =================== 11. removed records ===================
  await seed(profile({ education: [E.A], certifications: [] }));
  p = await analyzePage('/all');
  at = nth(p.review);
  const removed = [at('Institution', 1), at('Institution', 2), at('Name', 0), at('Name', 1)];
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  const forced = await editor.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/fill-page', payload: { tabId: 1, approvals: [{ field: { id: 'id:inst2', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, signals: { htmlId: 'inst2', name: 'inst2', label: 'Institution' }, record: { collection: 'education', index: 1 } }, profileField: 'education[1].institution' }] } }).then((r) => JSON.stringify(r))`);
  check('11. removed records: not selectable, "No value in your profile", nothing filled, never another record', removed.every((r) => r.disabled && !r.checked && r.note === 'No value in your profile.') && v.inst2 === '' && v.inst3 === '' && v.cn1 === '' && v.cn2 === '' && forced.includes('"status":"skipped"') && !forced.includes('University'), forced);
  await close(p);

  // =================== 12. dynamically added blocks ===================
  await seed(profile());
  p = await analyzePage('/edu2add');
  await selectAll(p.popup);
  await p.tab.evaluate(`document.querySelector('[data-add-end]').click(); true`); // the user adds Education 3
  await fill(p.popup); // with the analysis from before the block existed
  v = await values(p.tab);
  check('12. the new block is not filled without Analyze; ApplyOnce did not click "Add Education"', v.inst3x === '' && v.inst1 === 'University A' && v.inst2 === 'University B' && (await p.tab.evaluate(`document.getElementById('adds').textContent`)) === '1', JSON.stringify(v));
  await reanalyze(p);
  const added = nth(p.review)('Institution', 2);
  check('12. Analyze again detects it as Education 3, unticked', targetOf(added) === 'education[2].institution' && !added.checked);
  await selectAll(p.popup);
  await fill(p.popup);
  v = await values(p.tab);
  check('12. after approval it fills from profile position 3', v.inst3x === 'University C' && (await p.tab.evaluate(`document.getElementById('adds').textContent`)) === '1');
  await close(p);
  // A block inserted above the analysed ones shifts every position: stale approvals must not fill.
  p = await analyzePage('/edutop');
  await selectAll(p.popup);
  await p.tab.evaluate(`document.querySelector('[data-add-top]').click(); true`);
  summary = await fill(p.popup);
  v = await values(p.tab);
  const results = await p.popup.evaluate(`[...document.querySelectorAll('.review-item .note')].map((n) => n.textContent).join(' | ')`);
  check('12. a block inserted above shifts positions: stale approvals are refused, nothing filled', Object.values(v).every((x) => x === '') && results.includes('Not found'), `${summary} ${results} ${JSON.stringify(v)}`);
  await close(p);

  const logged = consoleLog.join('\n');
  console.log(`      console lines captured: ${consoleLog.length}${consoleLog.length ? ' → ' + consoleLog.slice(0, 3).join(' || ') : ''}`);
  check('16. no profile value in any console (page, popup, profile page, service worker)', !['University', 'Degree A', 'Company A', 'Company B', 'Certification A', 'cert.example.com', 'Current Co', 'Jane'].some((x) => logged.includes(x)));
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
