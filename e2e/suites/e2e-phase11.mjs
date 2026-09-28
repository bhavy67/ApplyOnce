// Phase 11 (repeatable application sections) verification in real Chrome. Fake data only; nothing is submitted.
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
const eduBlock = (n) => `<div class="edu"><h3>Education ${n}</h3>${input(`inst${n}`, 'Institution')}${input(`deg${n}`, 'Degree')}${input(`fos${n}`, 'Field of Study')}${input(`grad${n}`, 'Graduation Year', 'number')}</div>`;
const workBlock = (n) => `<fieldset><legend>Work Experience ${n}</legend>${input(`co${n}`, 'Company')}${input(`ti${n}`, 'Job Title')}${input(`lo${n}`, 'Location')}${input(`sd${n}`, 'Start Date')}${input(`ed${n}`, 'End Date')}${input(`cur${n}`, 'I currently work here', 'checkbox')}${input(`de${n}`, 'Description', 'textarea')}</fieldset>`;
const certBlock = (n) => `<div role="group" aria-label="Certification ${n}">${input(`cn${n}`, 'Name')}${input(`ci${n}`, 'Issuer')}${input(`cy${n}`, 'Issue Year', 'number')}${input(`cu${n}`, 'Credential URL')}</div>`;
const shell = (title, body) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>
<form id="apply">${body}<button type="submit">Submit application</button></form>
<p id="submitted">false</p><p id="adds">0</p>
<script>
  document.getElementById('apply').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    document.getElementById('adds').textContent = String(Number(document.getElementById('adds').textContent) + 1);
    const n = document.querySelectorAll('.edu').length + 1;
    b.insertAdjacentHTML('beforebegin', ${JSON.stringify('')} + window.eduTemplate(n));
  }));
  window.eduTemplate = (n) => ${JSON.stringify(eduBlock('__N__'))}.replaceAll('__N__', n);
