// Phase 8 (Workday adapter) verification in real Chrome via the DevTools pipe. Fake data only.
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
const REAL_WORKDAY = 'https://workday.wd5.myworkdayjobs.com/Workday';

// Observed chrome of a real Workday candidate site (header, navigation, footer).
const HEADER = `<div data-automation-id="header"><div data-automation-id="navigationContainer"><div data-automation-id="utilityButtonBar">
  <div data-automation-id="utilityButtonBarLanguageMenu"><button type="submit" id="languageSelectorButton" data-automation-id="utilityMenuButton" aria-haspopup="listbox">English</button></div>
  <a data-automation-id="utilityButtonSignIn" href="#">Sign In</a></div></div></div>`;
const FOOTER = `<div data-automation-id="footerContainer"><a data-automation-id="privacyLink" href="#">Privacy</a></div>`;

const WORKDAY_STEP = `<!doctype html><html lang="en-US"><head><title>Careers - Apply</title></head><body>
${HEADER}
<form id="page-form">
<div data-automation-id="applyFlowPage">
  <h2 data-automation-id="jobTitleHeading">Software Engineer</h2>
  <div data-automation-id="progressBar"><div data-automation-id="progressBarActiveStep">My Information</div><div data-automation-id="progressBarInactiveStep">My Experience</div></div>
  <div id="step"></div>
  <button type="button" data-automation-id="pageFooterBackButton" id="back">Back</button>
  <button type="button" data-automation-id="pageFooterNextButton" id="next">Save and Continue</button>
</div>
</form>
<button type="button" id="rerender">Re-render step</button>
${FOOTER}
<pre id="state"></pre><p id="nav">0</p><p id="submitted">false</p>
<script>
  let gen = 0; const nextId = () => 'input-' + (++gen);
  const state = {};
  const render = () => { document.getElementById('state').textContent = JSON.stringify(state); };
  const text = (auto, label, attrs = '') => { const id = nextId(); return '<div data-automation-id="formField-' + auto + '"><label for="' + id + '">' + label + '<abbr title="required">*</abbr></label><input type="text" id="' + id + '" data-automation-id="' + auto + '" data-uxi-widget-type="inputField" ' + attrs + '></div>'; };
  const dropdown = (auto, label) => '<div data-automation-id="formField-' + auto + '"><label id="' + auto + '-label">' + label + '</label><button type="button" data-automation-id="' + auto + '" aria-haspopup="listbox" aria-expanded="false" aria-controls="' + auto + '-list" aria-labelledby="' + auto + '-label">Select One</button><input type="text" data-automation-id="' + auto + '-helper" style="display:none"></div>';
  const LISTS = {
    countryDropdown: ['India', 'Canada', 'United States'],
    sourceDropdown: ['LinkedIn', 'Referral', 'Job Board'],
    degreeDropdown: ["Bachelor's", "Master's", 'PhD'],
  };
  function build() {
    document.getElementById('step').innerHTML = [
      text('legalName-firstName', 'First Name'),
      '<div data-automation-id="formField-legalName-lastName"><span id="' + crypto.randomUUID() + '" class="ln">Last Name</span><input type="text" data-automation-id="legalName-lastName"></div>',
      text('email', 'Email Address', 'value="kept@example.com"'),
      text('phone-number', 'Phone Number'),
      text('addressLine1', 'Address Line 1'),
      text('city', 'City'),
      text('postalCode', 'Postal Code'),
      dropdown('countryDropdown', 'Country'),
      dropdown('sourceDropdown', 'How Did You Hear About Us?'),
      text('customQuestion-office', 'Preferred Office Location'),
      '<fieldset data-automation-id="formField-sponsorship"><legend>Will you require visa sponsorship?</legend><label><input type="radio" name="questionId-7" value="1"> Yes</label><label><input type="radio" name="questionId-7" value="0"> No</label></fieldset>',
      '<div data-automation-id="formField-relocate"><label><input type="checkbox" data-automation-id="relocate"> Willing to relocate</label></div>',
      '<div data-automation-id="formField-veteran"><label><input type="checkbox" data-automation-id="veteranStatus"> I identify as a protected veteran</label></div>',
      '<div data-automation-id="workExperienceSection">' + [1, 2].map((n) => '<div data-automation-id="workExperience-' + n + '"><h4>Work Experience ' + n + '</h4>' + text('jobTitle', 'Job Title') + text('company', 'Company') + '</div>').join('') + '</div>',
      text('currentJobTitle', 'Current Job Title'),
      text('currentCompany', 'Current Company'),
      '<div data-automation-id="educationSection"><div data-automation-id="education-1">' + text('school', 'University', 'aria-autocomplete="list"') + dropdown('degreeDropdown', 'Degree') + text('fieldOfStudy', 'Field of Study') + '</div></div>',
      '<div data-automation-id="file-upload-drop-zone"><label for="resume">Resume/CV</label><input type="file" id="resume" data-automation-id="file-upload-input-ref"></div>',
    ].join('');
    document.querySelectorAll('.ln').forEach((span) => span.nextElementSibling.setAttribute('aria-labelledby', span.id));
    document.querySelectorAll('#step input').forEach((input) => {
      const key = input.getAttribute('data-automation-id') ?? input.name;
      const sync = () => { state[key + (input.type === 'radio' ? ':' + input.value : '')] = input.type === 'checkbox' || input.type === 'radio' ? input.checked : input.value; render(); };
      input.addEventListener('input', sync); input.addEventListener('change', sync); sync();
    });
    for (const [auto, options] of Object.entries(LISTS)) {
      const trigger = document.querySelector('[data-automation-id="' + auto + '"]');
      state[auto] = ''; render();
      trigger.addEventListener('click', () => {
        if (trigger.getAttribute('aria-expanded') === 'true') return;
        trigger.setAttribute('aria-expanded', 'true');
        const list = document.createElement('ul');
        list.id = auto + '-list'; list.setAttribute('role', 'listbox'); list.setAttribute('data-automation-id', 'activeListContainer');
        document.body.append(list);
        setTimeout(() => {
          for (const label of options) {
            const li = document.createElement('li');
            li.setAttribute('role', 'option'); li.setAttribute('data-automation-id', 'promptOption'); li.textContent = label;
            li.addEventListener('click', () => { trigger.textContent = label; state[auto] = label; render(); close(); });
            list.append(li);
          }
        }, 200);
        const close = () => { trigger.setAttribute('aria-expanded', 'false'); list.remove(); };
        trigger.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { once: true });
      });
    }
  }
  build();
  for (const id of ['back', 'next']) document.getElementById(id).addEventListener('click', () => { document.getElementById('nav').textContent = String(Number(document.getElementById('nav').textContent) + 1); });
  document.getElementById('page-form').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
  document.getElementById('rerender').addEventListener('click', () => {
    const values = { ...state };
    build();
    // Re-rendered with new generated ids; entered values are restored as Workday would.
    document.querySelectorAll('#step input[type=text]').forEach((i) => { const k = i.getAttribute('data-automation-id'); if (values[k]) { i.value = values[k]; state[k] = values[k]; } });
    render();
  });
</script></body></html>`;

