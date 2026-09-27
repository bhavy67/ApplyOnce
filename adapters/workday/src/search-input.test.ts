// @vitest-environment happy-dom
import type { FillInstruction, FillValue } from '@applyonce/core';
import {
  createAliasMatcher,
  createMappingKey,
  createMappingKeyParts,
  mapFields,
} from '@applyonce/field-mapper';
import { beforeEach, describe, expect, it } from 'vitest';
import { fillWorkday, scanWorkdayFields } from './index';

const TIMING = {
  searchTiming: { timeoutMs: 400, intervalMs: 10 },
  customControlTiming: { timeoutMs: 300, intervalMs: 10 },
};

interface Suggestion {
  label: string;
  value?: string;
  html?: string;
  submit?: boolean;
}

interface SearchConfig {
  auto: string;
  label: string;
  results?: (query: string) => Suggestion[];
  relationship?:
    'controls' | 'owns' | 'controlsWhenOpen' | 'activedescendant' | 'expandedOnly' | 'none';
  role?: boolean;
  autocomplete?: 'list' | 'both';
  delayMs?: number;
  staleFirst?: Suggestion[];
  portal?: boolean;
  confirm?: 'value' | 'aria-selected' | 'pill' | 'none' | 'other-value';
  trustedOnly?: boolean;
  openOnArrowOnly?: boolean;
  twoLists?: boolean;
}

let generated = 0;

/** A Workday-style search field: typing shows suggestions; clicking one selects it. */
function mountSearch(config: SearchConfig) {
  const {
    auto,
    label,
    results = () => [],
    relationship = 'controls',
    role = true,
    autocomplete = 'list',
    confirm = 'value',
  } = config;
  generated += 1;
  const inputId = `input-${generated}`;
  const listId = `${auto}-list`;
  const state = { typedEvents: 0, clicks: 0, selected: '' };

  const container = document.createElement('div');
  container.setAttribute('data-automation-id', `formField-${auto}`);
  container.innerHTML = `<label for="${inputId}">${label}<abbr title="required">*</abbr></label>`;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = inputId;
  input.setAttribute('data-automation-id', auto);
  input.setAttribute('aria-autocomplete', autocomplete);
  if (role) input.setAttribute('role', 'combobox');
  if (relationship !== 'none') input.setAttribute('aria-expanded', 'false');
  if (relationship === 'controls')
    input.setAttribute('aria-controls', config.twoLists ? `${listId} ${listId}-2` : listId);
  if (relationship === 'owns') input.setAttribute('aria-owns', listId);
  container.append(input);
  container.insertAdjacentHTML(
    'beforeend',
    `<input type="text" data-automation-id="${auto}-helper" style="display:none">`,
  );
  document.getElementById('step')?.append(container);

  let lists: HTMLElement[] = [];
  const close = () => {
    input.setAttribute('aria-expanded', 'false');
    if (relationship === 'controlsWhenOpen') input.removeAttribute('aria-controls');
    lists.forEach((list) => list.remove());
    lists = [];
  };
  const render = (items: Suggestion[]) => {
    for (const list of lists) {
      list.innerHTML = '';
      items.forEach((item, index) => {
        const option = document.createElement(item.submit ? 'button' : 'div');
        if (item.submit) (option as HTMLButtonElement).type = 'submit';
        option.setAttribute('role', 'option');
        option.id = `${listId}-option-${index}`;
        if (item.value) option.setAttribute('data-value', item.value);
        option.innerHTML = item.html ?? item.label;
        option.addEventListener('click', () => {
          state.clicks += 1;
          if (confirm === 'none') return;
          state.selected = item.label;
          if (confirm === 'pill') {
            input.value = '';
            container.insertAdjacentHTML(
              'beforeend',
              `<div data-automation-id="selectedItem">${item.label}</div>`,
            );
            return close();
          }
          if (confirm === 'aria-selected') {
            option.setAttribute('aria-selected', 'true');
            return;
          }
          input.value = confirm === 'other-value' ? `${item.label} (pending)` : item.label;
          close();
        });
        list.append(option);
        if (relationship === 'activedescendant' && index === 0)
          input.setAttribute('aria-activedescendant', option.id);
      });
    }
  };
  const open = (query: string) => {
    close();
    input.setAttribute('aria-expanded', 'true');
    if (relationship === 'controlsWhenOpen') input.setAttribute('aria-controls', listId);
    const ids = config.twoLists ? [listId, `${listId}-2`] : [listId];
    lists = ids.map((id) => {
      const list = document.createElement('div');
      list.id = id;
      list.setAttribute('role', 'listbox');
      (config.portal ? document.body : container).append(list);
      return list;
    });
    if (config.staleFirst) render(config.staleFirst);
    const show = () => render(results(query));
    if (config.delayMs) setTimeout(show, config.delayMs);
    else show();
  };
  input.addEventListener('input', (event) => {
    state.typedEvents += 1;
    if (config.trustedOnly && !event.isTrusted) return;
    if (config.openOnArrowOnly) return;
    if (input.value) open(input.value);
    else close();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowDown' && input.value && !(config.trustedOnly && !event.isTrusted))
      open(input.value);
  });
  return { input, state, close, isOpen: () => input.getAttribute('aria-expanded') === 'true' };
}

