// Phase 9 (Workday autocomplete / search fields) verification in real Chrome via the DevTools pipe. Fake data only.
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
const REAL_WORKDAY = 'https://workday.wd5.myworkdayjobs.com/Workday';

const SCHOOLS = ['University of Example', 'Example State University', 'Sample College'];
const school = (extra = {}) => ({ auto: 'school', label: 'School or University', list: SCHOOLS, rel: 'controlsWhenOpen', ...extra });
const SCENARIOS = {
  A: [school()],
  B: [school({ loading: true, delay: 900 })],
  C: [school({ portal: true, rel: 'controls' })],
  D: [school({ rel: 'controls' })],
  E: [school({ rel: 'owns' })],
  F: [school({ delay: 2000 })],
  G: [school({ list: ['University of Example', 'University of Example, Ahmedabad', 'Sample College'] })],
  H: [school({ list: [] })],
  I: [school()],
  J: [school({ prefill: 'Sample College' }), { auto: 'fieldOfStudy', label: 'Field of Study', list: ['Physics', 'Chemistry'], rel: 'controls', prefillPill: 'Chemistry' }],
  K: [school({ confirm: 'pill' })],
  L: [school({ confirm: 'none' })],
  M: [school({ rel: 'none' })],
  N: [school({ submitOptions: true, submitIcon: true })],
  O: [
    school(),
    { auto: 'fieldOfStudy', label: 'Field of Study', list: ['Physics', 'Physical Therapy', 'Astrophysics'], rel: 'controls', portal: true },
    { auto: 'city', label: 'City', list: ['Springfield', 'Springfield, Ontario', 'Springdale'], rel: 'controls' },
    { auto: 'region', label: 'State / Province', list: ['Ontario', 'Oregon'], rel: 'owns', confirm: 'pill' },
    { auto: 'countryPrompt', label: 'Country', list: ['Canada', 'Cameroon'], rel: 'controls' },
    { auto: 'employer', label: 'Current Company', list: ['Example Co', 'Example Corp'], rel: 'controls', delay: 700 },
  ],
  P: [school({ trustedOnly: true })],
  T: [{ ...school(), label: 'What university did you attend?' }],
};

