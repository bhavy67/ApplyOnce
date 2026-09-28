// Phase 10 (repeatable profile records) verification in real Chrome via the DevTools pipe. Fake data only.
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

const APPLY = `<!doctype html><html lang="en"><head><title>Job application</title></head><body>
<form id="apply"><h2>Application</h2>
<p><label for="fn">First Name</label><input id="fn" name="firstName"></p>
<p><label for="em">Email</label><input id="em" type="email" name="email"></p>
<p><label for="ci">City</label><input id="ci" name="city"></p>
<p><label for="st">State</label><input id="st" name="state"></p>
<p><label for="co">Country</label><select id="co" name="country"><option value="">Select…</option><option>India</option><option>Canada</option></select></p>
<p><label for="jt">Current Job Title</label><input id="jt" name="currentTitle"></p>
<p><label for="cc">Current Company</label><input id="cc" name="currentCompany"></p>
<p><label for="dg">Degree</label><input id="dg" name="degree"></p>
<p><label for="fs">Field of Study</label><input id="fs" name="fieldOfStudy"></p>
<p><label for="un">University</label><input id="un" name="university"></p>
<p><label for="gy">Graduation Year</label><input id="gy" type="number" name="gradYear"></p>
<p><label for="wa">Work Authorization</label><input id="wa" name="workAuth"></p>
<p><label for="pu">Previous university</label><input id="pu" name="q1"></p>
<p><label for="pe">Previous employer</label><input id="pe" name="q2"></p>
<p><label for="cn">Certification name</label><input id="cn" name="q3"></p>
<p><label for="am">Alma mater</label><input id="am" name="q4"></p>
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


/** Exactly what Phases 5–9 stored (schema version 2), plus a Phase 4-style saved mapping. */
const PHASE9_PROFILE = {
  schemaVersion: 2,
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com' },
  location: { city: 'Springfield', state: 'Ontario', country: 'Canada' },
  education: { institution: 'University of Example', degree: "Master's", fieldOfStudy: 'Physics', graduationYear: 2021 },
  experience: { currentCompany: 'Example Co', currentTitle: 'Staff Engineer', totalExperienceYears: 6, workHistory: [] },
  links: { linkedin: 'https://www.linkedin.com/in/jane-doe-example' },
  preferences: { workMode: 'hybrid' },
  authorization: { workAuthorization: 'Authorized to work in Canada', requiresSponsorship: false },
  documents: { resumes: [], coverLetters: [] },
  customAnswers: [],
};
const OLD_MAPPINGS = {
  version: 1,
  mappings: [{ key: 'v1|text|q=alma mater|c=|i=', parts: { fieldType: 'text', question: 'alma mater' }, profileField: 'institution', site: '127.0.0.1', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }],
};
const rawStore = (key) => `new Promise((resolve, reject) => {
  const r = indexedDB.open('applyonce');
  r.onsuccess = () => { const g = r.result.transaction('records').objectStore('records').get('${key}'); g.onsuccess = () => { resolve(JSON.stringify(g.result ?? null)); r.result.close(); }; g.onerror = reject; };
  r.onerror = reject;
})`;
const seed = `new Promise((resolve, reject) => {
  const r = indexedDB.open('applyonce');
  r.onsuccess = () => {
    const tx = r.result.transaction('records', 'readwrite');
    tx.objectStore('records').put(${JSON.stringify(PHASE9_PROFILE)}, 'profile');
    tx.objectStore('records').put(${JSON.stringify(OLD_MAPPINGS)}, 'savedMappings');
    tx.oncomplete = () => { r.result.close(); resolve(true); };
    tx.onerror = reject;
  };
  r.onerror = reject;
})`;
const EDITOR_HELPERS = `
  window.r = {
    rec: (title) => [...document.querySelectorAll('.record')].find((x) => x.querySelector('h3')?.textContent === title),
    input: (title, label) => { const l = [...r.rec(title).querySelectorAll('label')].find((x) => x.textContent.trim() === label); return document.getElementById(l.htmlFor); },
    set: (title, label, value) => {
      const el = r.input(title, label);
      if (el.type === 'checkbox') { if (el.checked !== value) el.click(); return true; }
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      return true;
    },
    get: (title, label) => { const el = r.input(title, label); return el.type === 'checkbox' ? el.checked : el.value; },
    click: (name) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === name || x.getAttribute('aria-label') === name); b.click(); return true; },
    titles: () => [...document.querySelectorAll('.record h3')].map((h) => h.textContent),
    sections: () => [...document.querySelectorAll('form section h2')].map((h) => h.textContent),
    errors: () => [...document.querySelectorAll('form .field-error')].map((e) => e.textContent),
    text: (section) => [...document.querySelectorAll('form section')].find((s) => s.querySelector('h2')?.textContent === section)?.innerText ?? '',
  };
  true`;
async function openEditor(id) {
  const editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(EDITOR_HELPERS);
  return editor;
}
async function save(editor, expected = 'Profile saved') {
  await editor.evaluate(`r.click('Save profile')`);
  return waitFor(editor, `document.querySelector('.save-bar [role=status]')?.textContent === ${JSON.stringify(expected)}`, 5000);
}
const set = (editor, title, label, value) => editor.evaluate(`r.set(${JSON.stringify(title)}, ${JSON.stringify(label)}, ${JSON.stringify(value)})`);
const get = (editor, title, label) => editor.evaluate(`r.get(${JSON.stringify(title)}, ${JSON.stringify(label)})`);
const click = (editor, name) => editor.evaluate(`r.click(${JSON.stringify(name)})`);
const stored = async (page, key = 'profile') => JSON.parse(await page.evaluate(rawStore(key)));

try {
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')));
  const { id } = await send('Extensions.loadUnpacked', { path: DIST });

  // ============ 1–2. An existing Phase 9 (schema v2) profile and saved mapping ============
  let editor = await openEditor(id);
  await editor.evaluate(seed);
  await editor.send('Page.reload');
  await sleep(300);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(EDITOR_HELPERS);
  const sections = await editor.evaluate('JSON.stringify(r.sections())');
  check('editor sections: Work experience and Certifications added', sections === JSON.stringify(['Personal information', 'Location', 'Professional', 'Employment', 'Work experience', 'Job preferences', 'Education', 'Certifications', 'Authorization']), sections);
  const primary = await editor.evaluate(`JSON.stringify(['Institution', 'Highest degree', 'Field of study', 'Graduation year'].map((l) => r.get('Education 1 (primary)', l)))`);
  check('1–2. Phase 9 profile loads; primary education is Education 1 with every value', primary === JSON.stringify(['University of Example', "Master's", 'Physics', '2021']), primary);
  const current = await editor.evaluate(`JSON.stringify(['Current company', 'Current job title'].map((label) => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label); return document.getElementById(l.htmlFor).value; }))`);
  check('2. current employment kept as its own fields; no work experience fabricated', current === JSON.stringify(['Example Co', 'Staff Engineer']) && (await editor.evaluate(`r.text('Work experience')`)).includes('No entries yet.') && (await editor.evaluate(`r.text('Certifications')`)).includes('No entries yet.'), current);
  check('migration: loading alone does not rewrite storage (still v2)', (await stored(editor)).schemaVersion === 2);

  // ============ 3–6. Add, edit, remove ============
  await click(editor, '+ Add education');
  await click(editor, '+ Add education'); // left blank on purpose
  await set(editor, 'Education 2', 'Institution', 'Sample College');
  await set(editor, 'Education 2', 'Degree', 'BSc');
  await set(editor, 'Education 2', 'Graduation year', '1800'); // invalid first
  await click(editor, '+ Add work experience');
  await click(editor, '+ Add work experience');
  await set(editor, 'Work experience 1', 'Company', 'Example Co');
  await set(editor, 'Work experience 1', 'Job title', 'Staff Engineer');
  await set(editor, 'Work experience 1', 'Start (YYYY-MM)', '2021-06');
  await set(editor, 'Work experience 1', 'I currently work here', true);
  await set(editor, 'Work experience 2', 'Company', 'Previous Employer Ltd');
  await set(editor, 'Work experience 2', 'Job title', 'Engineer');
  await set(editor, 'Work experience 2', 'Start (YYYY-MM)', '2018-01');
  await set(editor, 'Work experience 2', 'End (YYYY-MM)', 'May 2021'); // invalid first
  await set(editor, 'Work experience 2', 'Description', 'Built example services.');
  await click(editor, '+ Add certification');
  await set(editor, 'Certification 1', 'Name', 'Example Certified');
  await set(editor, 'Certification 1', 'Issuer', 'Example Org');
  await set(editor, 'Certification 1', 'Issue year', '2022');
  await set(editor, 'Certification 1', 'Credential URL', 'not a url'); // invalid first
  await click(editor, '+ Add certification');
  await set(editor, 'Certification 2', 'Name', 'Temporary Cert');
  check('3–5. records added', JSON.stringify(await editor.evaluate('r.titles()')) === JSON.stringify(['Work experience 1', 'Work experience 2', 'Education 1 (primary)', 'Education 2', 'Education 3', 'Certification 1', 'Certification 2']));

  // ============ 10. Validation ============
  check('10. invalid values block saving', !(await save(editor)) && (await editor.evaluate(`document.querySelector('.save-bar [role=status]').textContent`)) === 'Fix the highlighted fields, then save again.');
  const errors = await editor.evaluate('JSON.stringify(r.errors())');
  check('10. errors shown on the record fields (year, month, URL)', errors.includes('Enter a year between') && errors.includes('Enter a month as YYYY-MM') && errors.includes('Enter a valid URL'), errors);
  check('10. nothing written while invalid', (await stored(editor)).schemaVersion === 2);
  await set(editor, 'Education 2', 'Graduation year', '2016');
  await set(editor, 'Work experience 2', 'End (YYYY-MM)', '2021-05');
  await set(editor, 'Certification 1', 'Credential URL', 'https://cert.example.com/abc');
  await set(editor, 'Work experience 1', 'End (YYYY-MM)', '2024-01');
  check('10. current role with an end date is rejected', !(await save(editor)) && (await editor.evaluate('JSON.stringify(r.errors())')).includes('Leave the end date blank'));
  await set(editor, 'Work experience 1', 'End (YYYY-MM)', '');

  // ============ 6–7. Edit, reorder, remove ============
  await set(editor, 'Work experience 2', 'Job title', 'Senior Engineer');
  await click(editor, 'Remove Certification 2');
  await click(editor, 'Move Education 2 up');
  const swapped = await get(editor, 'Education 1 (primary)', 'Institution');
  await click(editor, 'Move Education 1 (primary) down');
  const restored = await get(editor, 'Education 1 (primary)', 'Institution');
  check('6. reorder with up/down (Education 2 becomes primary, then back)', swapped === 'Sample College' && restored === 'University of Example', `${swapped} → ${restored}`);
  check('7. removed record disappears', JSON.stringify(await editor.evaluate('r.titles()')).includes('Certification 2') === false);
  check('save after fixing', await save(editor));
  const saved = await stored(editor);
  check('storage: current schema (4) with records; blank Education 3 dropped; primary first', saved.schemaVersion === 4 && saved.education.length === 2 && saved.education[0].institution === 'University of Example' && saved.education[1].institution === 'Sample College' && saved.workExperience.length === 2 && saved.certifications.length === 1 && !('workHistory' in saved.experience) && saved.experience.currentCompany === 'Example Co', JSON.stringify({ education: saved.education, workExperience: saved.workExperience, certifications: saved.certifications }));
  check('storage: current flag stored as true, no invented dates', saved.workExperience[0].current === true && saved.workExperience[0].endDate === undefined && saved.workExperience[1].current === undefined);
  let shot = await editor.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(SCRATCH, 'phase10-editor.png'), Buffer.from(shot.data, 'base64'));

  // ============ 8–9. Reload: values persist ============
  await editor.send('Page.reload');
  await sleep(300);
  await waitFor(editor, `document.querySelectorAll('.record').length >= 5`);
  await editor.evaluate(EDITOR_HELPERS);
  const persisted = await editor.evaluate(`JSON.stringify([r.titles(), r.get('Education 2', 'Institution'), r.get('Education 2', 'Graduation year'), r.get('Work experience 1', 'I currently work here'), r.get('Work experience 2', 'Job title'), r.get('Work experience 2', 'End (YYYY-MM)'), r.get('Work experience 2', 'Description'), r.get('Certification 1', 'Credential URL')])`);
  check('8–9. after reload every record value persists', persisted === JSON.stringify([['Work experience 1', 'Work experience 2', 'Education 1 (primary)', 'Education 2', 'Certification 1'], 'Sample College', '2016', true, 'Senior Engineer', '2021-05', 'Built example services.', 'https://cert.example.com/abc']), persisted);

  // ============ 11. Existing saved mapping ============
  check('11. Phase 4-style saved mapping still listed, resolved to the primary record', await waitFor(editor, `document.querySelector('.mapping-list')?.innerText.includes('Institution (education[0].institution)')`));

  // ============ 34. Generic form regression + old mapping + 12/35 Teach ============
  const tab = await open(`${ORIGIN}/apply`);
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
  check('Alma mater: the old saved mapping still resolves (Taught by you → Institution)', review['Alma mater'].mapping === '→ Institution (education[0].institution) · Taught by you');
  const summary = await fill(popup);
  const values = JSON.parse(await tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#apply input, #apply select')].map((e) => [e.name, e.value])))`));
  console.log('      after Fill: ' + summary + ' ' + JSON.stringify(values));
  check('34. regression fields fill from the new model', values.firstName === 'Jane' && values.email === 'jane.doe@example.com' && values.city === 'Springfield' && values.state === 'Ontario' && values.country === 'Canada' && values.currentTitle === 'Staff Engineer' && values.currentCompany === 'Example Co' && values.degree === "Master's" && values.fieldOfStudy === 'Physics' && values.university === 'University of Example' && values.gradYear === '2021' && values.workAuth === 'Authorized to work in Canada');
  check('34. historical records are never filled automatically', values.q1 === '' && values.q2 === '' && values.q3 === '');

  // Teach Once: selector reflects current records
  const PU = 'Previous university';
  await popup.evaluate(`t.li(${JSON.stringify(PU)}).querySelector('button.teach').click(); true`);
  await waitFor(popup, `!!t.li(${JSON.stringify(PU)}).querySelector('.teach-editor select')`);
  const groups = await popup.evaluate(`JSON.stringify([...t.li(${JSON.stringify(PU)}).querySelectorAll('optgroup')].map((g) => g.label))`);
  const optionText = await popup.evaluate(`[...t.li(${JSON.stringify(PU)}).querySelectorAll('option')].find((o) => o.value === 'education[1].institution')?.textContent ?? ''`);
  check('12. Teach selector groups come from the definitions and the current records', groups === JSON.stringify(['Personal information', 'Location', 'Professional', 'Employment', 'Work experience 1', 'Work experience 2', 'Job preferences', 'Education 1 (primary)', 'Education 2', 'Certification 1', 'Authorization']) && optionText === 'Education 2 → Institution', `${groups} | ${optionText}`);
  await popup.evaluate(`t.li(${JSON.stringify(PU)}).querySelector('.teach-actions .secondary').click(); true`);
  await sleep(100);
  const pageBefore = await tab.evaluate(`JSON.stringify([...document.querySelectorAll('#apply input')].map((e) => e.value))`);
  for (const [name, target, text] of [
    [PU, 'education[1].institution', '→ Education 2 → Institution (education[1].institution) · Taught by you'],
    ['Previous employer', 'workExperience[1].company', '→ Work experience 2 → Company (workExperience[1].company) · Taught by you'],
    ['Certification name', 'certifications[0].name', '→ Certification 1 → Name (certifications[0].name) · Taught by you'],
  ]) {
    await teach(popup, name, target);
    const taught = await item(popup, name);
    check(`35. ${name} → ${target}: saved, shown as taught, unticked`, taught.mapping === text && !taught.checked && !taught.disabled, `${taught.mapping} | checked=${taught.checked}`);
  }
  check('35. teaching filled nothing', (await tab.evaluate(`JSON.stringify([...document.querySelectorAll('#apply input')].map((e) => e.value))`)) === pageBefore);
  for (const name of [PU, 'Previous employer', 'Certification name']) await popup.evaluate(`t.toggle(${JSON.stringify(name)}); true`);
  await sleep(100);
  await fill(popup);
  const taughtValues = JSON.parse(await tab.evaluate(`JSON.stringify([document.getElementById('pu').value, document.getElementById('pe').value, document.getElementById('cn').value])`));
  check('35. after explicit approval + Fill, each taught record value is filled', JSON.stringify(taughtValues) === JSON.stringify(['Sample College', 'Previous Employer Ltd', 'Example Certified']), JSON.stringify(taughtValues));
  shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase10-popup.png'), Buffer.from(shot.data, 'base64'));
  check('no submission', (await tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');

  // ============ 15. Privacy ============
  const raw = await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id);
  const crossed = JSON.parse(raw).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => i.value));
  console.log('      values sent to the content script: ' + JSON.stringify(crossed));
  const allowed = new Set(['Jane', 'jane.doe@example.com', 'Springfield', 'Ontario', 'Canada', 'Staff Engineer', 'Example Co', "Master's", 'Physics', 'University of Example', 2021, 'Authorized to work in Canada', 'Sample College', 'Previous Employer Ltd', 'Example Certified']);
  const page = JSON.parse(await tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce/i.test(k)) })`));
  const unapproved = ['https://cert.example.com/abc', 'Example Org', 'Built example services.', 'Senior Engineer', '2018-01', '2021-05', 'BSc', 'https://www.linkedin.com/in/jane-doe-example'];
  const leaked = unapproved.filter((v) => raw.includes(v) || (page.html.includes(v) && !baseline.includes(v)));
  check('15. only approved values reached the content script', crossed.every((v) => allowed.has(v)) && crossed.length > 0, JSON.stringify(crossed));
  check('15. no other record values in messages, page DOM, storage, or globals', leaked.length === 0 && !raw.includes('workExperience') && !raw.includes('certifications') && !raw.includes('schemaVersion') && page.local.length === 0 && page.session.length === 0 && page.globals.length === 0, leaked.join(', '));
  await popup.close();

  // ============ 13. Deleting a mapping does not alter profile records ============
  const profileBefore = await editor.evaluate(rawStore('profile'));
  const mappingsBefore = (await stored(editor, 'savedMappings')).mappings.length;
  await editor.send('Page.reload');
  await waitFor(editor, `document.querySelectorAll('.mapping-list li').length === ${mappingsBefore}`);
  await editor.evaluate(`[...document.querySelectorAll('.mapping-list li')].find((li) => li.innerText.includes('Education 2')).querySelector('button').click(); true`);
  await waitFor(editor, `document.querySelectorAll('.mapping-list li').length === ${mappingsBefore - 1}`);
  check('13. deleting a mapping leaves the profile records unchanged', (await editor.evaluate(rawStore('profile'))) === profileBefore && (await stored(editor, 'savedMappings')).mappings.length === mappingsBefore - 1);

  // ============ 14. Clear profile ============
  await editor.evaluate(EDITOR_HELPERS);
  await click(editor, 'Clear profile…');
  await sleep(100);
  await click(editor, 'Clear Profile');
  await waitFor(editor, `document.querySelector('.save-bar [role=status]')?.textContent === 'Profile cleared'`);
  const afterClear = await editor.evaluate(`JSON.stringify([r.titles(), r.get('Education 1 (primary)', 'Institution'), r.text('Work experience').includes('No entries yet.'), r.text('Certifications').includes('No entries yet.')])`);
  check('14. clearing removes every record (and the profile) but keeps saved mappings', (await stored(editor)) === null && (await stored(editor, 'savedMappings')).mappings.length === mappingsBefore - 1 && afterClear === JSON.stringify([['Education 1 (primary)'], '', true, true]), afterClear);
  await editor.send('Page.reload');
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(EDITOR_HELPERS);
  check('14. still empty after reload', JSON.stringify(await editor.evaluate('r.titles()')) === JSON.stringify(['Education 1 (primary)']));

  await shutdown();
} catch (error) {
  check('run completed', false, String(error?.stack ?? error));
  chrome?.kill();
} finally {
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? '' : ''}${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
