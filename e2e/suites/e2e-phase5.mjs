// Phase 5 verification in real Chrome via the DevTools pipe. Fake data only.
import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

// Repo-relative paths: suites live in e2e/suites, output goes to e2e/.out (git-ignored).
const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const SCRATCH = join(E2E, '.out');
e2eMkdir(SCRATCH, { recursive: true });
const DIST = join(ROOT, 'apps/chrome-extension/dist');
const PHASE4_DIST = join(SCRATCH, 'builds/5232240/apps/chrome-extension/dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P = {
  linkedin: 'https://www.linkedin.com/in/jane-doe-example',
  github: 'https://github.com/jane-doe-example',
  portfolio: 'https://jane-doe.example.dev/work?ref=apply',
  website: 'https://jane.example.com',
};

const JOB_FORM = `<!doctype html><html><head><title>Example Co — Apply</title></head><body>
<form id="apply" action="/submitted">
  <h3>Personal</h3>
  <label for="first">First Name</label><input id="first" name="first_name">
  <label for="last">Last Name</label><input id="last" name="last_name">
  <label for="email">Email</label><input id="email" type="email" name="email">
  <label for="phone">Phone</label><input id="phone" type="tel" name="phone">
  <h3>Location</h3>
  <label for="city">City</label><input id="city" name="city" value="Prefilled Town">
  <label for="state">State</label><input id="state" name="state">
  <label for="zip">Postal Code</label><input id="zip" name="zip">
  <h3>Professional</h3>
  <label for="li">LinkedIn</label><input id="li" type="url" name="linkedin">
  <label for="gh">GitHub</label><input id="gh" type="url" name="github">
  <label for="pf">Portfolio</label><input id="pf" type="url" name="portfolio">
  <label for="title">Current Job Title</label><input id="title" name="title">
  <label for="employer">Current Company</label><input id="employer" name="employer">
  <label for="yoe">Years of Experience</label><input id="yoe" type="number" name="yoe">
  <label for="company">Company</label><input id="company" name="company_field">
  <h3>Preferences</h3>
  <label for="mode">Work Mode</label>
  <select id="mode" name="mode"><option value="">Select…</option><option value="Remote">REMOTE</option><option value="Hybrid">HYBRID</option><option value="Onsite">ON-SITE</option></select>
  <fieldset><legend>Employment Type</legend>
    <label><input type="radio" name="etype" value="ft"> Full time</label>
    <label><input type="radio" name="etype" value="pt"> Part time</label>
    <label><input type="radio" name="etype" value="c"> Contract</label>
  </fieldset>
  <label><input type="checkbox" id="relocate" name="relocate"> Willing to relocate</label>
  <label><input type="checkbox" id="terms" name="terms"> I agree to the terms</label>
  <label for="arr">Work arrangement</label>
  <select id="arr" name="arr"><option value="">Select…</option><option value="rh">Remote / Hybrid</option><option value="off">In office</option></select>
  <h3>Education</h3>
  <label for="degree">Degree</label>
  <select id="degree" name="degree"><option value="">Select…</option><option value="ba">Bachelor's</option><option value="ma">Master's</option><option value="phd">PhD</option></select>
  <label for="fos">Field of Study</label><input id="fos" name="fos">
  <label for="uni">University</label><input id="uni" name="uni">
  <label for="grad">Graduation Year</label><input id="grad" type="number" name="grad">
  <h3>Other</h3>
  <label for="role">What kind of role are you looking for?</label>
  <select id="role" name="role"><option value="">Select…</option><option value="r1">Full time</option><option value="r2">Part time</option><option value="r3">Contract</option></select>
  <button type="submit">Submit application</button>
</form>
<p id="submitted">false</p><p id="events">0</p>
<script>
  document.getElementById('apply').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
  let n = 0; document.addEventListener('change', () => { document.getElementById('events').textContent = String(++n); });
</script>
</body></html>`;