</script></body></html>`;

const PAGES = {
  '/edu3': shell('Education', `${input('fn', 'First Name')}${input('am', 'Alma mater')}<section><h2>Education</h2>${eduBlock(1)}${eduBlock(2)}${eduBlock(3)}</section>`),
  '/edu2add': shell('Education (add)', `<section><h2>Education</h2>${eduBlock(1)}${eduBlock(2)}<button type="button" data-add>Add Education</button></section>`),
  '/work': shell('Work', `${input('cc', 'Current Company')}${workBlock(1)}${workBlock(2)}`),
  '/certs': shell('Certifications', `${certBlock(1)}${certBlock(2)}`),
  '/ambiguous': shell('Ambiguous', `<div><h3>Education 2</h3>${input('a1', 'Institution')}</div><div><h3>Education 1</h3>${input('a2', 'Institution')}</div>`),
  '/single': shell('Single', `<div><h3>Work Experience 1</h3>${input('s1', 'Company')}${input('s2', 'Job Title')}</div><div><h3>Education 1</h3>${input('s3', 'Institution')}</div>`),
  '/workday': `<!doctype html><html lang="en-US"><head><title>Careers - Apply</title></head><body>
    <form id="apply"><div data-automation-id="applyFlowPage">
      <div data-automation-id="workExperienceSection">
        ${[1, 2].map((n) => `<div data-automation-id="workExperience-${n}"><h4>Work Experience ${n}</h4>
          <div data-automation-id="formField-jobTitle"><label for="wt${n}">Job Title<abbr>*</abbr></label><input id="wt${n}" data-automation-id="jobTitle"></div>
          <div data-automation-id="formField-company"><label for="wc${n}">Company<abbr>*</abbr></label><input id="wc${n}" data-automation-id="company"></div></div>`).join('')}
        <button type="button" data-automation-id="add-button" id="addwork">Add Another</button>
      </div>
      <div data-automation-id="educationSection">
        ${[1, 2].map((n) => `<div data-automation-id="education-${n}"><h4>Education ${n}</h4>
          <div data-automation-id="formField-school"><label for="ws${n}">School or University</label><input id="ws${n}" data-automation-id="school"></div>
          <div data-automation-id="formField-fieldOfStudy"><label for="wf${n}">Field of Study</label><input id="wf${n}" data-automation-id="fieldOfStudy"></div></div>`).join('')}
      </div>
      <button type="button" data-automation-id="pageFooterNextButton" id="next">Save and Continue</button>
    </div></form><p id="submitted">false</p><p id="nav">0</p>
    <script>
      document.getElementById('apply').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
      for (const id of ['next', 'addwork']) document.getElementById(id).addEventListener('click', () => { document.getElementById('nav').textContent = String(Number(document.getElementById('nav').textContent) + 1); });
    </script></body></html>`,
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
const EDU = {
  A: { institution: 'University A', degree: 'BSc', fieldOfStudy: 'Physics', graduationYear: 2014 },
  B: { institution: 'University B', fieldOfStudy: 'Computer Science' }, // partial: no degree, no year
  C: { institution: 'University C', degree: 'PhD', fieldOfStudy: 'Biology', graduationYear: 2020 },
};
const baseProfile = (overrides = {}) => ({
  schemaVersion: 3,
  identity: { firstName: 'Jane' }, contact: {}, location: {},
  education: [EDU.A, EDU.B, EDU.C],
  experience: { currentCompany: 'Current Co', currentTitle: 'Staff Engineer' },
  workExperience: [
    { company: 'Company A', title: 'Title A', location: 'Springfield', startDate: '2021-06', current: true, description: 'Current role.' },
    { company: 'Company B', title: 'Title B', startDate: '2018-01', endDate: '2021-05', description: 'Previous role.' },
  ],
  certifications: [
    { name: 'Certification A', issuer: 'Issuer A', issueYear: 2020, credentialUrl: 'https://cert.example.com/a' },
    { name: 'Certification B', issuer: 'Issuer B' },
  ],
  links: {}, preferences: {}, authorization: {}, documents: { resumes: [], coverLetters: [] }, customAnswers: [],
  ...overrides,
});
// A Phase 4–10 style saved mapping for the question "institution" (standalone use), plus Alma mater.
const MAPPINGS = { version: 1, mappings: [
  { key: 'v1|text|q=alma mater|c=|i=', parts: { fieldType: 'text', question: 'alma mater' }, profileField: 'institution', createdAt: now, updatedAt: now },
  { key: 'v1|text|q=institution|c=|i=', parts: { fieldType: 'text', question: 'institution' }, profileField: 'education[2].institution', createdAt: now, updatedAt: now },
] };

let id;
let editor;
async function seed(profile) {
  await editor.evaluate(writeRaw('profile', profile));
}
const values = (tab) => tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#apply input, #apply textarea')].map((e) => [e.id, e.type === 'checkbox' ? e.checked : e.value])))`);
async function analyzePage(path) {
  const tab = await open(`${ORIGIN}${path}`);
  await waitFor(tab, `document.readyState === 'complete'`);
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  const review = await readReview(popup);
  return { tab, popup, world, review, baseline: await tab.evaluate('document.documentElement.outerHTML') };
}
async function readReview(popup) {
  return JSON.parse(await popup.evaluate(`JSON.stringify([...document.querySelectorAll('.review-item')].map((li) => ({ name: li.querySelector('.field-name').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, teach: !!li.querySelector('button.teach') })))`));
}
const logReview = (label, review) => { console.log(`      ${label}:`); for (const r of review) console.log(`        [${r.checked ? 'x' : r.disabled ? '-' : ' '}] ${r.name} | ${r.mapping} | ${r.note}${r.teach ? ' | teach' : ''}`); };
async function selectAll(popup) {
  await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]')].forEach((c) => { if (!c.checked && !c.disabled) c.click(); }); true`);
  await sleep(100);
}
const crossedValues = async (tab, world) => JSON.parse(await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id)).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => i.value));
const byName = (review) => (name, n = 0) => review.filter((r) => r.name === name)[n];
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
  await editor.evaluate(writeRaw('savedMappings', MAPPINGS));
  await seed(baseProfile());

  // =================== Education 1–3 ===================
  let p = await analyzePage('/edu3');
  logReview('education review', p.review);
  let at = byName(p.review);
  check('Edu: three blocks map to Education 1–3 targets', ['Institution', 'Degree', 'Field of Study', 'Graduation Year'].every((n) => at(n, 0).mapping.includes('(education[0].') && at(n, 1).mapping.includes('(education[1].') && at(n, 2).mapping.includes('(education[2].')));
  check('Edu: Education 1 is automatic and selected (primary record), as before', ['Institution', 'Degree', 'Field of Study', 'Graduation Year'].every((n) => at(n, 0).checked && at(n, 0).mapping.includes('Automatic · High confidence')));
  check('Edu: Education 2/3 are proposed for review, never selected automatically', [1, 2].every((i) => ['Institution', 'Field of Study'].every((n) => !at(n, i).checked && !at(n, i).disabled && at(n, i).note === 'Needs review. Select to fill.')));
  check('Edu: partial record — Degree and Graduation Year of Education 2 have no value and cannot be selected', at('Degree', 1).note === 'No value in your profile.' && at('Degree', 1).disabled && at('Graduation Year', 1).disabled);
  const SECTION_NAMES = ['Institution', 'Degree', 'Field of Study', 'Graduation Year'];
  check('Edu: fields in repeated sections cannot be taught (position decides the record); standalone fields still can', p.review.filter((r) => SECTION_NAMES.includes(r.name)).every((r) => !r.teach) && at('Alma mater').teach && at('First Name').teach);
  check('Compat: the saved mapping for the question "Institution" is not applied inside sections', [0, 1, 2].every((i) => !at('Institution', i).mapping.includes('Taught by you')));
  check('Compat: existing scalar mapping (Alma mater → institution) still applies', at('Alma mater').mapping === '→ Institution (education[0].institution) · Taught by you');
  let summary = await fill(p.popup);
  let v = JSON.parse(await values(p.tab));
  check('Edu: default Fill fills only the primary record (and other automatic fields)', eq([v.inst1, v.deg1, v.fos1, v.grad1, v.fn], ['University A', 'BSc', 'Physics', '2014', 'Jane']) && [v.inst2, v.fos2, v.inst3, v.fos3, v.am].every((x) => x === ''), `${summary} ${JSON.stringify(v)}`);
  await selectAll(p.popup);
  summary = await fill(p.popup);
  v = JSON.parse(await values(p.tab));
  check('Edu: after approval each block gets its own record', eq([v.inst2, v.fos2, v.inst3, v.deg3, v.fos3, v.grad3, v.am], ['University B', 'Computer Science', 'University C', 'PhD', 'Biology', '2020', 'University A']), `${summary} ${JSON.stringify(v)}`);
  check('Edu: partial record leaves its blank fields untouched', v.deg2 === '' && v.grad2 === '');
  let crossed = await crossedValues(p.tab, p.world);
  check('Privacy: only the approved values crossed; no work/certification values', crossed.every((x) => ['Jane', 'University A', 'BSc', 'Physics', 2014, 'University B', 'Computer Science', 'University C', 'PhD', 'Biology', 2020].includes(x)) && !JSON.stringify(crossed).match(/Company|Certification|Title/), JSON.stringify(crossed));
  check('no submission', (await p.tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  await p.popup.close(); await p.tab.close();

  // Missing record, reordered profile, blank record, removed record
  for (const [label, profile, expect] of [
    ['profile has fewer records: Education 3 stays untouched', baseProfile({ education: [EDU.A, EDU.B] }), { inst1: 'University A', inst2: 'University B', inst3: '' }],
    ['reordered profile: positions resolve to the new order', baseProfile({ education: [EDU.C, EDU.A, EDU.B] }), { inst1: 'University C', inst2: 'University A', inst3: 'University B' }],
    ['blank record in the profile: its block stays untouched', baseProfile({ education: [EDU.A, {}, EDU.C] }), { inst1: 'University A', inst2: '', inst3: 'University C' }],
    ['removed record: nothing shifts into its place on the page', baseProfile({ education: [EDU.A] }), { inst1: 'University A', inst2: '', inst3: '' }],
  ]) {
    await seed(profile);
    p = await analyzePage('/edu3');
    await selectAll(p.popup);
    await fill(p.popup);
    v = JSON.parse(await values(p.tab));
    check(`Edu: ${label}`, Object.entries(expect).every(([k, x]) => v[k] === x), JSON.stringify(v));
    await p.popup.close(); await p.tab.close();
  }

  // Profile has more records than the page; the user adds a section, Analyze again
  await seed(baseProfile());
  p = await analyzePage('/edu2add');
  check('Edu: profile has more records than the page — only existing blocks are offered', (await readReview(p.popup)).filter((r) => r.name === 'Institution').length === 2);
  await p.tab.evaluate(`document.querySelector('[data-add]').click(); true`); // the user adds Education 3
  await p.popup.close();
  p.popup = await openPopupFor(id, p.tab);
  await analyze(p.popup);
  let review = await readReview(p.popup);
  check('Edu: a section the user adds is found by Analyze again (Education 3)', review.filter((r) => r.name === 'Institution').length === 3 && byName(review)('Institution', 2).mapping.includes('(education[2].institution)'));
  await selectAll(p.popup);
  await fill(p.popup);
  v = JSON.parse(await values(p.tab));
  check('Edu: ApplyOnce never clicks "Add Education"; the added block fills from Education 3', (await p.tab.evaluate(`document.getElementById('adds').textContent`)) === '1' && v.inst3 === 'University C', JSON.stringify(v));
  await p.popup.close(); await p.tab.close();

  // =================== Work experience ===================
  p = await analyzePage('/work');
  logReview('work review', p.review);
  at = byName(p.review);
  check('Work: blocks map to Work experience 1/2, never to current employment', ['Company', 'Job Title', 'Location', 'Start Date', 'End Date', 'I currently work here', 'Description'].every((n) => at(n, 0).mapping.includes('(workExperience[0].') && at(n, 1).mapping.includes('(workExperience[1].')) && at('Current Company').mapping.includes('(experience.currentCompany)'));
  check('Work: nothing in a work block is selected automatically', p.review.filter((r) => r.mapping.includes('workExperience[')).every((r) => !r.checked));
  summary = await fill(p.popup);
  v = JSON.parse(await values(p.tab));
  check('Work: default Fill fills only Current Company', v.cc === 'Current Co' && ['co1', 'co2', 'ti1', 'de1'].every((k) => v[k] === '') && v.cur1 === false, `${summary} ${JSON.stringify(v)}`);
  await selectAll(p.popup);
  summary = await fill(p.popup);
  v = JSON.parse(await values(p.tab));
  check('Work: company, title, location, dates, current, description fill from their record', eq([v.co1, v.ti1, v.lo1, v.sd1, v.cur1, v.de1, v.co2, v.ti2, v.sd2, v.ed2, v.de2], ['Company A', 'Title A', 'Springfield', '2021-06', true, 'Current role.', 'Company B', 'Title B', '2018-01', '2021-05', 'Previous role.']), `${summary} ${JSON.stringify(v)}`);
  check('Work: only fields with values are filled (no end date for the current role, no location/current for record 2)', v.ed1 === '' && v.lo2 === '' && v.cur2 === false);
  crossed = await crossedValues(p.tab, p.world);
  check('Privacy: no education or certification values crossed', !JSON.stringify(crossed).match(/University|Certification|Issuer/), JSON.stringify(crossed));
  await p.popup.close(); await p.tab.close();

  // =================== Certifications ===================
  p = await analyzePage('/certs');
  logReview('certification review', p.review);
  await selectAll(p.popup);
  await fill(p.popup);
  v = JSON.parse(await values(p.tab));
  check('Certs: name, issuer, issue year, credential URL fill from their record; blanks untouched', eq([v.cn1, v.ci1, v.cy1, v.cu1, v.cn2, v.ci2, v.cy2, v.cu2], ['Certification A', 'Issuer A', '2020', 'https://cert.example.com/a', 'Certification B', 'Issuer B', '', '']), JSON.stringify(v));
  await p.popup.close(); await p.tab.close();

  // =================== Unsupported / ambiguous ===================
  p = await analyzePage('/ambiguous');
  logReview('ambiguous review', p.review);
  check('Ambiguous numbering (Education 2 before 1): unsupported, never filled', p.review.every((r) => r.disabled && r.note === "Asked more than once, and ApplyOnce can't tell which profile record each one is for. Will not be filled."));
  await p.popup.close(); await p.tab.close();
  p = await analyzePage('/single');
  logReview('single-section review', p.review);
  at = byName(p.review);
  // One block is not a repeated section: fields map exactly as in Phase 10, including the saved
  // standalone mapping for the question "Institution" (seeded above → education[2].institution).
  check('A single section keeps Phase 10 behavior (scalar mapping, saved mappings, Teach)', at('Company').mapping.includes('(experience.currentCompany)') && at('Job Title').mapping.includes('(experience.currentTitle)') && at('Institution').mapping === '→ Education 3 → Institution (education[2].institution) · Taught by you' && p.review.every((r) => r.teach));
  await p.popup.close(); await p.tab.close();

  // =================== Workday-style step ===================
  p = await analyzePage('/workday');
  logReview('workday review', p.review);
  at = byName(p.review);
  check('Workday: detected; work and education blocks map to their records', (await p.popup.evaluate(`document.body.innerText.includes('Workday page')`)) && at('Job Title*', 1).mapping.includes('(workExperience[1].title)') && at('Company*', 0).mapping.includes('(workExperience[0].company)') && at('School or University', 1).mapping.includes('(education[1].institution)') && at('School or University', 0).mapping.includes('(education[0].institution)'));
  await selectAll(p.popup);
  await fill(p.popup);
  v = JSON.parse(await values(p.tab));
  check('Workday: each block filled from its record', eq([v.wt1, v.wc1, v.wt2, v.wc2, v.ws1, v.wf1, v.ws2, v.wf2], ['Title A', 'Company A', 'Title B', 'Company B', 'University A', 'Physics', 'University B', 'Computer Science']), JSON.stringify(v));
  check('Workday: never clicks Add Another / Save and Continue; no submission', (await p.tab.evaluate(`document.getElementById('nav').textContent`)) === '0' && (await p.tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  const page = JSON.parse(await p.tab.evaluate(`JSON.stringify({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce/i.test(k)) })`));
  const raw = await p.tab.evaluate(`JSON.stringify(globalThis.__recorded)`, p.world.id);
  check('Privacy: no profile, record lists, or schema in messages, storage, or globals', !/schemaVersion|"(education|workExperience|certifications)":\[|Certification A|Issuer A|University C/.test(raw) && page.local.length === 0 && page.session.length === 0 && page.globals.length === 0);
  await p.popup.close(); await p.tab.close();

  const logged = consoleLog.join('\n');
  console.log(`      console lines captured: ${consoleLog.length}${consoleLog.length ? ' → ' + consoleLog.slice(0, 3).join(' || ') : ''}`);
  check('Privacy: no profile value in any console', !['University A', 'University B', 'Company A', 'Company B', 'Certification A', 'cert.example.com', 'Current Co', 'Jane'].some((x) => logged.includes(x)));
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
