// @vitest-environment happy-dom
/**
 * Phase 16: one fixture matrix run against every adapter (generic, Workday, Greenhouse) to
 * check that all of them follow the same contract: detection → scan → common field metadata
 * → fill with standard, isolated results. Platform-specific DOM stays in the small wrappers
 * below; the questions and expectations are shared.
 */
import type { FillInstruction, FillValue, FormAdapter, FormField } from '@applyonce/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { isFormField } from '../messaging/validate';
import { resolvePageAdapter } from './adapters';

type Platform = 'generic' | 'workday' | 'greenhouse';

interface PlatformFixture {
  platform: Platform;
  url: string;
  /** Wraps the shared questions in the platform's page structure. */
  page: (questions: string) => string;
  /** Extra attributes a platform puts on its controls (e.g. Workday automation ids). */
  attrs: (name: string) => string;
}

const FIXTURES: readonly PlatformFixture[] = [
  {
    platform: 'generic',
    url: 'https://jobs.example.com/apply',
    page: (q) => `<form id="apply">${q}<button type="submit">Submit</button></form>`,
    attrs: () => '',
  },
  {
    platform: 'workday',
    url: 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/apply',
    page: (q) =>
      `<form><div data-automation-id="applyFlowPage">${q}<button type="button" data-automation-id="pageFooterNextButton">Save and Continue</button></div></form>`,
    attrs: (name) => `data-automation-id="${name}"`,
  },
  {
    platform: 'greenhouse',
    url: 'https://job-boards.greenhouse.io/acme/jobs/1234',
    page: (q) =>
      `<form id="application-form"><div class="application--questions">${q}</div><div class="eeoc__container"><label for="gender">Gender</label><select id="gender"><option value=""></option><option>Female</option></select></div><button type="submit">Submit application</button></form>`,
    attrs: () => '',
  },
];

/** The shared questions: every control type, one custom dropdown, and a repeated question. */
function questions({ attrs }: PlatformFixture, prefilled: Partial<Record<string, string>> = {}) {
  const value = (name: string) =>
    prefilled[name] !== undefined ? ` value="${prefilled[name]}"` : '';
  const text = (id: string, label: string, type = 'text') =>
    `<div><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${attrs(id)}${value(id)}></div>`;
  const selected = (name: string, option: string) =>
    prefilled[name] === option ? ' selected' : '';
  return [
    text('first_name', 'First Name'),
    text('email', 'Email', 'email'),
    text('question_1', 'Website', 'url'),
    text('question_2', 'Years of Experience', 'number'),
    `<div><label for="question_3">Cover letter text</label><textarea id="question_3" name="question_3" ${attrs('question_3')}></textarea></div>`,
    `<div><label for="country">Country</label><select id="country" name="country" ${attrs('country')}><option value="">Select…</option><option${selected('country', 'Canada')}>Canada</option><option${selected('country', 'India')}>India</option></select></div>`,
    `<div><label><input type="checkbox" id="relocate" name="relocate" ${attrs('relocate')}${prefilled.relocate ? ' checked' : ''}> Willing to relocate</label></div>`,
    `<fieldset><legend>Will you require visa sponsorship?</legend><label><input type="radio" name="sponsor" value="yes" ${attrs('sponsor')}${prefilled.sponsor === 'yes' ? ' checked' : ''}> Yes</label><label><input type="radio" name="sponsor" value="no" ${attrs('sponsor')}${prefilled.sponsor === 'no' ? ' checked' : ''}> No</label></fieldset>`,
    `<div><label id="mode-l">Work mode</label><div id="mode" role="combobox" tabindex="0" aria-labelledby="mode-l" aria-controls="mode-list" aria-expanded="false" ${attrs('mode')}>${prefilled.mode ?? ''}</div><ul id="mode-list" role="listbox" hidden><li role="option" data-value="remote">Remote</li><li role="option" data-value="hybrid">Hybrid</li></ul></div>`,
    text('degree_a', 'Degree').replace('name="degree_a"', 'name="degree"'),
    text('degree_b', 'Degree').replace('name="degree_b"', 'name="degree"'),
  ].join('');
}