const PAGES = {
  '/workday/apply': WORKDAY_STEP,
  '/generic/workday-word': `<!doctype html><title>Our HR stack</title><body><h1>We use Workday for payroll</h1><p>Workday, workday, WORKDAY.</p><form><label for="n">Full Name</label><input id="n" name="name"></form></body>`,
  '/generic/form': `<!doctype html><title>Contact</title><body><form><label for="f">First Name</label><input id="f" name="first"><label for="e">Email</label><input id="e" type="email" name="email"></form></body>`,
  '/generic/ambiguous': `<!doctype html><title>Ambiguous</title><body>${Array.from({ length: 12 }, (_, i) => `<div data-automation-id="widget-${i}"></div>`).join('')}<form><label for="f">First Name</label><input id="f" name="first"></form></body>`,
};

const server = createServer((req, res) => {
  const page = PAGES[new URL(req.url, 'http://x').pathname];
  res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page ?? '');
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

const OPEN_LISTBOXES = `[...document.querySelectorAll('[role=listbox]')].filter((l) => l.checkVisibility()).length`;
const hi = (target) => `→ ${target} · Automatic · High confidence`;
const WORKDAY_NOTE = 'Workday page: ApplyOnce fills the current step only. Move to the next step yourself, then analyze again.';
const stepSnapshot = (tab) => tab.evaluate(`JSON.stringify({ state: document.getElementById('state').textContent, nav: document.getElementById('nav').textContent, open: ${OPEN_LISTBOXES} })`);
const stepState = async (tab) => JSON.parse(JSON.parse(await stepSnapshot(tab)).state);
const platformNote = (popup) => popup.evaluate(`[...document.querySelectorAll('.analysis .note')].map((n) => n.textContent).find((t) => /page/.test(t)) ?? ''`);

try {
  const HOST = 'acme.wd1.myworkdayjobs.com';
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')), [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`]);
  const { id } = await send('Extensions.loadUnpacked', { path: DIST });
  const editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(editorSet({
    'First name': 'Jane', 'Last name': 'Doe', Email: 'jane.doe@example.com', Phone: '+1 555 010 0199',
    Address: '1 Example Street', City: 'Springfield', 'State / province': 'Ontario', 'Postal code': 'M5V 2T6', Country: 'Canada',
    LinkedIn: 'https://www.linkedin.com/in/jane-doe-example', Website: 'https://jane.example.com',
    'Current job title': 'Staff Engineer', 'Current company': 'Example Co', 'Willing to relocate': 'yes',
    'Highest degree': "Master's", 'Field of study': 'Physics', Institution: 'Example University',
    'Work authorization': 'Authorized to work in Canada', 'Requires visa sponsorship': 'yes',
  }));
  await sleep(100);
  await editor.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  check('profile saved', await waitFor(editor, `document.querySelector('.save-bar [role=status]')?.textContent === 'Profile saved'`));

  // =================== Platform detection ===================
  for (const [label, url, expectWorkday] of [
    ['B. Workday DOM on a custom URL', `${ORIGIN}/workday/apply`, true],
    ['C. generic page mentioning "Workday"', `${ORIGIN}/generic/workday-word`, false],
    ['D. generic form', `${ORIGIN}/generic/form`, false],
    ['E. ambiguous page (automation ids only)', `${ORIGIN}/generic/ambiguous`, false],
  ]) {
    const tab = await open(url);
    await waitFor(tab, `document.readyState === 'complete' && document.querySelectorAll('input').length > 0`);
    const popup = await openPopupFor(id, tab);
    await analyze(popup);
    const note = await platformNote(popup);
    const names = await popup.evaluate('t.items()');
    check(`detection ${label} → ${expectWorkday ? 'Workday' : 'generic'}`, expectWorkday ? note === WORKDAY_NOTE : note === '', note || names.join(', '));
    if (!expectWorkday) check(`detection ${label}: generic adapter still detects fields`, names.length > 0 && !names.includes('English'), names.join(', '));
    await popup.close();
    await tab.close();
  }
  const hostTab = await open(`http://${HOST}:${PORT}/generic/form`);
  const reached = await waitFor(hostTab, `location.hostname === '${HOST}' && document.querySelectorAll('input').length > 0`, 15000);
  if (reached) {
    const popup = await openPopupFor(id, hostTab);
    await analyze(popup);
    check('detection A. Workday host → Workday (host alone is strong evidence)', (await platformNote(popup)) === WORKDAY_NOTE);
    await popup.close();
  } else {
    console.log('      A. could not load a page on a *.myworkdayjobs.com host locally: ' + (await hostTab.evaluate('location.href').catch(() => '?')));
  }
  await hostTab.close();

  // =================== Workday step: analyze ===================
  let tab = await open(`${ORIGIN}/workday/apply`);
  await waitFor(tab, `!!document.getElementById('state').textContent`);
  const before = await stepSnapshot(tab);
  let popup = await openPopupFor(id, tab);
  await analyze(popup);
  const names = await popup.evaluate('t.items()');
  const expectedNames = ['First Name*', 'Last Name', 'Email Address*', 'Phone Number*', 'Address Line 1*', 'City*', 'Postal Code*', 'Country', 'How Did You Hear About Us?', 'Preferred Office Location*', 'Will you require visa sponsorship?', 'Willing to relocate', 'I identify as a protected veteran', 'Job Title*', 'Company*', 'Job Title*', 'Company*', 'Current Job Title*', 'Current Company*', 'University*', 'Degree', 'Field of Study*'];
  check('3. Workday fields detected as one logical field each (no chrome, helpers, file, or nav buttons)', JSON.stringify(names) === JSON.stringify(expectedNames), `${names.length}: ${names.join(' | ')}`);
  check('7. Analyze does not change the page', (await stepSnapshot(tab)) === before);
  const review = [];
  for (let i = 0; i < names.length; i++) review.push(await popup.evaluate(`(() => { const li = document.querySelectorAll('.review-item')[${i}]; return { name: li.querySelector('.field-name').textContent, mapping: li.querySelector('.mapping').textContent, note: li.querySelector('.note').textContent, checked: li.querySelector('input[type=checkbox]').checked, disabled: li.querySelector('input[type=checkbox]').disabled, meta: li.querySelector('.field-meta').textContent }; })()`));
  console.log('      review:');
  for (const r of review) console.log(`        [${r.checked ? 'x' : r.disabled ? '-' : ' '}] ${r.name} | ${r.mapping} | ${r.note}`);
  const at = (i) => review[i];
  check('6. deterministic mappings', at(0).mapping === hi('First name (identity.firstName)') && at(1).mapping === hi('Last name (identity.lastName)') && at(4).mapping === hi('Address (location.address)') && at(7).mapping === hi('Country (location.country)') && at(20).mapping === hi('Highest degree (education[0].degree)') && at(17).mapping === hi('Current job title (experience.currentTitle)'));
  check('5. Workday dropdowns are custom select fields (filled by the Phase 7 engine below)', at(7).meta === 'select' && at(20).meta === 'select', `${at(7).meta} / ${at(20).meta}`);
  check('8. high-confidence fields approved', review.filter((r) => r.checked).length === 13, review.filter((r) => r.checked).map((r) => r.name).join(', '));
  check('9. review field not selected', at(10).checked === false && at(10).disabled === false);
  check('10. unknown fields untouched and not selectable', [8, 9, 12].every((i) => at(i).disabled && at(i).mapping === 'No match'));
  // Phase 11: headed "Work Experience 1/2" blocks map to their own records (this profile has
  // none), never to current employment, and are never selected automatically.
  const WORK_TARGETS = ['Work experience 1 → Job title (workExperience[0].title)', 'Work experience 1 → Company (workExperience[0].company)', 'Work experience 2 → Job title (workExperience[1].title)', 'Work experience 2 → Company (workExperience[1].company)'];
  check('repeated work-experience questions map to their own records and are not fillable without a record', [13, 14, 15, 16].every((i, n) => at(i).disabled && !at(i).checked && at(i).mapping === `→ ${WORK_TARGETS[n]} · Automatic · Medium confidence` && at(i).note === 'No value in your profile.'));
  check('autocomplete/search input reported as unsupported', at(19).disabled && at(19).note === 'Custom dropdown ApplyOnce cannot operate safely. Will not be filled.');
  check('1. platform note', (await platformNote(popup)) === WORKDAY_NOTE);

  // =================== Workday step: fill ===================
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  const baselineHtml = await tab.evaluate('document.documentElement.outerHTML');
  await tab.evaluate(`document.getElementById('rerender').click(); true`); // 14: new generated ids everywhere
  const summary = await fill(popup);
  const state = await stepState(tab);
  check('11/12. explicit Fill summary', summary === '12 fields filled · 1 skipped · 1 need review', summary);
  check('12. text fields filled', state['legalName-firstName'] === 'Jane' && state['legalName-lastName'] === 'Doe' && state['phone-number'] === '+1 555 010 0199' && state.addressLine1 === '1 Example Street' && state.city === 'Springfield' && state.postalCode === 'M5V 2T6' && state.currentJobTitle === 'Staff Engineer' && state.currentCompany === 'Example Co' && state.fieldOfStudy === 'Physics', JSON.stringify(state));
  check('custom dropdown: open, discover (delayed) options, match, select, confirm, close', state.countryDropdown === 'Canada' && state.degreeDropdown === "Master's" && JSON.parse(await stepSnapshot(tab)).open === 0);
  check('checkbox: relocation checked; veteran status untouched', state.relocate === true && state.veteranStatus === false);
  check('13. existing value preserved', state.email === 'kept@example.com' && at(2) && (await item(popup, 'Email Address*')).note === 'Skipped. The field already has a value.');
  check('14. fields rediscovered after re-render with new generated ids', state['legalName-firstName'] === 'Jane' && (await tab.evaluate(`document.querySelector('[data-automation-id="legalName-firstName"]').id`)) !== 'input-1');
  check('autocomplete: nothing typed into the search input', state.school === '');
  check('review, unknown, and repeated fields untouched', state.sourceDropdown === '' && state['customQuestion-office'] === '' && state.jobTitle === '' && state.company === '' && state['questionId-7:1'] === false);
  check('16. no navigation, no submission', JSON.parse(await stepSnapshot(tab)).nav === '0' && (await tab.evaluate(`document.getElementById('submitted').textContent`)) === 'false');
  const recorded = await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id);
  const values = JSON.parse(recorded).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => i.value));
  check('privacy: only approved values crossed', JSON.stringify(values) === JSON.stringify(['Jane', 'Doe', 'jane.doe@example.com', '+1 555 010 0199', '1 Example Street', 'Springfield', 'M5V 2T6', 'Canada', true, 'Staff Engineer', 'Example Co', "Master's", 'Physics']), JSON.stringify(values));
  const pageHtml = await tab.evaluate('document.documentElement.outerHTML');
  const unapproved = ['https://jane.example.com', 'https://www.linkedin.com/in/jane-doe-example', 'Authorized to work in Canada', 'Example University', 'Ontario'];
  check('privacy: unapproved values never reach messages or the page', unapproved.every((v) => !recorded.includes(v) && (!pageHtml.includes(v) || baselineHtml.includes(v))) && !recorded.includes('schemaVersion') && !recorded.includes('savedMappings'));
  let shot = await popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase8-workday.png'), Buffer.from(shot.data, 'base64'));

  // =================== Teach Once on a Workday field ===================
  const office = 'Preferred Office Location*';
  const pageBefore = await stepSnapshot(tab);
  await teach(popup, office, 'city');
  let taught = await item(popup, office);
  check('Teach: saved, shown as "Taught by you", unticked', taught.mapping === '→ City (location.city) · Taught by you' && !taught.checked);
  check('Teach: page did not change', (await stepSnapshot(tab)) === pageBefore);
  await popup.evaluate(`t.toggle(${JSON.stringify(office)}); true`);
  await sleep(100);
  await fill(popup);
  check('Teach: approve + Fill fills the taught field; no navigation', (await stepState(tab))['customQuestion-office'] === 'Springfield' && JSON.parse(await stepSnapshot(tab)).nav === '0');
  await popup.close();
  await tab.send('Page.reload');
  await sleep(800);
  await waitFor(tab, `!!document.getElementById('state').textContent`);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  taught = await item(popup, office);
  check('Teach: reused after reload, unticked, nothing filled automatically', taught.mapping.endsWith('Taught by you') && !taught.checked && (await stepState(tab))['legalName-firstName'] === '');
  await teach(popup, office, 'state');
  await popup.evaluate(`t.toggle(${JSON.stringify(office)}); true`);
  await sleep(100);
  await fill(popup);
  check('Teach: remapped to State and filled', (await stepState(tab))['customQuestion-office'] === 'Ontario');
  await popup.close();
  const manage = await open(`chrome-extension://${id}/profile.html#saved-mappings`);
  await waitFor(manage, `document.querySelectorAll('.mapping-list li').length === 1`);
  await manage.evaluate(`document.querySelector('.mapping-list li button').click(); true`);
  await waitFor(manage, `document.body.innerText.includes('No saved mappings yet.')`);
  await tab.send('Page.reload');
  await sleep(800);
  await waitFor(tab, `!!document.getElementById('state').textContent`);
  popup = await openPopupFor(id, tab);
  await analyze(popup);
  check('Teach: deleted mapping no longer applies', (await item(popup, office)).mapping === 'No match');
  await popup.close();
  await tab.close();

  // =================== Real Workday: read-only Analyze ===================
  const real = await open(REAL_WORKDAY);
  const loaded = await waitFor(real, `document.querySelectorAll('a[data-automation-id="jobTitle"]').length > 0`, 240000);
  if (!loaded) {
    console.log('      real Workday page did not load in time; not verified');
  } else {
    popup = await openPopupFor(id, real);
    const realText = await analyze(popup);
    const realNames = await popup.evaluate('t.items()');
    const realReview = [];
    for (const n of realNames) realReview.push(`${n} → ${(await item(popup, n))?.mapping}`);
    console.log('      real Workday fields: ' + realReview.join(' | '));
    check('REAL Workday job board: detected as Workday', (await platformNote(popup)) === WORKDAY_NOTE, realText.split('\n').slice(2, 5).join(' | '));
    check('REAL Workday job board: header language selector and menu are not fields', !realNames.some((n) => /english|menu/i.test(n)));
    check('REAL Workday job board: nothing selected for filling (no application questions)', realReview.length === 0 || (await popup.evaluate(`[...document.querySelectorAll('.review-item input[type=checkbox]')].every((c) => !c.checked)`)));
    shot = await popup.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SCRATCH, 'phase8-real-workday.png'), Buffer.from(shot.data, 'base64'));
    await popup.close();
  }
  await real.close();
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
