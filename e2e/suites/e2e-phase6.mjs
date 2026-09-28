// Phase 6 verification in real Chrome via the DevTools pipe. Fake data only.
import { mkdirSync as e2eMkdir } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

// Repo-relative paths: suites live in e2e/suites, output goes to e2e/.out (git-ignored).
const E2E = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(E2E, '..');
const SCRATCH = join(E2E, '.out');
e2eMkdir(SCRATCH, { recursive: true });
const DIST = join(ROOT, 'apps/chrome-extension/dist');
const PHASE5_DIST = join(SCRATCH, 'builds/b3f8f10/apps/chrome-extension/dist');
const FW = join(SCRATCH, 'fixtures/fw');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P = {
  linkedin: 'https://www.linkedin.com/in/jane-doe-example',
  github: 'https://github.com/jane-doe-example',
  portfolio: 'https://jane-doe.example.dev/work',
  website: 'https://jane.example.com',
  auth: 'Authorized to work in Canada',
};

// ---------------- Plain HTML fixture (same form as the framework fixtures + extras) ----------------
const PLAIN = `<!doctype html><html><head><title>Plain Application Form</title></head><body>
<form id="app">
  <div class="field"><label for="first">First Name *</label><input id="first" name="firstName"></div>
  <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" name="email"></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" name="phone"></div>
  <div class="field"><label for="years">Years of Experience</label><input id="years" type="number" name="years"></div>
  <div class="field"><label for="city">City</label><input id="city" name="city" value="Prefilled Town"></div>
  <div class="field"><label for="linkedin">LinkedIn URL</label><input id="linkedin" type="url" name="linkedin"></div>
  <div class="field" id="github-field"><label for="github">GitHub</label><input id="github" type="url" name="github"></div>
  <div class="field" id="portfolio-field"><label for="portfolio">Portfolio</label><input id="portfolio" type="url" name="portfolio"></div>
  <div class="field"><label for="mode">Work Mode</label>
    <select id="mode" name="mode"><option value="">Select…</option><option value="r">Remote</option><option value="h">Hybrid</option><option value="o">On site</option></select></div>
  <fieldset><legend>Employment Type</legend>
    <label><input type="radio" name="etype" value="ft"> Full time</label>
    <label><input type="radio" name="etype" value="pt"> Part time</label>
    <label><input type="radio" name="etype" value="c"> Contract</label>
  </fieldset>
  <label><input type="checkbox" name="relocate"> Willing to relocate</label>
  <div class="field"><label for="cover">Why do you want to work here?</label><textarea id="cover" name="cover"></textarea></div>
  <div class="field"><label for="company">Company</label><input id="company" name="company"></div>
  <div class="field"><label for="referral">Referral code</label><input id="referral" name="referral"></div>
  <fieldset><legend>Preferred locations</legend>
    <label><input type="checkbox" name="loc" value="Ahmedabad"> Ahmedabad</label>
    <label><input type="checkbox" name="loc" value="Mumbai"> Mumbai</label>
    <label><input type="checkbox" name="loc" value="Bengaluru"> Bengaluru</label>
  </fieldset>
  <div id="postal-slot"></div>

  <h3>Extras (plain page only)</h3>
  <div class="field"><label>Full Name (required)</label><div class="control"><input name="q_full"></div></div>
  <div class="field"><span id="ln">Last name</span><span id="ln-mark" aria-hidden="true">*</span><input name="q_last" aria-labelledby="ln ln-mark"></div>
  <div class="field"><input name="q_addr" autocomplete="street-address"></div>
  <div class="field"><label for="st">State - required</label><input id="st" name="st"></div>
  <div class="field"><label for="country">Country</label><select id="country" name="country"><option value="">Select…</option><option value="IN">India</option><option value="CA">Canada</option></select></div>
  <div class="field"><label for="ro">Country of residence</label><input id="ro" name="ro" readonly></div>
  <div class="field"><label for="web">Website</label><input id="web" type="url" name="web"></div>
  <div class="field"><label for="jt">Current Job Title</label><input id="jt" name="jt"></div>
  <div class="field"><label for="cc">Current Company</label><input id="cc" name="cc"></div>
  <div class="field"><label for="deg">Highest Degree</label><select id="deg" name="deg"><option value="">Select…</option><option value="b">Bachelor's</option><option value="m">Master's</option></select></div>
  <div class="field"><label for="fos">Field of Study</label><input id="fos" name="fos"></div>
  <div class="field"><label for="uni">University</label><input id="uni" name="uni"></div>
  <div class="field"><label for="gy">Graduation Year</label><input id="gy" type="number" name="gy"></div>
  <div class="field"><label for="wa">Work Authorization</label><input id="wa" name="wa"></div>
  <div class="field"><label for="np">Notice Period</label><select id="np" name="np"><option value="">Select…</option><option>30 days</option><option selected>60 days</option></select></div>
  <fieldset><legend>Will you require visa sponsorship?</legend>
    <label><input type="radio" name="sponsor" value="yes"> Yes</label>
    <label><input type="radio" name="sponsor" value="no" checked> No</label>
  </fieldset>

  <button type="button" id="remove-github">Remove GitHub</button>
  <button type="button" id="replace-portfolio">Replace portfolio</button>
  <button type="button" id="add-postal">Add postal code</button>
  <button type="submit">Submit application</button>
</form>
<pre id="state"></pre><p id="submitted">false</p>
<script>
  const $ = (s) => document.querySelector(s);
  const val = (s) => $(s)?.value ?? '';
  function state() {
    return {
      firstName: val('#first'), email: val('#email'), phone: val('#phone'), years: val('#years'), city: val('#city'),
      linkedin: val('#linkedin'), github: val('#github'), portfolio: val('#portfolio'), postal: val('#postal'),
      mode: val('#mode'), etype: $('input[name=etype]:checked')?.value ?? '', relocate: $('input[name=relocate]').checked,
      cover: val('#cover'), company: val('#company'), referral: val('#referral'),
      locations: [...document.querySelectorAll('input[name=loc]:checked')].map((c) => c.value),
    };
  }
  const render = () => { $('#state').textContent = JSON.stringify(state()); };
  document.addEventListener('input', render);
  document.addEventListener('change', render);
  render();
  $('#remove-github').onclick = () => { $('#github-field').remove(); render(); };
  $('#replace-portfolio').onclick = () => { const old = $('#portfolio-field'); old.replaceWith(old.cloneNode(true)); render(); };
  $('#add-postal').onclick = () => { $('#postal-slot').innerHTML = '<div class="field"><label for="postal">Postal Code</label><input id="postal" name="postal"></div>'; render(); };
  $('#app').addEventListener('submit', (e) => { e.preventDefault(); $('#submitted').textContent = 'true'; });
</script>
</body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/plain/' || url.pathname === '/plain.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PLAIN);
  }
  const match = url.pathname.match(/^\/(react|vue|angular)\/(.*)$/);
  if (match) {
    const file = join(FW, `${match[1]}-app/dist`, match[2] || 'index.html');
    if (existsSync(file)) {
      res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'text/html; charset=utf-8' });
      return res.end(readFileSync(file));
    }
  }
  res.writeHead(404);
  res.end();
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

const COMMON_NAMES = ['First Name *', 'Email', 'Phone', 'Years of Experience', 'City', 'LinkedIn URL', 'GitHub', 'Portfolio', 'Work Mode', 'Employment Type', 'Willing to relocate', 'Why do you want to work here?', 'Company', 'Referral code', 'Ahmedabad', 'Mumbai', 'Bengaluru'];
const PRESELECTED = ['First Name *', 'Email', 'Phone', 'Years of Experience', 'City', 'LinkedIn URL', 'GitHub', 'Portfolio', 'Work Mode', 'Employment Type', 'Willing to relocate'];
const EXPECTED_MAPPINGS = {
  'First Name *': '→ First name (identity.firstName) · Automatic · High confidence',
  Email: '→ Email (contact.email) · Automatic · High confidence',
  Phone: '→ Phone (contact.phone) · Automatic · High confidence',
  'Years of Experience': '→ Years of experience (experience.totalExperienceYears) · Automatic · High confidence',
  'LinkedIn URL': '→ LinkedIn (links.linkedin) · Automatic · High confidence',
  'Work Mode': '→ Work mode (preferences.workMode) · Automatic · High confidence',
  'Employment Type': '→ Employment type (preferences.employmentType) · Automatic · High confidence',
  'Willing to relocate': '→ Willing to relocate (preferences.openToRelocation) · Automatic · High confidence',
  Company: '→ Current company (experience.currentCompany) · Automatic · Low confidence',
  'Referral code': 'No match',
  Mumbai: 'No match',
};

async function runFormSuite(label, url, id, { extras = false } = {}) {
  const tab = await open(url);
  const ready = await waitFor(tab, `!!document.querySelector('#state') && document.querySelectorAll('input').length > 10`);
  if (!ready) {
    const error = await tab.evaluate(`document.body.innerText.slice(0, 300)`).catch(() => '');
    check(`${label}: fixture renders`, false, error);
    return;
  }
  const stateBefore = await readState(tab);
  const domBefore = await domValues(tab);
  let popup = await openPopupFor(id, tab);
  const text = await analyze(popup);
  const names = await popup.evaluate('t.items()');
  const commonDetected = COMMON_NAMES.every((n) => names.includes(n));
  check(`${label}: 1. Analyze detects expected fields`, commonDetected && (extras || names.length === 17), extras ? `${names.length} fields` : names.join(', '));
  check(`${label}: 2. Analyze does not modify the page or framework state`, JSON.stringify(await readState(tab)) === JSON.stringify(stateBefore) && (await domValues(tab)) === domBefore);
  const review = {};
  for (const n of names) review[n] = await item(popup, n);
  const wrong = Object.entries(EXPECTED_MAPPINGS).filter(([n, m]) => review[n]?.mapping !== m);
  check(`${label}: 3. deterministic mappings`, wrong.length === 0, wrong.map(([n]) => `${n}=${review[n]?.mapping}`).join('; '));
  const pre = COMMON_NAMES.filter((n) => review[n]?.checked);
  check(`${label}: 4. high-confidence fields pre-selected as before`, JSON.stringify(pre) === JSON.stringify(PRESELECTED), pre.join(', '));
  check(`${label}: 5. review field not silently selected`, review.Company?.checked === false && review.Company?.disabled === false);
  check(`${label}: 6. unknown fields and checkbox-group options not selectable`, ['Why do you want to work here?', 'Referral code', 'Ahmedabad', 'Mumbai', 'Bengaluru'].every((n) => review[n]?.disabled));

  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  // 13/14: the page removes one field and re-renders another as a new element.
  await tab.evaluate(`document.getElementById('remove-github').click(); document.getElementById('replace-portfolio').click(); true`);
  await sleep(300);
  const portfolioIsNewNode = await tab.evaluate(`document.getElementById('portfolio').isConnected`);
  const summary = await fill(popup);
  const s = await readState(tab);
  if (!extras) {
    check(`${label}: 7. explicit Fill summary`, summary === '9 fields filled · 1 skipped · 1 failed · 1 need review', summary);
  }
  check(`${label}: 12. framework state received the values`, s.firstName === 'Jane' && s.email === 'jane.doe@example.com' && s.phone === '+1 555 010 0199' && String(s.years) === '7' && s.linkedin === P.linkedin, JSON.stringify(s));
  check(`${label}: 8. existing value preserved`, s.city === 'Prefilled Town' && (await item(popup, 'City')).note.startsWith('Skipped'));
  check(`${label}: 9. select normalization ("On site" = onsite)`, s.mode === 'o');
  check(`${label}: 10. radio group`, s.etype === 'c');
  check(`${label}: 11. boolean checkbox`, s.relocate === true);
  check(`${label}: 6. unknown/review/group fields untouched`, s.cover === '' && s.company === '' && s.referral === '' && JSON.stringify(s.locations) === '[]');
  check(`${label}: 13. removed field reported safely`, (await item(popup, 'GitHub')).note === 'Not found. The field is no longer on the page.');
  check(`${label}: 14. replaced field filled`, portfolioIsNewNode && s.portfolio === P.portfolio && (await item(popup, 'Portfolio')).note.startsWith('Filled'));
  check(`${label}: 16. not submitted`, (await tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  const recorded = await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id);
  const pageState = JSON.parse(await tab.evaluate(`JSON.stringify({ html: document.documentElement.outerHTML, local: Object.keys(localStorage), session: Object.keys(sessionStorage), globals: Object.keys(window).filter((k) => /applyonce/i.test(k)) })`));
  const leaked = extras ? [] : [P.website, P.auth, 'Staff Engineer', 'Example University'].filter((v) => recorded.includes(v) || pageState.html.includes(v));
  check(`${label}: 17. only approved values reached the page; nothing in globals/storage`, leaked.length === 0 && !recorded.includes('schemaVersion') && !recorded.includes('savedMappings') && pageState.local.length === 0 && pageState.session.length === 0 && pageState.globals.length === 0, leaked.join(', '));

  if (extras) await checkExtras(tab, popup);

  // 15: the page changes; a new analysis reflects the current page.
  await popup.evaluate(`t.toggle('Email'); true`); // an approval that must not carry over
  await tab.evaluate(`document.getElementById('add-postal').click(); true`);
  await sleep(300);
  await analyze(popup);
  const names2 = await popup.evaluate('t.items()');
  const postal = await item(popup, 'Postal Code');
  check(`${label}: 15. re-analysis: removed field gone, new field present, approvals recalculated`, !names2.includes('GitHub') && names2.includes('Postal Code') && postal?.checked === true && (await item(popup, 'Email')).checked === true, names2.length + ' fields');
  await fill(popup);
  const s2 = await readState(tab);
  check(`${label}: 15. new field fillable; earlier values not overwritten`, s2.postal === 'M5V 2T6' && s2.firstName === 'Jane' && s2.city === 'Prefilled Town' && (await item(popup, 'First Name *')).note.startsWith('Skipped'));
  if (label === 'React') {
    const shot = await popup.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SCRATCH, 'phase6-react.png'), Buffer.from(shot.data, 'base64'));
  }
  await popup.close();
  await tab.close();
}

async function checkExtras(tab, popup) {
  const v = JSON.parse(await tab.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('input, select')].filter((e) => e.name).map((e) => [e.type === 'radio' ? e.name + ':' + e.value : e.name, e.type === 'radio' || e.type === 'checkbox' ? e.checked : e.value])))`));
  const expectations = {
    'wrapper label + "(required)" → full name': v.q_full === 'Jane Q. Doe',
    'aria-labelledby with decorative mark → last name': v.q_last === 'Doe',
    'autocomplete-only field → address': v.q_addr === '1 Example Street',
    '"- required" marker → state': v.st === 'Ontario',
    'country select (label match)': v.country === 'CA',
    website: v.web === P.website,
    'current title': v.jt === 'Staff Engineer',
    'current company': v.cc === 'Example Co',
    "highest degree select (Master's)": v.deg === 'm',
    'field of study': v.fos === 'Physics',
    institution: v.uni === 'Example University',
    'graduation year (number)': v.gy === '2019',
    'work authorization': v.wa === P.auth,
    'pre-selected option not overwritten': v.np === '60 days' && (await item(popup, 'Notice Period')).note.startsWith('Skipped'),
    'read-only field untouched': v.ro === '' && (await item(popup, 'Country of residence')).note === 'Read-only field. Will not be filled.',
  };
  for (const [name, ok] of Object.entries(expectations)) check(`Plain HTML: profile/detection: ${name}`, ok);
  // A pre-checked radio is an existing answer, even when explicitly approved.
  const sponsor = 'Will you require visa sponsorship?';
  check('Plain HTML: sponsorship radio is review-level, not pre-selected', (await item(popup, sponsor)).checked === false);
  await popup.evaluate(`t.toggle(${JSON.stringify(sponsor)}); true`);
  await sleep(100);
  await fill(popup);
  const after = JSON.parse(await tab.evaluate(`JSON.stringify([...document.querySelectorAll('input[name=sponsor]')].map((r) => r.checked))`));
  check('Plain HTML: pre-checked radio never switched, even when approved', JSON.stringify(after) === '[false,true]' && (await item(popup, sponsor)).note === 'Skipped. The field already has a value.');
}