/** Makes the plain-DOM dropdown behave like a UI library's: open on click, choose, show it. */
function wireDropdown() {
  const control = document.getElementById('mode');
  const list = document.getElementById('mode-list');
  if (!control || !list) return;
  control.addEventListener('click', () => {
    list.hidden = false;
    control.setAttribute('aria-expanded', 'true');
  });
  control.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      list.hidden = true;
      control.setAttribute('aria-expanded', 'false');
    }
  });
  for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
    option.addEventListener('click', () => {
      for (const o of list.querySelectorAll('[role="option"]'))
        o.setAttribute('aria-selected', 'false');
      option.setAttribute('aria-selected', 'true');
      control.textContent = option.textContent;
      list.hidden = true;
      control.setAttribute('aria-expanded', 'false');
    });
  }
}

function mount(fixture: PlatformFixture, prefilled?: Partial<Record<string, string>>) {
  document.body.innerHTML = fixture.page(questions(fixture, prefilled));
  // happy-dom does not apply a `selected` attribute parsed from innerHTML reliably; a page
  // (or the user) choosing the option is what matters here.
  const country = document.getElementById('country') as HTMLSelectElement;
  country.value = prefilled?.country ?? '';
  wireDropdown();
}

const context = (fixture: PlatformFixture) => ({ url: fixture.url, root: document });
const adapterFor = (fixture: PlatformFixture): FormAdapter<ParentNode> =>
  resolvePageAdapter(context(fixture)).adapter;
const scan = (fixture: PlatformFixture) => adapterFor(fixture).getFields(context(fixture));
const byLabel = (fields: FormField[], label: string, n = 0) =>
  fields.filter((f) => f.signals.label === label)[n];

/** An approval as the service worker would send it: metadata only, no fingerprint. */
function instruction(field: FormField | undefined, value: FillValue): FillInstruction {
  if (!field) throw new Error('field not found');
  const { name, htmlId, label } = field.signals;
  return {
    fieldId: field.id,
    value,
    expected: {
      type: field.type,
      name,
      htmlId,
      label,
      ...(field.record ? { record: field.record } : {}),
      ...(field.repeatedCount ? { repeatedCount: field.repeatedCount } : {}),
    },
  };
}