function step(html = '') {
  document.body.innerHTML = `<div data-automation-id="applyFlowPage"><div id="step">${html}</div>
    <button type="button" data-automation-id="pageFooterNextButton" id="next">Save and Continue</button></div>`;
}

const UNIVERSITIES = (query: string): Suggestion[] =>
  ['University of Example', 'Example State University', 'Sample College']
    .filter((name) => name.toLowerCase().includes(query.toLowerCase().split(' ')[0] ?? ''))
    .map((label) => ({ label }));

function instructionFor(fieldId: string, value: FillValue): FillInstruction {
  const field = scanWorkdayFields(document).find((f) => f.id === fieldId);
  if (!field) throw new Error(`No field ${fieldId}`);
  const { name, htmlId, label } = field.signals;
  return { fieldId, value, expected: { type: field.type, name, htmlId, label } };
}

async function fillOne(fieldId: string, value: FillValue) {
  const [result] = await fillWorkday(document, [instructionFor(fieldId, value)], TIMING);
  return result;
}

beforeEach(() => {
  generated = 0;
  step();
});

describe('detection', () => {
  it.each([
    [
      'role=combobox + aria-autocomplete=list + aria-controls',
      { relationship: 'controls' as const },
    ],
    [
      'aria-autocomplete=both + aria-owns',
      { relationship: 'owns' as const, autocomplete: 'both' as const, role: false },
    ],
    [
      'aria-expanded only (controls appear when open)',
      { relationship: 'controlsWhenOpen' as const },
    ],
  ])('%s → one supported search field', (_, config) => {
    mountSearch({ auto: 'school', label: 'School or University', ...config });
    expect(scanWorkdayFields(document)).toEqual([
      {
        id: 'key:school',
        type: 'text',
        htmlType: 'search',
        required: false,
        visible: true,
        disabled: false,
        custom: { pattern: 'search-input', supported: true },
        signals: { label: 'School or University*' },
        // Phase 14: every scanned field has a semantic identity (unique here).
        identity: { key: expect.stringMatching(/^fp-[0-9a-f]{16}$/) as string, unique: true },
      },
    ]);
  });

  it('keeps a search field without any popup relationship unsupported', () => {
    mountSearch({ auto: 'school', label: 'University', relationship: 'none', role: false });
    expect(scanWorkdayFields(document)[0]?.custom).toEqual({
      pattern: 'search-input',
      supported: false,
    });
  });

  it('keeps an ordinary text input a text field, and a combobox without aria-autocomplete a dropdown', () => {
    step(`
      <div data-automation-id="formField-a"><label for="a">City</label><input id="a" type="text" data-automation-id="city"></div>
      <div data-automation-id="formField-b"><label for="b">Country</label><input id="b" role="combobox" aria-controls="b-list" aria-expanded="false" data-automation-id="country"></div>`);
    expect(scanWorkdayFields(document).map((f) => [f.type, f.custom?.pattern])).toEqual([
      ['text', undefined],
      ['select', 'input-combobox'],
    ]);
  });

  it('uses the label as the question, never the current value or suggestions', () => {
    const { input } = mountSearch({ auto: 'school', label: 'University', results: UNIVERSITIES });
    input.value = 'University of Example';
    input.dispatchEvent(new Event('input'));
    expect(scanWorkdayFields(document).map((f) => f.signals.label)).toEqual(['University*']);
  });

  it('maps search fields like text fields (institution, field of study, city, company)', () => {
    for (const [auto, label] of [
      ['school', 'University'],
      ['major', 'Field of Study'],
      ['city', 'City'],
      ['employer', 'Current Company'],
    ]) {
      mountSearch({ auto: auto ?? '', label: label ?? '' });
    }
    const mappings = mapFields(scanWorkdayFields(document), createAliasMatcher()).mappings;
    expect(mappings.map((m) => [m.status, m.profileField])).toEqual([
      ['mapped', 'institution'],
      ['mapped', 'field_of_study'],
      ['mapped', 'city'],
      ['mapped', 'current_company'],
    ]);
  });
});