const TEACH_PAGE = `<!doctype html><html><head><title>Teach page</title></head><body>
<div><label for="pref">Preferred Working Location</label><input id="pref" name="q_17"></div>
<div><label for="first">First Name</label><input id="first" name="firstName"></div>
</body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(req.url.startsWith('/teach') ? TEACH_PAGE : JOB_FORM);
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
async function launch(userDataDir) {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
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
async function waitFor(page, expression, timeout = 5000) {
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
    options: (name) => [...t.li(name).querySelectorAll('.teach-editor option')].map((o) => o.value),
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
  await waitFor(popup, `!!document.querySelector('.analysis, .message.error')`);
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
  const options = await popup.evaluate(`t.options(${JSON.stringify(name)})`);
  await popup.evaluate(`t.choose(${JSON.stringify(name)}, ${JSON.stringify(key)}); true`);
  await sleep(50);
  await popup.evaluate(`t.button('Save mapping', t.li(${JSON.stringify(name)})).click(); true`);
  await waitFor(popup, `!t.li(${JSON.stringify(name)}).querySelector('.teach-editor')`);
  return options;
}
const item = (popup, name) => popup.evaluate(`t.item(${JSON.stringify(name)})`);
const PAGE_VALUES = `JSON.stringify(Object.fromEntries([...document.querySelectorAll('input, select')].map((e) => [e.id || e.name + ':' + e.value, e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value])))`;
const pageValues = async (tab) => JSON.parse(await tab.evaluate(PAGE_VALUES));
const isolatedWorld = (tab) => (contexts.get(tab.sessionId) ?? []).findLast((c) => c.auxData?.type === 'isolated');
async function reloadTab(tab) {
  await tab.send('Page.reload');
  await sleep(700);
  await waitFor(tab, `document.readyState === 'complete'`);
}
/** Fills the profile editor by label (text, number, and select inputs). */
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
/** Editor values by label, as JSON. */
const editorGetAll = (labels) => `JSON.stringify(${JSON.stringify(labels)}.map((label) => { const found = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label); return found ? document.getElementById(found.htmlFor).value : null; }))`;
async function saveEditor(page) {
  await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  return waitFor(page, `document.querySelector('form [role=status], .save-bar [role=status]')?.textContent === 'Profile saved'`);
}
const readStoredProfile = `new Promise((resolve, reject) => {
  const r = indexedDB.open('applyonce');
  r.onsuccess = () => { const g = r.result.transaction('records').objectStore('records').get('profile'); g.onsuccess = () => resolve(JSON.stringify(g.result)); g.onerror = reject; };
  r.onerror = reject;
})`;

try {
  // =================== Part A: generic job application form ===================
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')));
  let { id } = await send('Extensions.loadUnpacked', { path: DIST });
  const editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `!!document.querySelector('form')`);
  const sections = await editor.evaluate(`[...document.querySelectorAll('form section h2')].map((h) => h.textContent).join(',')`);
  check('editor shows the Phase 5 sections', sections === 'Personal information,Location,Professional,Employment,Work experience,Job preferences,Education,Certifications,Authorization', sections);
  const inputTypes = await editor.evaluate(`JSON.stringify(Object.fromEntries(['Website','Years of experience','Graduation year','Work mode','Employment type','Willing to relocate'].map((label) => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label); const el = document.getElementById(l.htmlFor); return [label, el.tagName === 'SELECT' ? 'select' : el.type]; })))`);
  check('editor uses appropriate input types', inputTypes === JSON.stringify({ Website: 'url', 'Years of experience': 'number', 'Graduation year': 'number', 'Work mode': 'select', 'Employment type': 'select', 'Willing to relocate': 'select' }), inputTypes);
  await editor.evaluate(editorSet({ Website: 'not a url', 'Graduation year': '1800' }));
  await sleep(100);
  await editor.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  await sleep(300);
  const errors = await editor.evaluate(`[...document.querySelectorAll('.field-error')].map((e) => e.textContent)`);
  check('validation rejects invalid new fields', errors.length === 2, errors.join(' | '));
  await editor.evaluate(editorSet({
    'First name': 'Jane', 'Last name': 'Doe', Email: 'jane.doe@example.com', Phone: '+1 555 010 0199',
    City: 'Springfield', 'State / province': 'Ontario', 'Postal code': 'M5V 2T6',
    LinkedIn: P.linkedin, GitHub: P.github, Portfolio: P.portfolio, Website: P.website,
    'Current job title': 'Staff Engineer', 'Current company': 'Example Co', 'Years of experience': '7',
    'Work mode': 'remote', 'Employment type': 'full-time', 'Willing to relocate': 'yes',
    'Highest degree': "Master's", 'Field of study': 'Physics', Institution: 'Example University', 'Graduation year': '2019',
  }));
  await sleep(100);
  check('profile with Phase 5 fields saves', await saveEditor(editor));
  await editor.close();

  const tab = await open(`${ORIGIN}/apply.html`);
  await waitFor(tab, `document.readyState === 'complete'`);
  const before = await pageValues(tab);
  const htmlBefore = await tab.evaluate('document.documentElement.outerHTML');
  let popup = await openPopupFor(id, tab);
  const text = await analyze(popup);
  const names = await popup.evaluate('t.items()');
  check('1. all supported fields detected', names.length === 24 && text.includes('24 fields detected'), `${names.length}: ${names.join(', ')}`);
  const expected = {
    'First Name': 'First name (identity.firstName)',
    'Current Job Title': 'Current job title (experience.currentTitle)',
    'Current Company': 'Current company (experience.currentCompany)',
    'Years of Experience': 'Years of experience (experience.totalExperienceYears)',
    'Work Mode': 'Work mode (preferences.workMode)',
    'Employment Type': 'Employment type (preferences.employmentType)',
    'Willing to relocate': 'Willing to relocate (preferences.openToRelocation)',
    Degree: 'Highest degree (education[0].degree)',
    'Field of Study': 'Field of study (education[0].fieldOfStudy)',
    University: 'Institution (education[0].institution)',
    'Graduation Year': 'Graduation year (education[0].graduationYear)',
    LinkedIn: 'LinkedIn (links.linkedin)',
    GitHub: 'GitHub (links.github)',
    Portfolio: 'Portfolio (links.portfolio)',
  };
  const review = {};
  for (const name of names) review[name] = await item(popup, name);
  console.log('      review:');
  for (const [name, r] of Object.entries(review)) console.log(`        [${r.checked ? 'x' : r.disabled ? '-' : ' '}] ${name} | ${r.mapping} | ${r.note}`);
  const wrong = Object.entries(expected).filter(([name, target]) => review[name]?.mapping !== `→ ${target} · Automatic · High confidence`);
  check('2. deterministic mappings for the new fields', wrong.length === 0, wrong.map(([n]) => n).join(', '));
  const preselected = names.filter((n) => review[n].checked);
  check('3. high-confidence fields with values are pre-selected', preselected.length === 21 && !preselected.includes('Company'), `${preselected.length}`);
  check('4. ambiguous "Company" is review-level, not selected', review.Company.mapping === '→ Current company (experience.currentCompany) · Automatic · Low confidence' && !review.Company.checked && !review.Company.disabled);
  check('4. unknown and unrelated fields cannot be selected', review['What kind of role are you looking for?'].disabled && review['I agree to the terms'].disabled);
  check('5. Analyze did not modify the page', (await tab.evaluate('document.documentElement.outerHTML')) === htmlBefore && JSON.stringify(await pageValues(tab)) === JSON.stringify(before));

  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  await tab.evaluate(`document.getElementById('grad').remove(); true`); // 12: the page removes a field
  const summary = await fill(popup);
  const v = await pageValues(tab);
  check('6. explicit Fill: summary', summary === '18 fields filled · 1 skipped · 2 failed · 1 need review', summary);
  check('6. text fields filled', v.first === 'Jane' && v.last === 'Doe' && v.email === 'jane.doe@example.com' && v.phone === '+1 555 010 0199' && v.state === 'Ontario' && v.zip === 'M5V 2T6' && v.title === 'Staff Engineer' && v.employer === 'Example Co' && v.fos === 'Physics' && v.uni === 'Example University');
  check('7. number field filled', v.yoe === '7');
  check('8. selects matched (normalized value, apostrophe label)', v.mode === 'Remote' && v.degree === 'ma', `mode=${v.mode} degree=${v.degree}`);
  check('8. "Remote / Hybrid" option is not guessed', v.arr === '' && (await item(popup, 'Work arrangement')).note.startsWith('Failed'));
  check('9. radio and checkbox filled', v['etype:ft'] === true && v['etype:pt'] === false && v.relocate === true && v.terms === false);
  check('10. URLs filled exactly', v.li === P.linkedin && v.gh === P.github && v.pf === P.portfolio);
  check('11. existing page value not overwritten', v.city === 'Prefilled Town' && (await item(popup, 'City')).note.startsWith('Skipped'));
  check('4. review and unknown fields not filled', v.company === '' && v.role === '');
  check('12. removed field reported, others filled', (await item(popup, 'Graduation Year')).note === 'Not found. The field is no longer on the page.');
  check('13. form not submitted', (await tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false' && (await tab.evaluate('location.pathname')) === '/apply.html');
  const recorded = await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id);
  const pageState = JSON.parse(await tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce/i.test(k)) })`));
  check('14. unapproved values (website, relocation answer text) never reach the page', !recorded.includes(P.website) && !recorded.includes('schemaVersion') && !recorded.includes('"education"') && !pageState.html.includes(P.website));
  check('14. nothing in page globals or storage', pageState.local.length === 0 && pageState.session.length === 0 && pageState.globals.length === 0);
  let shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase5-fill.png'), Buffer.from(shot.data, 'base64'));

  // =================== Part B: Teach Once with a new field ===================
  const eventsBefore = await tab.evaluate(`document.getElementById('events').textContent`);
  const roleName = 'What kind of role are you looking for?';
  const options = await teach(popup, roleName, 'employment_type');
  check('new profile fields appear in the Teach selector', ['employment_type', 'work_mode', 'highest_degree', 'institution', 'graduation_year'].every((k) => options.includes(k)), `${options.length - 1} options`);
  let role = await item(popup, roleName);
  check('taught: shows "Taught by you", unticked', role.mapping === '→ Employment type (preferences.employmentType) · Taught by you' && !role.checked && !role.disabled, JSON.stringify(role));
  check('teaching did not change the page', (await tab.evaluate(`document.getElementById('events').textContent`)) === eventsBefore && (await pageValues(tab)).role === '');
  await popup.evaluate(`t.toggle(${JSON.stringify(roleName)}); true`);
  await sleep(100);
  await fill(popup);
  check('tick + Fill: taught field receives the canonical value', (await pageValues(tab)).role === 'r1');
  await popup.close();

  await reloadTab(tab);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  role = await item(popup, roleName);
  check('after reload: saved mapping reused, taught, not pre-selected', role.mapping === '→ Employment type (preferences.employmentType) · Taught by you' && !role.checked, JSON.stringify(role));
  check('after reload: no automatic fill', (await pageValues(tab)).role === '' && (await pageValues(tab)).first === '');
  shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase5-review.png'), Buffer.from(shot.data, 'base64'));
  await popup.close();
  await shutdown();

  // =================== Part C: real upgrade from the Phase 4 build ===================
  const userDataDir = mkdtempSync(join(SCRATCH, 'chrome-upgrade-'));
  const extDir = join(SCRATCH, 'ext-upgrade');
  rmSync(extDir, { recursive: true, force: true });
  cpSync(PHASE4_DIST, extDir, { recursive: true });
  await launch(userDataDir);
  ({ id } = await send('Extensions.loadUnpacked', { path: extDir }));
  const old = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(old, `!!document.querySelector('form')`);
  check('Phase 4 build loaded', (await old.evaluate(`[...document.querySelectorAll('form section h2')].map((h) => h.textContent).join(',')`)).startsWith('Personal,Contact'));
  await old.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Add education').click(); [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add education').click(); true`);
  await sleep(200);
  await old.evaluate(`(() => {
    const set = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const byLabel = (label) => [...document.querySelectorAll('label')].filter((x) => x.textContent.trim() === label).map((l) => document.getElementById(l.htmlFor));
    set(byLabel('First name')[0], 'Jane'); set(byLabel('Last name')[0], 'Doe'); set(byLabel('Email')[0], 'jane.doe@example.com');
    set(byLabel('City')[0], 'Springfield'); set(byLabel('Current company')[0], 'Example Co');
    set(byLabel('Institution')[0], 'Example University'); set(byLabel('Degree')[0], 'MSc'); set(byLabel('Graduation year')[0], '2021');
    set(byLabel('Institution')[1], 'First College'); set(byLabel('Degree')[1], 'BSc');
    for (const label of ['Remote', 'Hybrid', 'Contract', 'Full-time']) [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === label).querySelector('input').click();
    return true;
  })()`);
  await sleep(200);
  await old.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  check('Phase 4 profile saved (2 education entries, 2 work modes, 2 employment types)', await waitFor(old, `document.querySelector('[role=status]').textContent === 'Profile saved'`));
  const taughtOld = await old.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/save-mapping', payload: { field: { id: 'id:pref', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, signals: { htmlId: 'pref', name: 'q_17', label: 'Preferred Working Location' } }, profileField: 'city' } }).then((r) => r.ok)`);
  check('Phase 4 taught mapping saved', taughtOld === true);
  const storedV1 = JSON.parse(await old.evaluate(readStoredProfile));
  check('stored as schema version 1', storedV1.schemaVersion === 1 && storedV1.education.length === 2 && storedV1.preferences.workModes.length === 2);
  await shutdown();

  // Upgrade in place: same extension directory → same extension id → same IndexedDB.
  rmSync(extDir, { recursive: true, force: true });
  cpSync(DIST, extDir, { recursive: true });
  await launch(userDataDir);
  const upgraded = await send('Extensions.loadUnpacked', { path: extDir });
  check('upgraded extension keeps its id', upgraded.id === id);
  const page = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(page, `document.querySelectorAll('form section').length >= 9`);
  const shown = await page.evaluate(editorGetAll(['First name', 'Last name', 'Email', 'City', 'Current company', 'Institution', 'Highest degree', 'Graduation year', 'Work mode', 'Employment type']));
  check('migrated values shown in the editor', shown === JSON.stringify(['Jane', 'Doe', 'jane.doe@example.com', 'Springfield', 'Example Co', 'Example University', 'MSc', '2021', 'remote', 'full-time']), shown);
  const legacy = await page.evaluate(`document.querySelector('.legacy')?.innerText ?? ''`);
  const second = await page.evaluate(`JSON.stringify([...([...document.querySelectorAll('.record')].find((r) => r.querySelector('h3')?.textContent === 'Education 2')?.querySelectorAll('input') ?? [])].map((i) => i.value))`);
  // Phase 10: the second version 1 education entry is now Education 2 (a record), not legacy.
  check('extra entries preserved and shown, not dropped', second.includes('First College') && second.includes('BSc') && legacy.includes('Work mode · hybrid') && legacy.includes('Employment type · contract'), `${second} | ${legacy.replace(/\n/g, ' | ')}`);
  const workerKeyBefore = await page.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/map-fields', payload: { fields: [{ id: 'id:w', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, signals: { htmlId: 'w', label: 'Website' } }] } }).then((r) => r.ok ? r.data.mappings[0].profileField : r.error)`);
  console.log('      service worker maps "Website" to (after restart with new files): ' + workerKeyBefore);
  check('loading alone did not rewrite storage', JSON.parse(await page.evaluate(readStoredProfile)).schemaVersion === 1);
  const mappings = JSON.parse(await page.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/list-mappings' }).then((r) => JSON.stringify(r))`));
  check('saved mappings survive the upgrade', mappings.ok && mappings.data.mappings.length === 1 && mappings.data.mappings[0].profileField === 'city');
  check('saved mapping visible in the management view', await waitFor(page, `document.querySelector('.mapping-list')?.innerText.includes('City (location.city)')`));
  check('save after upgrade', await saveEditor(page));
  const storedV2 = JSON.parse(await page.evaluate(readStoredProfile));
  check('stored as the current version (4) with every entry kept', storedV2.schemaVersion === 4 && storedV2.education[0].institution === 'Example University' && storedV2.education[1].institution === 'First College' && storedV2.legacy.workModes[0] === 'hybrid' && storedV2.preferences.workMode === 'remote');
  await page.send('Page.reload');
  await waitFor(page, `document.querySelectorAll('form section').length >= 9`);
  const reshown = await page.evaluate(editorGetAll(['First name', 'Institution', 'Work mode']));
  check('load again after save: values unchanged', reshown === JSON.stringify(['Jane', 'Example University', 'remote']) && (await page.evaluate(`!!document.querySelector('.legacy')`)));

  const workerStatusAfterSave = await page.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/get-profile-status' }).then((r) => JSON.stringify(r))`);
  console.log('      service worker profile status after saving v2: ' + workerStatusAfterSave);
  // Reload the unpacked extension (what the reload button in chrome://extensions does).
  await send('Extensions.loadUnpacked', { path: extDir });
  await sleep(1000);
  const page3 = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(page3, `document.querySelectorAll('form section').length >= 9`);
  const workerKeyAfter = await page3.evaluate(`chrome.runtime.sendMessage({ type: 'applyonce/map-fields', payload: { fields: [{ id: 'id:w', type: 'text', htmlType: 'text', required: false, visible: true, disabled: false, signals: { htmlId: 'w', label: 'Website' } }] } }).then((r) => r.ok ? r.data.mappings[0].profileField : r.error)`);
  console.log('      service worker maps "Website" to (after extension reload): ' + workerKeyAfter);
  check('after an extension reload, the Phase 5 service worker is running', workerKeyAfter === 'website_url');
  const teachTab = await open(`${ORIGIN}/teach.html`);
  await waitFor(teachTab, `document.readyState === 'complete'`);
  popup = await openPopupFor(id, teachTab);
  const teachText = await analyze(popup);
  console.log('      teach page popup: ' + teachText.replace(/\n+/g, ' | ').slice(0, 300));
  const pref = await item(popup, 'Preferred Working Location');
  check('Phase 4 taught mapping still applies after upgrade', pref.mapping === '→ City (location.city) · Taught by you', JSON.stringify(pref));
  await popup.evaluate(`t.toggle('Preferred Working Location'); true`);
  await sleep(100);
  await fill(popup);
  const tv = await pageValues(teachTab);
  check('existing browser flow works after upgrade (fill)', tv.pref === 'Springfield' && tv.first === 'Jane');
  await shutdown();
} catch (error) {
  check('run completed', false, String(error));
  chrome?.kill();
} finally {
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