try {
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')));
  const { id } = await send('Extensions.loadUnpacked', { path: DIST });

  // Fake profile covering every Phase 5 field.
  const editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(editorSet({
    'First name': 'Jane', 'Last name': 'Doe', 'Full name': 'Jane Q. Doe', Email: 'jane.doe@example.com', Phone: '+1 555 010 0199',
    Address: '1 Example Street', City: 'Springfield', 'State / province': 'Ontario', 'Postal code': 'M5V 2T6', Country: 'Canada',
    LinkedIn: P.linkedin, GitHub: P.github, Portfolio: P.portfolio, Website: P.website,
    'Current job title': 'Staff Engineer', 'Current company': 'Example Co', 'Years of experience': '7', 'Notice period': '30 days',
    'Work mode': 'onsite', 'Employment type': 'contract', 'Willing to relocate': 'yes',
    'Highest degree': "Master's", 'Field of study': 'Physics', Institution: 'Example University', 'Graduation year': '2019',
    'Work authorization': P.auth, 'Requires visa sponsorship': 'yes',
  }));
  await sleep(100);
  await editor.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  check('profile with all Phase 5 fields saved', await waitFor(editor, `document.querySelector('.save-bar [role=status]')?.textContent === 'Profile saved'`));

  await runFormSuite('Plain HTML', `${ORIGIN}/plain/`, id, { extras: true });
  await runFormSuite('React', `${ORIGIN}/react/`, id);
  await runFormSuite('Vue', `${ORIGIN}/vue/`, id);
  await runFormSuite('Angular', `${ORIGIN}/angular/`, id);

  // ---------------- Teach Once regression ----------------
  let tab = await open(`${ORIGIN}/plain/`);
  await waitFor(tab, `!!document.querySelector('#state')`);
  let popup = await openPopupFor(id, tab);
  await analyze(popup);
  await teach(popup, 'Referral code', 'notice_period');
  let referral = await item(popup, 'Referral code');
  check('Teach: unknown → taught, unticked', referral.mapping === '→ Notice period (experience.noticePeriod) · Taught by you' && !referral.checked);
  await analyze(popup);
  check('Teach: Analyze again shows "Taught by you"', (await item(popup, 'Referral code')).mapping.endsWith('Taught by you'));
  await teach(popup, 'Referral code', 'current_company');
  check('Teach: change mapping', (await item(popup, 'Referral code')).mapping === '→ Current company (experience.currentCompany) · Taught by you');
  await popup.close();
  await tab.close();

  tab = await open(`${ORIGIN}/vue/`);
  await waitFor(tab, `document.querySelectorAll('input').length > 10`);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  check('Teach: same question on another page (Vue) is recognized', (await item(popup, 'Referral code')).mapping === '→ Current company (experience.currentCompany) · Taught by you');
  await popup.close();

  // An incompatible saved mapping (injected directly into storage, bypassing validation).
  const injected = await editor.evaluate(`new Promise((resolve, reject) => {
    const r = indexedDB.open('applyonce');
    r.onsuccess = () => {
      const store = r.result.transaction('records', 'readwrite').objectStore('records');
      const get = store.get('savedMappings');
      get.onsuccess = () => {
        const record = get.result;
        record.mappings.push({ key: 'v1|checkbox|q=willing to relocate|c=|i=', parts: { fieldType: 'checkbox', question: 'willing to relocate' }, profileField: 'email', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' });
        store.put(record, 'savedMappings').onsuccess = () => resolve(record.mappings.length);
      };
    };
    r.onerror = reject;
  })`);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  check('Teach: incompatible saved mapping ignored, automatic mapping used', injected === 2 && (await item(popup, 'Willing to relocate')).mapping === '→ Willing to relocate (preferences.openToRelocation) · Automatic · High confidence');
  await popup.close();

  const manage = await open(`chrome-extension://${id}/profile.html#saved-mappings`);
  await waitFor(manage, `document.querySelectorAll('.mapping-list li').length === 2`);
  await manage.evaluate(`[...document.querySelectorAll('.mapping-list li')].find((li) => li.innerText.includes('referral code')).querySelector('button').click(); true`);
  await waitFor(manage, `document.querySelectorAll('.mapping-list li').length === 1`);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  referral = await item(popup, 'Referral code');
  check('Teach: deleting the mapping restores automatic behavior', referral.mapping === 'No match' && referral.disabled);
  await popup.close();

  // Content scripts still cannot reach profile or mapping storage, or the build id.
  const attempts = await tab.evaluate(`Promise.all(['get-profile', 'list-mappings', 'clear-mappings', 'get-runtime-info', 'map-fields'].map((t) => chrome.runtime.sendMessage({ type: 'applyonce/' + t, ...(t === 'map-fields' ? { payload: { fields: [] } } : {}) }))).then((r) => JSON.stringify(r))`, isolatedWorld(tab).id);
  check('privacy: content script refused profile, mappings, runtime info', attempts === JSON.stringify(Array(5).fill({ ok: false, error: 'forbidden' })), attempts);
  await shutdown();

  // ---------------- Stale service worker (real upgrade from the Phase 5 build) ----------------
  if (!existsSync(PHASE5_DIST)) throw new Error('Phase 5 build missing');
  const userDataDir = mkdtempSync(join(SCRATCH, 'chrome-stale-'));
  const extDir = join(SCRATCH, 'ext-stale');
  rmSync(extDir, { recursive: true, force: true });
  cpSync(PHASE5_DIST, extDir, { recursive: true });
  await launch(userDataDir);
  const first = await send('Extensions.loadUnpacked', { path: extDir });
  const old = await open(`chrome-extension://${first.id}/profile.html`);
  await waitFor(old, `document.querySelectorAll('form section').length >= 9`);
  await old.evaluate(editorSet({ 'First name': 'Jane', Email: 'jane.doe@example.com' }));
  await sleep(100);
  await old.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  await waitFor(old, `document.querySelector('.save-bar [role=status]')?.textContent === 'Profile saved'`);
  await shutdown();

  rmSync(extDir, { recursive: true, force: true });
  cpSync(DIST, extDir, { recursive: true });
  await launch(userDataDir);
  const upgraded = await send('Extensions.loadUnpacked', { path: extDir });
  tab = await open(`${ORIGIN}/plain/`);
  await waitFor(tab, `!!document.querySelector('#state')`);
  popup = await openPopupFor(upgraded.id, tab);
  const stale = await analyze(popup);
  const message = await popup.evaluate(`document.querySelector('.message.error')?.textContent ?? ''`);
  check('stale worker: clear "ApplyOnce was updated. Reload the extension" message', message.startsWith('ApplyOnce was updated. Reload the extension') && !stale.includes('profile could not be loaded'), message);
  check('stale worker: page untouched (no scan, no injection)', (await tab.evaluate(`typeof globalThis.chrome?.runtime?.id`)) !== 'string' && (await readState(tab)).firstName === '');
  await popup.close();
  await send('Extensions.loadUnpacked', { path: extDir }); // what the reload icon does
  await sleep(1000);
  popup = await openPopupFor(upgraded.id, tab);
  const reloaded = await analyze(popup);
  check('after reload: build handshake passes and analysis works', reloaded.includes('fields detected'), reloaded.split('\n').slice(4, 6).join(' | '));
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