describe('filling', () => {
  it('types the approved value once, selects the unique suggestion, and confirms it', async () => {
    const widget = mountSearch({ auto: 'school', label: 'University', results: UNIVERSITIES });
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'filled',
    });
    expect(widget.input.value).toBe('University of Example');
    expect(widget.state).toMatchObject({
      typedEvents: 1,
      clicks: 1,
      selected: 'University of Example',
    });
    expect(widget.isOpen()).toBe(false);
  });

  it.each([
    ['delayed suggestions', { delayMs: 60 }],
    [
      'stale results replaced by the final list',
      { staleFirst: [{ label: 'Loading…' }], delayMs: 40 },
    ],
    ['a portal list', { portal: true }],
    ['aria-owns', { relationship: 'owns' as const }],
    ['aria-controls only while open', { relationship: 'controlsWhenOpen' as const }],
    ['aria-activedescendant', { relationship: 'activedescendant' as const }],
    ['confirmation through aria-selected', { confirm: 'aria-selected' as const }],
    ['confirmation through a Workday selected-item pill', { confirm: 'pill' as const }],
    ['a list that opens only on ArrowDown', { openOnArrowOnly: true }],
  ])('handles %s', async (_, config) => {
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      results: UNIVERSITIES,
      ...config,
    });
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'filled',
    });
    expect(widget.state.selected).toBe('University of Example');
  });

  it.each([
    [
      'exact value metadata',
      [
        { label: 'UoE (main campus)', value: 'University of Example' },
        { label: 'Other', value: 'x' },
      ],
      'UoE (main campus)',
    ],
    [
      'normalized spacing',
      [{ label: 'University   of  Example' }, { label: 'Other' }],
      'University   of  Example',
    ],
    [
      'punctuation',
      [{ label: 'University-of-Example' }, { label: 'Other' }],
      'University-of-Example',
    ],
    [
      'decorative content',
      [
        {
          label: 'University of Example',
          html: '<span>University of Example</span><span aria-hidden="true">✓</span>',
        },
      ],
      'University of Example',
    ],
  ])('matches by %s', async (_, suggestions, selected) => {
    const widget = mountSearch({ auto: 'school', label: 'University', results: () => suggestions });
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'filled',
    });
    expect(widget.state.selected).toBe(selected);
  });

  it.each([
    [
      'duplicate suggestions',
      [{ label: 'University of Example' }, { label: 'university of example' }],
      'No unique suggestion matched',
    ],
    [
      'a suggestion extending the value',
      [{ label: 'University of Example' }, { label: 'University of Example, Ahmedabad' }],
      'No unique suggestion matched',
    ],
    [
      'only a different order of words',
      [{ label: 'Example University' }],
      'No matching suggestion',
    ],
    [
      'only a longer name',
      [{ label: 'University of Example at Springfield' }],
      'No matching suggestion',
    ],
    ['no suggestions at all', [], 'No suggestions appeared'],
  ])(
    'fails on %s without clicking, and removes the typed text',
    async (_, suggestions, message) => {
      const widget = mountSearch({
        auto: 'school',
        label: 'University',
        results: () => suggestions,
      });
      const result = await fillOne('key:school', 'University of Example');
      expect(result).toMatchObject({ status: 'failed' });
      expect(result?.message).toMatch(new RegExp(`^${message}.*The typed text was removed\\.$`));
      expect(widget.state.clicks).toBe(0);
      expect(widget.input.value).toBe('');
      expect(widget.isOpen()).toBe(false);
    },
  );

  it('fails when the selection cannot be confirmed, and cleans up', async () => {
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      results: UNIVERSITIES,
      confirm: 'none',
    });
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'failed',
      message: 'Unable to confirm autocomplete selection. The typed text was removed.',
    });
    expect(widget.input.value).toBe('');
  });

  it('never removes text the widget replaced, and says so', async () => {
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      results: UNIVERSITIES,
      confirm: 'other-value',
    });
    const result = await fillOne('key:school', 'University of Example');
    expect(result).toMatchObject({ status: 'failed' });
    expect(result?.message).toMatch(/could not be removed; please check this field\.$/);
    expect(widget.input.value).toBe('University of Example (pending)');
  });

  it('fails safely when the widget ignores synthetic input', async () => {
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      results: UNIVERSITIES,
      trustedOnly: true,
    });
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'failed',
    });
    expect(widget.state.clicks).toBe(0);
    expect(widget.input.value).toBe('');
  });

  it.each([
    ['several attached lists', { twoLists: true }, 'Several suggestion lists'],
    [
      'a list that never appears',
      { relationship: 'expandedOnly' as const },
      'No suggestions appeared',
    ],
  ])('fails on %s', async (_, config, message) => {
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      results: UNIVERSITIES,
      ...config,
    });
    const result = await fillOne('key:school', 'University of Example');
    expect(result?.message).toMatch(new RegExp(`^${message}`));
    expect(widget.input.value).toBe('');
  });

  it('never clicks a suggestion that is a submit button', async () => {
    document.body.innerHTML = `<div data-automation-id="applyFlowPage"><form id="f"><div id="step"></div></form></div>`;
    let submitted = false;
    document.getElementById('f')?.addEventListener('submit', (event) => {
      submitted = true;
      event.preventDefault();
    });
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      results: () => [{ label: 'University of Example', submit: true }],
    });
    const result = await fillOne('key:school', 'University of Example');
    expect(result?.message).toMatch(/^The suggestion is a submit or navigation button/);
    expect(submitted).toBe(false);
    expect(widget.state.clicks).toBe(0);
    expect(widget.input.value).toBe('');
  });
});