const TIMING_FREE_VALUES: [string, FillValue][] = [
  ['First Name', 'Jane'],
  ['Email', 'jane.doe@example.com'],
  ['Website', 'https://jane.example.com'],
  ['Years of Experience', 6],
  ['Cover letter text', 'Hello'],
  ['Country', 'Canada'],
  ['Willing to relocate', true],
  ['Will you require visa sponsorship?', 'No'],
  ['Work mode', 'Hybrid'],
];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe.each(FIXTURES)('adapter contract: $platform', (fixture) => {
  it('detects its platform (or none, for generic) and is the adapter selected', () => {
    mount(fixture);
    const resolution = resolvePageAdapter(context(fixture));
    expect(resolution.adapter.id).toBe(fixture.platform);
    expect(resolution.reason).toBe(fixture.platform === 'generic' ? 'no-evidence' : 'host');
  });

  it('scans compatible metadata: valid FormFields, unique ids, fingerprints, no page values', () => {
    mount(fixture, { first_name: 'Typed by the user' });
    const fields = scan(fixture);
    expect(fields.every(isFormField)).toBe(true);
    expect(new Set(fields.map((f) => f.id)).size).toBe(fields.length);
    for (const f of fields) expect(f.identity?.key).toMatch(/^fp-[0-9a-f]{16}$/);
    expect(JSON.stringify(fields)).not.toContain('Typed by the user');
    // One field per question; EEO (Greenhouse) and buttons are never fields.
    expect(fields.map((f) => f.signals.label ?? f.signals.nearbyText)).toEqual([
      'First Name',
      'Email',
      'Website',
      'Years of Experience',
      'Cover letter text',
      'Country',
      'Willing to relocate',
      'Will you require visa sponsorship?',
      'Work mode',
      'Degree',
      'Degree',
    ]);
    const types = Object.fromEntries(fields.map((f) => [f.signals.label, f.type]));
    expect(types).toMatchObject({
      'First Name': 'text',
      Email: 'email',
      Website: 'text',
      'Years of Experience': 'number',
      'Cover letter text': 'textarea',
      Country: 'select',
      'Willing to relocate': 'checkbox',
      'Will you require visa sponsorship?': 'radio',
      'Work mode': 'select',
    });
    expect(byLabel(fields, 'Work mode')?.custom).toEqual({ pattern: 'combobox', supported: true });
  });

  it('marks the repeated question on every copy and never fills it without an assignment', async () => {
    mount(fixture);
    const fields = scan(fixture);
    const copies = fields.filter((f) => f.signals.label === 'Degree');
    expect(copies.map((f) => f.repeatedCount)).toEqual([2, 2]);
    const unassigned = { ...instruction(copies[0], 'BSc') };
    delete unassigned.expected.repeatedCount;
    const [result] = await adapterFor(fixture).fillFields(context(fixture), [unassigned]);
    expect(result?.status).toBe('skipped');
    // An assignment (repeat count approved) fills only that copy.
    const [assigned] = await adapterFor(fixture).fillFields(context(fixture), [
      instruction(copies[1], 'MSc'),
    ]);
    expect(assigned?.status).toBe('filled');
    expect((document.getElementById('degree_a') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('degree_b') as HTMLInputElement).value).toBe('MSc');
  });

  it('identity: stable across re-render and reorder, changed by a new question, shared by copies', () => {
    mount(fixture);
    const key = (label: string) => byLabel(scan(fixture), label)?.identity;
    const before = { email: key('Email'), first: key('First Name') };
    mount(fixture); // new DOM nodes
    expect({ email: key('Email'), first: key('First Name') }).toEqual(before);
    const email = document.getElementById('email')?.parentElement;
    email?.parentElement?.prepend(email); // reordered
    expect(key('Email')).toEqual(before.email);
    const label = document.querySelector('label[for="email"]');
    if (label) label.textContent = 'Work email';
    expect(byLabel(scan(fixture), 'Work email')?.identity?.key).not.toBe(before.email?.key);
    // The two Degree copies have different authored ids: two distinct, unique identities.
    const copies = scan(fixture).filter((f) => f.signals.label === 'Degree');
    expect(copies.every((f) => f.identity?.unique === true)).toBe(true);
    expect(copies[0]?.identity?.key).not.toBe(copies[1]?.identity?.key);
    // Truly identical copies (nothing tells them apart) share one non-unique identity.
    document
      .getElementById('question_1')
      ?.parentElement?.insertAdjacentHTML(
        'afterend',
        '<div><label>Nickname <input></label></div><div><label>Nickname <input></label></div>',
      );
    const nicknames = scan(fixture).filter((f) => f.signals.label === 'Nickname');
    expect(nicknames.map((f) => f.identity?.unique)).toEqual([false, false]);
    expect(nicknames[0]?.identity?.key).toBe(nicknames[1]?.identity?.key);
  });

  it('identity ignores generated framework ids across a re-render', () => {
    mount(fixture);
    const render = (generated: string) => {
      const input = document.getElementById('question_3');
      input?.setAttribute('id', generated);
      document.querySelector('label[for="question_3"]')?.setAttribute('for', generated);
    };
    render(':r1:');
    const before = byLabel(scan(fixture), 'Cover letter text')?.identity;
    mount(fixture);
    render('_r_7_');
    expect(byLabel(scan(fixture), 'Cover letter text')?.identity).toEqual(before);
  });

  it('fills every control type through the common pipeline, with standard results', async () => {
    mount(fixture);
    const fields = scan(fixture);
    const results = await adapterFor(fixture).fillFields(
      context(fixture),
      TIMING_FREE_VALUES.map(([label, value]) => instruction(byLabel(fields, label), value)),
    );
    expect(results.map((r) => [r.status, r.message])).toEqual(
      TIMING_FREE_VALUES.map(() => ['filled', 'Filled.']),
    );
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    expect([
      value('first_name'),
      value('question_1'),
      value('question_2'),
      value('country'),
    ]).toEqual(['Jane', 'https://jane.example.com', '6', 'Canada']);
    expect((document.getElementById('relocate') as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="no"]')?.checked).toBe(true);
    expect(document.getElementById('mode')?.textContent).toBe('Hybrid');
  });

  it('never overwrites existing values (text, select, custom select, radio, checkbox)', async () => {
    const prefilled = {
      first_name: 'Kept',
      country: 'India',
      mode: 'Remote',
      sponsor: 'yes',
      relocate: 'on',
    };
    mount(fixture, prefilled);
    const fields = scan(fixture);
    const results = await adapterFor(fixture).fillFields(context(fixture), [
      instruction(byLabel(fields, 'First Name'), 'Jane'),
      instruction(byLabel(fields, 'Country'), 'Canada'),
      instruction(byLabel(fields, 'Work mode'), 'Hybrid'),
      instruction(byLabel(fields, 'Will you require visa sponsorship?'), 'No'),
      instruction(byLabel(fields, 'Willing to relocate'), false),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Kept');
    expect((document.getElementById('country') as HTMLSelectElement).value).toBe('India');
    expect(document.getElementById('mode')?.textContent).toBe('Remote');
    expect(document.querySelector<HTMLInputElement>('input[value="yes"]')?.checked).toBe(true);
    expect((document.getElementById('relocate') as HTMLInputElement).checked).toBe(true);
  });

  it('isolates failures: A valid, B invalid, C valid → A fills, B fails or skips, C fills', async () => {
    mount(fixture);
    const fields = scan(fixture);
    const results = await adapterFor(fixture).fillFields(context(fixture), [
      instruction(byLabel(fields, 'First Name'), 'Jane'),
      instruction(byLabel(fields, 'Country'), 'Atlantis'), // no such option
      instruction(byLabel(fields, 'Website'), 'https://jane.example.com'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['filled', 'failed', 'filled']);
    expect(results[1]?.message).not.toContain('Atlantis');
  });

  it('Analyze → mutation → Fill: removed, replaced, relabeled, disabled, read-only fields are refused', async () => {
    mount(fixture);
    const fields = scan(fixture);
    const approved = [
      instruction(byLabel(fields, 'First Name'), 'Jane'),
      instruction(byLabel(fields, 'Email'), 'jane.doe@example.com'),
      instruction(byLabel(fields, 'Website'), 'https://jane.example.com'),
      instruction(byLabel(fields, 'Years of Experience'), 6),
      instruction(byLabel(fields, 'Cover letter text'), 'Hello'),
    ];
    document.getElementById('first_name')?.parentElement?.remove();
    document.getElementById('email')?.setAttribute('type', 'tel');
    const website = document.querySelector('label[for="question_1"]');
    if (website) website.textContent = 'Portfolio';
    document.getElementById('question_2')?.setAttribute('disabled', '');
    document.getElementById('question_3')?.setAttribute('readonly', '');
    const results = await adapterFor(fixture).fillFields(context(fixture), approved);
    expect(results.map((r) => r.status)).toEqual([
      'not-found',
      'not-found',
      'skipped',
      'skipped',
      'skipped',
    ]);
    for (const id of ['email', 'question_1', 'question_2', 'question_3'])
      expect((document.getElementById(id) as HTMLInputElement).value).toBe('');
  });

  it('dynamic: a question added after Analyze is found by the next scan', () => {
    mount(fixture);
    expect(byLabel(scan(fixture), 'Portfolio')).toBeUndefined();
    document
      .getElementById('question_1')
      ?.parentElement?.insertAdjacentHTML(
        'afterend',
        `<div><label for="question_9">Portfolio</label><input id="question_9" name="question_9" ${fixture.attrs('question_9')}></div>`,
      );
    expect(byLabel(scan(fixture), 'Portfolio')?.type).toBe('text');
  });

  it('never submits or navigates: submit handlers stay untouched during a full fill', async () => {
    mount(fixture);
    let submitted = 0;
    let clicked = 0;
    document.querySelector('form')?.addEventListener('submit', () => (submitted += 1));
    for (const button of document.querySelectorAll('button'))
      button.addEventListener('click', () => (clicked += 1));
    const fields = scan(fixture);
    await adapterFor(fixture).fillFields(
      context(fixture),
      TIMING_FREE_VALUES.map(([label, value]) => instruction(byLabel(fields, label), value)),
    );
    expect(submitted + clicked).toBe(0);
  });
});

describe('platform resolution with the real adapters', () => {
  const WORKDAY_DOM = `<div data-automation-id="applyFlowPage"><label for="a">First Name</label><input id="a" data-automation-id="legalNameSection_firstName"></div>`;
  const GREENHOUSE_DOM = `<form id="application-form"><div class="application--questions"><label for="question_1">LinkedIn</label><input id="question_1"></div></form>`;
  const resolve = (url: string, html: string) => {
    document.body.innerHTML = html;
    const { adapter, reason } = resolvePageAdapter({ url, root: document });
    return `${adapter.id}/${reason}`;
  };

  it.each([
    ['strong Workday host', 'https://acme.wd1.myworkdayjobs.com/careers', '', 'workday/host'],
    ['strong Greenhouse host', 'https://boards.greenhouse.io/acme/jobs/1', '', 'greenhouse/host'],
    ['Workday structure', 'https://careers.example.com/apply', WORKDAY_DOM, 'workday/structure'],
    [
      'Greenhouse structure',
      'https://careers.example.com/apply',
      GREENHOUSE_DOM,
      'greenhouse/structure',
    ],
    [
      'plain form',
      'https://careers.example.com/apply',
      '<form><input></form>',
      'generic/no-evidence',
    ],
  ])('%s', (_, url, html, expected) => expect(resolve(url, html)).toBe(expected));

  it.each([
    [
      'Workday DOM + Greenhouse text',
      'https://careers.example.com/apply',
      `${WORKDAY_DOM}<p>We use Greenhouse at greenhouse.io</p>`,
      'workday/structure',
    ],
    [
      'Greenhouse form + Workday text and a lone automation id',
      'https://careers.example.com/apply',
      `${GREENHOUSE_DOM}<p>Apply via Workday</p><div data-automation-id="x"></div>`,
      'greenhouse/structure',
    ],
    [
      'both structures on one page (conflict)',
      'https://careers.example.com/apply',
      WORKDAY_DOM + GREENHOUSE_DOM,
      'generic/conflict',
    ],
    [
      'Greenhouse host beats Workday structure',
      'https://job-boards.greenhouse.io/acme/jobs/1',
      WORKDAY_DOM,
      'greenhouse/host',
    ],
    [
      'Workday host beats Greenhouse structure',
      'https://acme.wd5.myworkdayjobs.com/x',
      GREENHOUSE_DOM,
      'workday/host',
    ],
    [
      'several weak indicators only',
      'https://careers.example.com/apply',
      `<form id="application-form"><input></form><input data-uxi-widget-type="inputField"><p>Workday Greenhouse</p>`,
      'generic/no-evidence',
    ],
  ])('conflicting signals: %s', (_, url, html, expected) =>
    expect(resolve(url, html)).toBe(expected),
  );

  it.each([
    ['evilmyworkdayjobs.com', 'https://evilmyworkdayjobs.com/apply', 'generic/no-evidence'],
    [
      'myworkdayjobs.com.evil.example',
      'https://myworkdayjobs.com.evil.example/',
      'generic/no-evidence',
    ],
    ['bare myworkdayjobs.com', 'https://myworkdayjobs.com/', 'generic/no-evidence'],
    [
      'greenhouse.io.evil.example',
      'https://job-boards.greenhouse.io.evil.example/x',
      'generic/no-evidence',
    ],
    ['notgreenhouse.io', 'https://boards.notgreenhouse.io/x', 'generic/no-evidence'],
    ['greenhouse marketing site', 'https://www.greenhouse.io/careers', 'generic/no-evidence'],
    ['uppercase host', 'https://ACME.WD5.MYWORKDAYJOBS.COM/x', 'workday/host'],
    [
      'uppercase Greenhouse host',
      'https://JOB-BOARDS.GREENHOUSE.IO/acme/jobs/1',
      'greenhouse/host',
    ],
    ['port', 'https://job-boards.greenhouse.io:8443/acme/jobs/1', 'greenhouse/host'],
    ['trailing dot', 'https://job-boards.greenhouse.io./acme/jobs/1', 'greenhouse/host'],
    ['Workday trailing dot', 'https://acme.wd5.myworkdayjobs.com./x', 'workday/host'],
    [
      'credentials in the URL',
      'https://job-boards.greenhouse.io@evil.example/x',
      'generic/no-evidence',
    ],
    ['not a URL', 'nonsense', 'generic/no-evidence'],
  ])('host matching: %s', (_, url, expected) => expect(resolve(url, '')).toBe(expected));

  it.each(['http://localhost:5173/apply', 'http://127.0.0.1:8080/apply'])(
    'a localhost fixture is detected only by its structure (%s)',
    (url) => {
      expect(resolve(url, GREENHOUSE_DOM)).toBe('greenhouse/structure');
      expect(resolve(url, WORKDAY_DOM)).toBe('workday/structure');
      expect(resolve(url, '<form><input></form>')).toBe('generic/no-evidence');
    },
  );

  it.each([
    ['hidden Greenhouse form', `<div hidden>${GREENHOUSE_DOM}</div>`],
    ['display:none Workday container', `<div style="display:none">${WORKDAY_DOM}</div>`],
    ['template markup', `<template>${WORKDAY_DOM}${GREENHOUSE_DOM}</template>`],
    [
      'partial Greenhouse form (no question section)',
      '<form id="application-form"><input id="question_1"></form>',
    ],
    [
      'question section without the form',
      '<div class="application--questions"><input id="question_1"></div>',
    ],
    [
      'platform names inside unrelated content',
      '<article><h1>Workday vs Greenhouse</h1><p>data-automation-id applyFlowPage application-form</p></article>',
    ],
    ['a lone class name', '<div class="select__control"><input class="select__input"></div>'],
    ['duplicate Greenhouse forms', GREENHOUSE_DOM + GREENHOUSE_DOM],
  ])('DOM safety: %s → generic', (_, html) =>
    expect(resolve('https://careers.example.com/apply', html)).toBe('generic/no-evidence'),
  );
});

describe('platform scan failure: a clear unsupported result, never a silent fallback', () => {
  it.each([
    [
      'workday',
      'https://acme.wd5.myworkdayjobs.com/x',
      `<div data-automation-id="applyFlowPage"><label for="a">City</label><input id="a"></div><div data-automation-id="applyFlowPage"><label for="b">City</label><input id="b"></div>`,
    ],
    [
      'greenhouse',
      'https://job-boards.greenhouse.io/acme/jobs/1',
      `<form id="application-form"><label for="a">City</label><input id="a"></form><form id="application-form"><label for="b">City</label><input id="b"></form>`,
    ],
  ])(
    '%s with two application containers: scan throws, fill reports unsupported',
    async (platform, url, html) => {
      document.body.innerHTML = html;
      const adapter = resolvePageAdapter({ url, root: document }).adapter;
      expect(adapter.id).toBe(platform);
      expect(() => adapter.getFields({ url, root: document })).toThrow();
      const results = await adapter.fillFields({ url, root: document }, [
        {
          fieldId: 'id:a',
          value: 'Springfield',
          expected: { type: 'text', htmlId: 'a', label: 'City' },
        },
      ]);
      expect(results).toEqual([
        {
          fieldId: 'id:a',
          status: 'unsupported',
          message: 'ApplyOnce cannot read this page safely now. Analyze it again.',
        },
      ]);
      expect((document.getElementById('a') as HTMLInputElement).value).toBe('');
    },
  );
});