const searchPage = (name) => `<!doctype html><html lang="en-US"><head><title>Careers - Apply (${name})</title></head><body>
<form id="page-form"><div data-automation-id="applyFlowPage">
  <h2 data-automation-id="jobTitleHeading">Software Engineer</h2>
  <div id="step"></div>
  <button type="button" data-automation-id="pageFooterBackButton" id="back">Back</button>
  <button type="button" data-automation-id="pageFooterNextButton" id="next">Save and Continue</button>
</div></form>
<button type="button" id="rerender">Re-render step</button>
<pre id="state"></pre>
<script>
  const CONFIGS = ${JSON.stringify(SCENARIOS[name])};
  let gen = 0;
  const state = { nav: 0, submitted: false, fields: {} };
  const render = () => { document.getElementById('state').textContent = JSON.stringify(state); };
  function widget(c) {
    const f = (state.fields[c.auto] = { input: '', selected: '', typed: 0, clicks: 0, iconClicks: 0 });
    const id = 'input-' + ++gen;
    const listId = c.auto + '-list-' + gen;
    const box = document.createElement('div');
    box.setAttribute('data-automation-id', 'formField-' + c.auto);
    box.innerHTML = '<label for="' + id + '">' + c.label + '<abbr title="required">*</abbr></label>';
    const input = document.createElement('input');
    input.type = 'text'; input.id = id;
    input.setAttribute('data-automation-id', c.auto); input.setAttribute('data-uxi-widget-type', 'selectinput');
    input.setAttribute('aria-autocomplete', 'list');
    if (c.rel !== 'none') { input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false'); }
    if (c.rel === 'controls') input.setAttribute('aria-controls', listId);
    if (c.rel === 'owns') input.setAttribute('aria-owns', listId);
    box.append(input);
    if (c.submitIcon) {
      const b = document.createElement('button'); b.type = 'submit'; b.setAttribute('aria-label', 'Search'); b.setAttribute('data-automation-id', 'promptSearchButton'); b.textContent = 'Search';
      b.addEventListener('click', () => { f.iconClicks++; render(); }); box.append(b);
    }
    if (c.prefill) input.value = c.prefill;
    if (c.prefillPill) box.insertAdjacentHTML('beforeend', '<div data-automation-id="selectedItem">' + c.prefillPill + '</div>');
    document.getElementById('step').append(box);
    let list = null, timer = 0;
    const sync = () => { f.input = input.value; render(); };
    const close = () => { clearTimeout(timer); input.setAttribute('aria-expanded', 'false'); if (c.rel === 'controlsWhenOpen') input.removeAttribute('aria-controls'); list?.remove(); list = null; };
    const show = (q) => {
      close();
      list = document.createElement('div'); list.id = listId; list.setAttribute('role', 'listbox'); list.setAttribute('data-automation-id', 'activeListContainer');
      input.setAttribute('aria-expanded', 'true'); if (c.rel === 'controlsWhenOpen') input.setAttribute('aria-controls', listId);
      (c.portal ? document.body : box).append(list);
      if (c.loading) { list.setAttribute('aria-busy', 'true'); list.innerHTML = '<div role="option" aria-disabled="true">Searching…</div>'; }
      const current = list;
      timer = setTimeout(() => {
        current.removeAttribute('aria-busy'); current.innerHTML = '';
        const word = q.toLowerCase().split(/\\s+/)[0];
        for (const label of c.list.filter((x) => x.toLowerCase().includes(word))) {
          const o = document.createElement(c.submitOptions ? 'button' : 'div');
          if (c.submitOptions) o.type = 'submit';
          o.setAttribute('role', 'option'); o.setAttribute('data-automation-id', 'promptOption'); o.textContent = label;
          o.addEventListener('click', () => {
            f.clicks++;
            if (c.confirm === 'none') return render();
            f.selected = label;
            if (c.confirm === 'pill') { input.value = ''; box.insertAdjacentHTML('beforeend', '<div data-automation-id="selectedItem">' + label + '</div>'); }
            else input.value = label;
            close(); sync();
          });
          current.append(o);
        }
      }, c.delay ?? 300);
    };
    input.addEventListener('input', (e) => { f.typed++; sync(); if (c.trustedOnly && !e.isTrusted) return; if (input.value) show(input.value); else close(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    sync();
  }
  const build = () => { document.getElementById('step').innerHTML = ''; CONFIGS.forEach(widget); };
  build();
  for (const b of ['back', 'next']) document.getElementById(b).addEventListener('click', () => { state.nav++; render(); });
  document.getElementById('page-form').addEventListener('submit', (e) => { e.preventDefault(); state.submitted = true; render(); });
  document.getElementById('rerender').addEventListener('click', build);
</script></body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const scenario = url.pathname.match(/^\/workday\/search\/([A-Z])$/);
  if (scenario && SCENARIOS[scenario[1]]) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(searchPage(scenario[1]));
  }
  const match = url.pathname.match(/^\/(react|vue|angular)\/(.*)$/);
  if (match) {
    const file = join(FW, `${match[1]}-search/dist`, match[2] || 'index.html');
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
const WORKDAY_NOTE = 'Workday page: ApplyOnce fills the current step only. Move to the next step yourself, then analyze again.';
const platformNote = (popup) => popup.evaluate(`[...document.querySelectorAll('.analysis .note')].map((n) => n.textContent).find((t) => /page/.test(t)) ?? ''`);
async function fillSlow(popup) {
  await popup.evaluate(`t.button('Fill ').click(); true`);
  await sleep(200);
  await waitFor(popup, `!t.button('Filling') && !!document.querySelector('.fill-summary')`, 40000);
  return popup.evaluate(`document.querySelector('.fill-summary')?.textContent ?? ''`);
}
const UNAPPROVED = ['jane.doe@example.com', 'https://www.linkedin.com/in/jane-doe-example', 'Authorized to work in Canada', 'Staff Engineer'];

let id;
async function run(url, { before, teachAs, skipFill = false } = {}) {
  const tab = await open(url);
  await waitFor(tab, `!!document.getElementById('state')?.textContent`);
  await sleep(200);
  const popup = await openPopupFor(id, tab);
  await analyze(popup);
  const world = isolatedWorld(tab);
  await tab.evaluate(`globalThis.__recorded = []; chrome.runtime.onMessage.addListener((m) => { globalThis.__recorded.push(JSON.parse(JSON.stringify(m))); }); true`, world.id);
  const names = await popup.evaluate('t.items()');
  const review = {};
  for (const n of names) review[n] = await item(popup, n);
  const baseline = await tab.evaluate('document.documentElement.outerHTML');
  const analyzed = JSON.parse(await tab.evaluate(`document.getElementById('state').textContent`));
  if (teachAs) {
    await teach(popup, teachAs[0], teachAs[1]);
    review[teachAs[0]] = await item(popup, teachAs[0]);
    await popup.evaluate(`t.toggle(${JSON.stringify(teachAs[0])}); true`);
    await sleep(100);
  }
  if (before) await before(tab);
  const started = Date.now();
  const selectedCount = await popup.evaluate(`document.querySelectorAll('.review-item input[type=checkbox]:checked').length`);
  const summary = skipFill || selectedCount === 0 ? null : await fillSlow(popup);
  const elapsed = Date.now() - started;
  const after = {};
  for (const n of names) after[n] = await item(popup, n);
  const state = JSON.parse(await tab.evaluate(`document.getElementById('state').textContent`));
  const openLists = await tab.evaluate(OPEN_LISTBOXES);
  const raw = await tab.evaluate(`JSON.stringify(globalThis.__recorded)`, world.id);
  const values = JSON.parse(raw).filter((m) => m.type === 'applyonce/fill-fields').flatMap((m) => m.payload.instructions.map((i) => i.value));
  const html = await tab.evaluate('document.documentElement.outerHTML');
  const leaked = UNAPPROVED.filter((v) => raw.includes(v) || (html.includes(v) && !baseline.includes(v)));
  const privacyOk = leaked.length === 0 && !raw.includes('schemaVersion') && !raw.includes('savedMappings');
  return { analyzed, tab, popup, names, review, after, summary, elapsed, state, openLists, values, privacyOk, platform: await platformNote(popup) };
}
const log = (label, r) => {
  console.log(`      ${label}: ${r.summary ?? '(no fill)'} in ${r.elapsed} ms · values ${JSON.stringify(r.values)}`);
  for (const n of r.names) console.log(`        ${n} | ${r.review[n].mapping} | before: ${r.review[n].note} | after: ${r.after[n].note}`);
};
const finish = async (r) => { await r.popup.close(); await r.tab.close(); };

try {
  await launch(mkdtempSync(join(SCRATCH, 'chrome-')));
  ({ id } = await send('Extensions.loadUnpacked', { path: DIST }));
  const editor = await open(`chrome-extension://${id}/profile.html`);
  await waitFor(editor, `document.querySelectorAll('form section').length >= 9`);
  await editor.evaluate(editorSet({
    'First name': 'Jane', 'Last name': 'Doe', Email: 'jane.doe@example.com', City: 'Springfield', 'State / province': 'Ontario', Country: 'Canada',
    LinkedIn: 'https://www.linkedin.com/in/jane-doe-example', 'Current job title': 'Staff Engineer', 'Current company': 'Example Co',
    'Field of study': 'Physics', Institution: 'University of Example', 'Work authorization': 'Authorized to work in Canada',
  }));
  await sleep(100);
  await editor.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save profile').click(); true`);
  check('profile saved (fake data)', await waitFor(editor, `document.querySelector('.save-bar [role=status]')?.textContent === 'Profile saved'`));
  await editor.close();

  const S = (name) => `${ORIGIN}/workday/search/${name}`;
  const SCHOOL = 'School or University*';
  const safe = (r) => r.state.nav === 0 && r.state.submitted === false && r.openLists === 0;

  // ---- A. basic ----
  let r = await run(S('A'));
  log('A basic', r);
  const f = (key) => r.state.fields[key];
  check('A. detected on Workday, one logical search field mapped to Institution', r.platform === WORKDAY_NOTE && JSON.stringify(r.names) === JSON.stringify([SCHOOL]) && /Institution/.test(r.review[SCHOOL].mapping) && r.review[SCHOOL].checked, r.review[SCHOOL].mapping);
  check('A. Analyze typed nothing and opened nothing', r.analyzed.fields.school.typed === 0 && r.analyzed.fields.school.input === '', JSON.stringify(r.analyzed.fields.school));
  check('A. typed once, one suggestion clicked, selection confirmed, list closed', r.summary === '1 field filled' && f('school').selected === 'University of Example' && f('school').input === 'University of Example' && f('school').typed === 1 && f('school').clicks === 1 && safe(r), JSON.stringify(f('school')));
  check('A. privacy: only the approved value crossed', JSON.stringify(r.values) === JSON.stringify(['University of Example']) && r.privacyOk);
  let shot = await r.popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase9-basic.png'), Buffer.from(shot.data, 'base64'));
  await finish(r);

  for (const [name, label] of [['B', 'dynamic results (busy "Searching…" placeholder first)'], ['C', 'portal list (aria-controls)'], ['D', 'aria-controls list'], ['E', 'aria-owns list'], ['F', 'delayed results (2 s)']]) {
    r = await run(S(name));
    log(name, r);
    check(`${name}. ${label}: filled and confirmed`, r.summary === '1 field filled' && f('school').selected === 'University of Example' && f('school').clicks === 1 && safe(r), JSON.stringify(f('school')));
    await finish(r);
  }

  r = await run(S('G'));
  log('G', r);
  check('G. duplicate / extended suggestions ("University of Example" + "…, Ahmedabad"): failed, nothing clicked, typed text removed', r.summary === '0 fields filled · 1 failed' && /several suggestions match/.test(r.after[SCHOOL].note) && /typed text was removed/.test(r.after[SCHOOL].note) && f('school').clicks === 0 && f('school').input === '' && safe(r), r.after[SCHOOL].note);
  await finish(r);

  r = await run(S('H'));
  log('H', r);
  check('H. no suggestions: failed after the bounded wait, typed text removed', /No suggestions appeared/.test(r.after[SCHOOL].note) && f('school').input === '' && f('school').clicks === 0 && r.elapsed < 8000 && safe(r), `${r.after[SCHOOL].note} · ${r.elapsed} ms`);
  await finish(r);

  r = await run(S('I'), { before: (tab) => tab.evaluate(`document.getElementById('rerender').click(); true`) });
  log('I', r);
  const newId = await r.tab.evaluate(`document.querySelector('[data-automation-id="school"]').id`);
  check('I. re-rendered with new generated ids: rediscovered and filled', r.summary === '1 field filled' && f('school').selected === 'University of Example' && newId !== 'input-1', newId);
  await finish(r);

  r = await run(S('J'));
  log('J', r);
  check('J. existing text value: skipped, never typed into', f('school').input === 'Sample College' && f('school').typed === 0 && /already has a value/.test(r.after[SCHOOL].note));
  check('J. existing Workday selected-item pill: skipped, never typed into', f('fieldOfStudy').typed === 0 && /already has a value/.test(r.after['Field of Study*'].note) && safe(r));
  await finish(r);

  r = await run(S('K'));
  log('K', r);
  const pills = await r.tab.evaluate(`[...document.querySelectorAll('[data-automation-id=selectedItem]')].map((p) => p.textContent).join('|')`);
  check('K. confirmation through a selected-item pill (input cleared by the widget)', r.summary === '1 field filled' && pills === 'University of Example' && f('school').input === '', pills);
  await finish(r);

  r = await run(S('L'));
  log('L', r);
  check('L. click not reflected: "Unable to confirm autocomplete selection.", typed text removed', /^Failed\. Unable to confirm autocomplete selection\./.test(r.after[SCHOOL].note) || (/Unable to confirm autocomplete selection\./.test(r.after[SCHOOL].note) && f('school').clicks === 1 && f('school').input === ''), `${r.after[SCHOOL].note} · ${JSON.stringify(f('school'))}`);
  await finish(r);

  r = await run(S('M'));
  log('M', r);
  check('M. search field without a popup relationship: unsupported, not selectable, untouched', r.review[SCHOOL].disabled && !r.review[SCHOOL].checked && r.summary === null && f('school').typed === 0, r.review[SCHOOL].note);
  await finish(r);

  r = await run(S('N'));
  log('N', r);
  check('N. submit-type suggestions / search button in a form: nothing clicked, no submission', /submit or navigation button/.test(r.after[SCHOOL].note) && f('school').clicks === 0 && f('school').iconClicks === 0 && f('school').input === '' && safe(r), r.after[SCHOOL].note);
  await finish(r);

  r = await run(S('O'));
  log('O', r);
  check('O. several autocompletes on one step: fill independently; ambiguous City fails without stopping the others', r.summary === '5 fields filled · 1 failed' && f('school').selected === 'University of Example' && f('fieldOfStudy').selected === 'Physics' && f('region').selected === 'Ontario' && f('countryPrompt').selected === 'Canada' && f('employer').selected === 'Example Co' && f('city').clicks === 0 && f('city').input === '' && safe(r), JSON.stringify(Object.fromEntries(Object.entries(r.state.fields).map(([k, v]) => [k, v.selected || v.input]))));
  check('O. privacy: only the six approved values crossed; nothing unapproved on the page', JSON.stringify(r.values) === JSON.stringify(['University of Example', 'Physics', 'Springfield', 'Ontario', 'Canada', 'Example Co']) && r.privacyOk, JSON.stringify(r.values));
  shot = await r.popup.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCRATCH, 'phase9-multiple.png'), Buffer.from(shot.data, 'base64'));
  await finish(r);

  r = await run(S('P'));
  log('P', r);
  check('P. widget that ignores synthetic input: fails safely, nothing clicked, no bypass', /No suggestions appeared/.test(r.after[SCHOOL].note) && f('school').clicks === 0 && f('school').input === '' && safe(r), r.after[SCHOOL].note);
  await finish(r);

  const Q = 'What university did you attend?*';
  r = await run(S('T'), { teachAs: [Q, 'institution'] });
  log('T', r);
  check('Teach: "What university did you attend?" → Institution saved as "Taught by you"; fills only after approval', r.review[Q].mapping === '→ Institution (education[0].institution) · Taught by you' && r.summary === '1 field filled' && f('school').selected === 'University of Example', r.review[Q].mapping);
  await finish(r);
  r = await run(S('T'), { skipFill: true });
  check('Teach: reused after reload, not auto-selected, nothing typed', r.review[Q].mapping.endsWith('Taught by you') && !r.review[Q].checked && f('school').typed === 0);
  await finish(r);

  // ---- Frameworks: dynamic server search ----
  for (const [fw, label, rerender] of [['react', 'React (value confirmation, portal list)', true], ['vue', 'Vue (selected-item pill, Teleport list)', true], ['angular', 'Angular (ngModel, inline list, aria-selected)', false]]) {
    r = await run(`${ORIGIN}/${fw}/`, rerender ? { before: (tab) => tab.evaluate(`document.getElementById('rerender').click(); true`) } : {});
    log(fw, r);
    check(`${label}: Workday search fields detected and mapped`, r.platform === WORKDAY_NOTE && JSON.stringify(r.names) === JSON.stringify(['First Name', 'School or University', 'Field of Study', 'City']) && ['School or University', 'Field of Study', 'City'].every((n) => r.review[n].checked), r.names.join(', '));
    const inputs = JSON.parse(await r.tab.evaluate(`JSON.stringify(['school', 'study', 'city'].map((k) => document.querySelector('[data-automation-id="' + k + '"]').value))`));
    check(`${label}: framework state updated for unique matches; ambiguous City failed and was cleaned up`, r.summary === '3 fields filled · 1 failed' && r.state.firstName === 'Jane' && r.state.school === 'University of Example' && r.state.study === 'Physics' && r.state.city === '' && inputs[2] === '', `${JSON.stringify(r.state)} inputs ${JSON.stringify(inputs)}`);
    const page = JSON.parse(await r.tab.evaluate(`JSON.stringify({ nav: document.getElementById('nav').textContent, submitted: document.getElementById('submitted').textContent, open: ${OPEN_LISTBOXES} })`));
    check(`${label}: no navigation, no submission, no open lists; only approved values crossed`, page.nav === '0' && page.submitted === 'false' && page.open === 0 && JSON.stringify(r.values) === JSON.stringify(['Jane', 'University of Example', 'Physics', 'Springfield']) && r.privacyOk, JSON.stringify(page));
    if (fw === 'react') {
      shot = await r.popup.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SCRATCH, 'phase9-react.png'), Buffer.from(shot.data, 'base64'));
    }
    await finish(r);
  }

  // ---- Real Workday: read-only ----
  const real = await open(REAL_WORKDAY);
  const loaded = await waitFor(real, `document.querySelectorAll('a[data-automation-id="jobTitle"]').length > 0`, 150000);
  if (!loaded) {
    console.log('      real Workday job board did not load in time; not verified');
  } else {
    const before = await real.evaluate(`JSON.stringify([...document.querySelectorAll('input')].map((i) => i.value))`);
    const popup = await openPopupFor(id, real);
    await analyze(popup);
    const realNames = await popup.evaluate('t.items()');
    console.log('      real Workday fields: ' + (realNames.join(' | ') || '(none)'));
    check('REAL Workday job board: detected as Workday; nothing selected; nothing typed', (await platformNote(popup)) === WORKDAY_NOTE && (await popup.evaluate(`document.querySelectorAll('.review-item input[type=checkbox]:checked').length`)) === 0 && (await real.evaluate(`JSON.stringify([...document.querySelectorAll('input')].map((i) => i.value))`)) === before);
    const search = await real.evaluate(`JSON.stringify([...document.querySelectorAll('input')].map((i) => ({ auto: i.getAttribute('data-automation-id'), ac: i.getAttribute('aria-autocomplete'), role: i.getAttribute('role'), inApply: !!i.closest('[data-automation-id=applyFlowPage]') })))`);
    console.log('      real Workday page inputs: ' + search);
    await popup.close();
  }
  await real.close();
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