describe('existing values and safety', () => {
  it('skips a field that already has text, without typing', async () => {
    const widget = mountSearch({ auto: 'school', label: 'University', results: UNIVERSITIES });
    widget.input.value = 'Sample College';
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'skipped',
    });
    expect(widget.state.typedEvents).toBe(0);
    expect(widget.input.value).toBe('Sample College');
  });

  it('skips a field that already shows a Workday selected-item pill', async () => {
    const widget = mountSearch({ auto: 'school', label: 'University', results: UNIVERSITIES });
    widget.input.parentElement?.insertAdjacentHTML(
      'beforeend',
      '<div data-automation-id="selectedItem">Sample College</div>',
    );
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'skipped',
    });
    expect(widget.state.typedEvents).toBe(0);
  });

  it('skips a field whose open list shows a selected suggestion', async () => {
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      results: () => [{ label: 'Sample College' }],
    });
    widget.input.value = 'x';
    widget.input.dispatchEvent(new Event('input'));
    document.querySelector('[role=option]')?.setAttribute('aria-selected', 'true');
    widget.input.value = '';
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'skipped',
    });
  });

  it('keeps an unsupported search field untouched', async () => {
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      relationship: 'none',
      role: false,
      results: UNIVERSITIES,
    });
    expect(await fillOne('key:school', 'University of Example')).toMatchObject({
      status: 'unsupported',
    });
    expect(widget.state.typedEvents).toBe(0);
  });

  it('refuses yes/no values', async () => {
    const widget = mountSearch({ auto: 'school', label: 'University', results: UNIVERSITIES });
    expect(await fillOne('key:school', true)).toMatchObject({ status: 'unsupported' });
    expect(widget.state.typedEvents).toBe(0);
  });

  it('rediscovers a re-rendered field (new generated ids) and reports a changed one', async () => {
    mountSearch({ auto: 'school', label: 'University', results: UNIVERSITIES });
    const instructions = [instructionFor('key:school', 'University of Example')];
    step();
    generated = 50;
    const widget = mountSearch({
      auto: 'school',
      label: 'University',
      results: UNIVERSITIES,
      portal: true,
    });
    expect((await fillWorkday(document, instructions, TIMING))[0]).toMatchObject({
      status: 'filled',
    });
    expect(widget.state.selected).toBe('University of Example');

    step();
    step(
      '<div data-automation-id="formField-school"><label for="z">University</label><input id="z" type="email" data-automation-id="school"></div>',
    );
    expect((await fillWorkday(document, instructions, TIMING))[0]).toMatchObject({
      status: 'not-found',
    });
  });

  it('keeps filling other fields after a search field fails, and never navigates', async () => {
    let navigation = 0;
    document.getElementById('next')?.addEventListener('click', () => (navigation += 1));
    const failing = mountSearch({ auto: 'school', label: 'University', results: () => [] });
    const major = mountSearch({
      auto: 'major',
      label: 'Field of Study',
      results: () => [{ label: 'Physics' }, { label: 'Physical Education' }],
    });
    document
      .getElementById('step')
      ?.insertAdjacentHTML(
        'beforeend',
        '<div data-automation-id="formField-city"><label for="c">City</label><input id="c" type="text" data-automation-id="cityText"></div>',
      );
    const results = await fillWorkday(
      document,
      [
        instructionFor('key:school', 'University of Example'),
        instructionFor('key:major', 'Physics'),
        instructionFor('key:cityText', 'Springfield'),
      ],
      TIMING,
    );
    expect(results.map((r) => r.status)).toEqual(['failed', 'filled', 'filled']);
    expect(failing.input.value).toBe('');
    expect(major.state.selected).toBe('Physics');
    expect(navigation).toBe(0);
  });
});

describe('Teach Once', () => {
  it('a taught search question maps again after a re-render with new generated ids', () => {
    mountSearch({ auto: 'school', label: 'What university did you attend?' });
    const [field] = scanWorkdayFields(document);
    if (!field) throw new Error('no field');
    const key = createMappingKey(field);
    const parts = createMappingKeyParts(field);
    if (!key || !parts) throw new Error('no key');
    expect(key).not.toContain('input-');
    const saved = new Map([
      [
        key,
        {
          key,
          parts,
          profileField: 'institution' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);

    step();
    generated = 90;
    mountSearch({ auto: 'school', label: 'What university did you attend?' });
    const [mapping] = mapFields(scanWorkdayFields(document), createAliasMatcher(), saved).mappings;
    expect(mapping).toMatchObject({ source: 'taught', profileField: 'institution' });
  });
});
