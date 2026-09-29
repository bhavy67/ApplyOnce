// @vitest-environment happy-dom
import type { FillInstruction, FillValue } from '@applyonce/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { fillFields, findMatchingOption, toBoolean } from './fill-fields';
import { scanFields } from './scan-fields';

/** Builds an instruction from the page as it is now, like analysis would. */
function instructionFor(fieldId: string, value: FillValue): FillInstruction {
  const field = scanFields(document).find((f) => f.id === fieldId);
  if (!field) throw new Error(`No field ${fieldId}`);
  const { name, htmlId, label } = field.signals;
  return { fieldId, value, expected: { type: field.type, name, htmlId, label } };
}

async function fillOne(fieldId: string, value: FillValue) {
  const [result] = await fillFields(document, [instructionFor(fieldId, value)]);
  return result;
}

const input = (selector: string) => document.querySelector(selector) as HTMLInputElement;

function element(selector: string): Element {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

function recordEvents(selector: string) {
  const events: string[] = [];
  const element = document.querySelector(selector);
  for (const type of ['input', 'change', 'click']) {
    element?.addEventListener(type, () => events.push(type));
  }
  return events;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('text-like fields', () => {
  it.each([
    ['<input id="f" type="text">', 'Jane'],
    ['<input id="f" type="email">', 'jane.doe@example.com'],
    ['<input id="f" type="tel">', '+1 555 010 0199'],
    ['<input id="f" type="number">', 4.5],
    ['<textarea id="f"></textarea>', 'Multi-line text'],
  ] as const)('%s is filled and notified with input + change', async (html, value) => {
    document.body.innerHTML = html;
    const events = recordEvents('#f');

    expect(await fillOne('id:f', value)).toEqual({
      fieldId: 'id:f',
      status: 'filled',
      message: 'Filled.',
    });
    expect(input('#f').value).toBe(String(value));
    expect(events).toEqual(['input', 'change']);
  });

  it('writes through the native setter so framework value trackers see the change', async () => {
    document.body.innerHTML = '<input id="f">';
    const element = input('#f');
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    // Simulates React's value tracking: an instance property remembering the last value
    // the framework itself saw.
    let tracked = '';
    Object.defineProperty(element, 'value', {
      configurable: true,
      get: () => native?.get?.call(element) as string,
      set: (next: string) => {
        tracked = next;
        native?.set?.call(element, next);
      },
    });
    let frameworkSawChange = false;
    element.addEventListener('input', () => {
      frameworkSawChange = element.value !== tracked;
    });

    await fillOne('id:f', 'Jane');
    expect(frameworkSawChange).toBe(true);
  });

  it('does not overwrite an existing value', async () => {
    document.body.innerHTML = '<input id="f" value="Already typed">';
    expect(await fillOne('id:f', 'Jane')).toMatchObject({ status: 'skipped' });
    expect(input('#f').value).toBe('Already typed');
  });

  it('refuses non-numeric values for number fields and yes/no values for text', async () => {
    document.body.innerHTML = '<input id="n" type="number"><input id="t">';
    expect(await fillOne('id:n', 'four')).toMatchObject({ status: 'failed' });
    expect(await fillOne('id:t', true)).toMatchObject({ status: 'unsupported' });
    expect(input('#t').value).toBe('');
  });
});

describe('select', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="country">
        <option value="">Select…</option>
        <option value="CA">Canada</option>
        <option value="IN">India</option>
        <option value="us">United  States</option>
      </select>`;
  });
  const select = () => document.querySelector('#country') as HTMLSelectElement;

  it.each([
    ['CA', 'CA'],
    ['in', 'IN'],
    ['India', 'IN'],
    [' united states ', 'us'],
  ])('%j selects %s', async (value, expected) => {
    const events = recordEvents('#country');
    expect(await fillOne('id:country', value)).toMatchObject({ status: 'filled' });
    expect(select().value).toBe(expected);
    expect(events).toEqual(['input', 'change']);
  });

  it('fails without changing the selection when no option matches', async () => {
    expect(await fillOne('id:country', 'Atlantis')).toMatchObject({ status: 'failed' });
    expect(select().value).toBe('');
  });
});

describe('checkbox', () => {
  beforeEach(() => {
    document.body.innerHTML = '<label><input id="c" type="checkbox"> Willing to relocate</label>';
  });

  it.each([true, 'yes'] as const)('%j checks an unchecked box', async (value) => {
    expect(await fillOne('id:c', value)).toMatchObject({ status: 'filled' });
    expect(input('#c').checked).toBe(true);
  });

  it('leaves an unchecked box alone for false (it already matches)', async () => {
    expect(await fillOne('id:c', false)).toMatchObject({ status: 'skipped' });
    expect(input('#c').checked).toBe(false);
  });

  it('never unchecks a checked box (an existing answer)', async () => {
    input('#c').checked = true;
    const events = recordEvents('#c');
    expect(await fillOne('id:c', false)).toMatchObject({
      status: 'skipped',
      message: 'The field already has a value.',
    });
    expect(await fillOne('id:c', true)).toMatchObject({
      status: 'skipped',
      message: 'The field already matches your profile.',
    });
    expect(input('#c').checked).toBe(true);
    expect(events).toEqual([]);
  });

  it.each(['maybe', 3])('rejects non yes/no value %j', async (value) => {
    expect(await fillOne('id:c', value)).toMatchObject({ status: 'failed' });
    expect(input('#c').checked).toBe(false);
  });
});

describe('radio', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <fieldset><legend>Do you require sponsorship?</legend>
        <label><input type="radio" name="sponsorship" value="1"> Yes</label>
        <label><input type="radio" name="sponsorship" value="0"> No</label>
      </fieldset>`;
  });
  const checkedValues = () =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input:checked')).map((r) => r.value);

  it('selects only the option matching the profile value', async () => {
    expect(await fillOne('radio:sponsorship', false)).toMatchObject({ status: 'filled' });
    expect(checkedValues()).toEqual(['0']);
  });

  it('never switches an already chosen option', async () => {
    await fillOne('radio:sponsorship', false);
    expect(await fillOne('radio:sponsorship', true)).toMatchObject({
      status: 'skipped',
      message: 'The field already has a value.',
    });
    expect(await fillOne('radio:sponsorship', false)).toMatchObject({
      status: 'skipped',
      message: 'The field already matches your profile.',
    });
    expect(checkedValues()).toEqual(['0']);
  });

  it('fails and selects nothing when no option matches', async () => {
    expect(await fillOne('radio:sponsorship', 'Sometimes')).toMatchObject({ status: 'failed' });
    expect(checkedValues()).toEqual([]);
  });
});

describe('page changes and failures', () => {
  it('reports a removed field as not found and still fills the others', async () => {
    document.body.innerHTML = '<input id="a"><input id="b">';
    const instructions = [instructionFor('id:a', 'A'), instructionFor('id:b', 'B')];
    input('#a').remove();

    expect((await fillFields(document, instructions)).map((r) => r.status)).toEqual([
      'not-found',
      'filled',
    ]);
    expect(input('#b').value).toBe('B');
  });

  it('fills a field that was re-rendered as an equivalent element', async () => {
    document.body.innerHTML = '<div id="root"><input id="email" name="email" type="email"></div>';
    const instruction = instructionFor('id:email', 'jane.doe@example.com');
    element('#root').innerHTML = '<input id="email" name="email" type="email">';

    expect((await fillFields(document, [instruction]))[0]).toMatchObject({ status: 'filled' });
  });

  it('does not fill a field replaced by a different one under the same id', async () => {
    document.body.innerHTML = '<input><input>';
    const instruction = instructionFor('index:1', 'value');
    document.body.innerHTML = '<input><input type="email" name="other">';

    expect((await fillFields(document, [instruction]))[0]).toMatchObject({ status: 'not-found' });
  });

  it.each([
    ['hidden', 'style="display:none"'],
    ['disabled', 'disabled'],
  ])('skips a field that became %s', async (_, attribute) => {
    document.body.innerHTML = '<input id="f">';
    const instruction = instructionFor('id:f', 'x');
    document.body.innerHTML = `<input id="f" ${attribute}>`;
    expect((await fillFields(document, [instruction]))[0]).toMatchObject({ status: 'skipped' });
  });

  it('reports an unknown field id as not found', async () => {
    document.body.innerHTML = '<input id="f">';
    const instruction: FillInstruction = {
      fieldId: 'id:ghost',
      value: 'x',
      expected: { type: 'text' },
    };
    expect((await fillFields(document, [instruction]))[0]).toMatchObject({ status: 'not-found' });
  });

  it('contains an error in one field without breaking the rest', async () => {
    document.body.innerHTML = '<input id="c" type="checkbox"><input id="t">';
    const instructions = [instructionFor('id:c', true), instructionFor('id:t', 'T')];
    input('#c').click = () => {
      throw new Error('page script error');
    };

    expect((await fillFields(document, instructions)).map((r) => r.status)).toEqual([
      'failed',
      'filled',
    ]);
  });

  it('never submits the form', async () => {
    document.body.innerHTML = '<form><input id="f"><button type="submit">Send</button></form>';
    let submitted = false;
    element('form').addEventListener('submit', (event) => {
      submitted = true;
      event.preventDefault();
    });
    await fillOne('id:f', 'Jane');
    expect(submitted).toBe(false);
  });
});

describe('option matching helpers', () => {
  const options = [
    { value: 'y', label: 'Yes' },
    { value: 'n', label: 'No' },
  ];
  const describeOption = (o: (typeof options)[number]) => o;

  it('maps booleans to yes/no options', async () => {
    expect(findMatchingOption(options, describeOption, true)).toBe(options[0]);
    expect(findMatchingOption(options, describeOption, false)).toBe(options[1]);
  });

  it('reports ambiguity instead of guessing', async () => {
    const duplicate = [...options, { value: 'y2', label: 'yes' }];
    expect(findMatchingOption(duplicate, describeOption, 'Yes')).toBe('ambiguous');
    // A stricter stage with a single match wins before labels are compared.
    const byValue = [...options, { value: 'yes', label: 'Yes please' }];
    expect(findMatchingOption(byValue, describeOption, 'Yes')).toBe(byValue[2]);
  });

  it.each([
    [true, true],
    ['No', false],
    ['TRUE', true],
    ['perhaps', undefined],
    [1, undefined],
  ] as const)('toBoolean(%j) → %j', async (value, expected) => {
    expect(toBoolean(value)).toBe(expected);
  });
});

describe('Phase 5 value types', () => {
  it.each([
    [
      '<option value="remote">Remote</option><option value="hybrid">Hybrid</option>',
      'remote',
      'remote',
    ],
    [
      '<option value="Remote">REMOTE</option><option value="Hybrid">HYBRID</option>',
      'remote',
      'Remote',
    ],
    ['<option value="1">Remote</option><option value="2">Hybrid</option>', 'hybrid', '2'],
    ['<option value="os">On-site</option><option value="r">Remote</option>', 'onsite', 'os'],
    [
      '<option value="FT">Full time</option><option value="PT">Part time</option>',
      'full-time',
      'FT',
    ],
    [
      '<option value="full_time">Full-Time</option><option value="contract">Contract</option>',
      'full-time',
      'full_time',
    ],
  ])('work mode / employment type select %s with %j → %s', async (options, value, expected) => {
    document.body.innerHTML = `<select id="s"><option value="">Select…</option>${options}</select>`;
    expect(await fillOne('id:s', value)).toMatchObject({ status: 'filled' });
    expect((document.querySelector('#s') as HTMLSelectElement).value).toBe(expected);
  });

  it('does not treat a combined option such as "Remote / Hybrid" as Remote', async () => {
    document.body.innerHTML =
      '<select id="s"><option value="">Select…</option><option value="rh">Remote / Hybrid</option><option value="o">On-site</option></select>';
    expect(await fillOne('id:s', 'remote')).toMatchObject({ status: 'failed' });
    expect((document.querySelector('#s') as HTMLSelectElement).value).toBe('');
  });

  it('refuses to guess between options that only differ in punctuation', async () => {
    document.body.innerHTML =
      '<select id="s"><option value="a">Full-time</option><option value="b">Full time</option></select>';
    expect(await fillOne('id:s', 'fulltime')).toMatchObject({ status: 'failed' });
  });

  it('fills a work mode radio group', async () => {
    document.body.innerHTML = `
      <fieldset><legend>Work mode</legend>
        <label><input type="radio" name="mode" value="r"> Remote</label>
        <label><input type="radio" name="mode" value="h"> Hybrid</label>
        <label><input type="radio" name="mode" value="o"> On-site</label>
      </fieldset>`;
    expect(await fillOne('radio:mode', 'onsite')).toMatchObject({ status: 'filled' });
    expect((document.querySelector('input:checked') as HTMLInputElement).value).toBe('o');
  });

  it.each([
    [4.5, '4.5'],
    [2019, '2019'],
    [0, '0'],
  ])('fills number %j', async (value, expected) => {
    document.body.innerHTML = '<input id="n" type="number">';
    expect(await fillOne('id:n', value)).toMatchObject({ status: 'filled' });
    expect(input('#n').value).toBe(expected);
  });

  it('selects a year from a graduation year dropdown', async () => {
    document.body.innerHTML =
      '<select id="y"><option value="">Year</option><option>2018</option><option>2019</option></select>';
    expect(await fillOne('id:y', 2019)).toMatchObject({ status: 'filled' });
    expect((document.querySelector('#y') as HTMLSelectElement).value).toBe('2019');
  });

  it('preserves URLs exactly', async () => {
    document.body.innerHTML = '<input id="u" type="url">';
    const url = 'https://www.linkedin.com/in/jane-doe-example?trk=Profile_Link';
    expect(await fillOne('id:u', url)).toMatchObject({ status: 'filled' });
    expect(input('#u').value).toBe(url);
  });
});

describe('Phase 6: select option safety', () => {
  const select = () => document.querySelector('#s') as HTMLSelectElement;
  const html = (options: string) =>
    `<select id="s"><option value="">Select…</option>${options}</select>`;

  it.each([
    [
      'duplicate labels',
      '<option value="a">Canada</option><option value="b">Canada</option>',
      'Canada',
    ],
    [
      'duplicate values',
      '<option value="CA">Canada</option><option value="CA">Canada (CA)</option>',
      'CA',
    ],
    [
      'case-only differences',
      '<option value="x">REMOTE</option><option value="y">remote</option>',
      'Remote',
    ],
    [
      'punctuation-only differences',
      '<option value="x">On-site</option><option value="y">On site</option>',
      'onsite',
    ],
  ])('fails safely on %s', async (_, options, value) => {
    document.body.innerHTML = html(options);
    expect(await fillOne('id:s', value)).toMatchObject({
      status: 'failed',
      message: 'More than one option matches.',
    });
    expect(select().value).toBe('');
  });

  it.each([
    ['disabled options', '<option value="ca" disabled>Canada</option>'],
    ['hidden options', '<option value="ca" hidden>Canada</option>'],
    ['empty options', '<option value="">Canada</option>'],
  ])('never selects %s', async (_, options) => {
    document.body.innerHTML = html(options);
    expect(await fillOne('id:s', 'Canada')).toMatchObject({ status: 'failed' });
    expect(select().selectedIndex).toBe(0);
  });

  it('never matches the placeholder option', async () => {
    document.body.innerHTML = html('<option value="ca">Canada</option>');
    expect(await fillOne('id:s', 'Select…')).toMatchObject({ status: 'failed' });
  });

  it.each([
    ['On-site', 'on-site'],
    ['On site', 'onsite'],
    ['on_site', 'onsite'],
    ['ON SITE', 'onsite'],
  ])('matches formatting variant %j for %j', async (label, value) => {
    document.body.innerHTML = html(
      `<option value="o">${label}</option><option value="r">Remote</option>`,
    );
    expect(await fillOne('id:s', value)).toMatchObject({ status: 'filled' });
    expect(select().value).toBe('o');
  });

  it('does not overwrite an option the user already selected', async () => {
    document.body.innerHTML = html(
      '<option value="ca">Canada</option><option value="in">India</option>',
    );
    // Set as a user would; happy-dom ignores the `selected` attribute in parsed HTML
    // (the attribute case is verified in real Chrome).
    select().value = 'in';
    expect(await fillOne('id:s', 'Canada')).toMatchObject({ status: 'skipped' });
    expect(select().value).toBe('in');
  });

  it('treats a first option explicitly marked selected by the page as a value', async () => {
    document.body.innerHTML =
      '<select id="s"><option value="ca">Canada</option><option value="in">India</option></select>';
    select().options[0]?.setAttribute('selected', '');
    expect(await fillOne('id:s', 'India')).toMatchObject({ status: 'skipped' });
  });

  it('treats a select showing its first option by default as unset', async () => {
    document.body.innerHTML =
      '<select id="s"><option value="ca">Canada</option><option value="in">India</option></select>';
    expect(await fillOne('id:s', 'India')).toMatchObject({ status: 'filled' });
    expect(select().value).toBe('in');
  });
});

describe('Phase 6: fill safety', () => {
  it.each([
    ['whitespace-only value', '<input id="f" value="   ">', 'filled'],
    ['typed value', '<input id="f" value="Jane">', 'skipped'],
    ['number value', '<input id="f" type="number" value="0">', 'skipped'],
    ['textarea content', '<textarea id="f">Hello</textarea>', 'skipped'],
  ])('%s → %s', async (_, html, status) => {
    document.body.innerHTML = html;
    const value = html.includes('number') ? 3 : 'New';
    expect(await fillOne('id:f', value)).toMatchObject({ status });
  });

  it.each([
    ['readonly', '<input id="f" readonly>'],
    ['aria-readonly', '<input id="f" aria-readonly="true">'],
    ['disabled', '<input id="f" disabled>'],
    ['hidden', '<input id="f" hidden>'],
    ['invisible', '<input id="f" style="visibility:hidden">'],
  ])('skips a %s field', async (_, html) => {
    document.body.innerHTML = '<input id="f">';
    const instruction = instructionFor('id:f', 'x');
    document.body.innerHTML = html;
    expect((await fillFields(document, [instruction]))[0]).toMatchObject({ status: 'skipped' });
    expect(input('#f').value).toBe('');
  });

  it('fills a field that is positioned off-screen', async () => {
    document.body.innerHTML = '<input id="f" style="position:absolute; left:-9999px">';
    expect(await fillOne('id:f', 'x')).toMatchObject({ status: 'filled' });
  });

  it.each([
    ['a changed type', '<input id="f" type="email">'],
    ['a changed name', '<input id="f" name="other">'],
  ])('reports a field with %s as not found', async (_, html) => {
    document.body.innerHTML = '<input id="f" name="first">';
    const instruction = instructionFor('id:f', 'x');
    document.body.innerHTML = html;
    expect((await fillFields(document, [instruction]))[0]).toMatchObject({ status: 'not-found' });
  });

  it('finds a field added after analysis only through a new analysis', async () => {
    document.body.innerHTML = '<input id="a">';
    const before = scanFields(document).map((f) => f.id);
    document.body.insertAdjacentHTML('beforeend', '<input id="b">');
    expect(before).toEqual(['id:a']);
    expect(scanFields(document).map((f) => f.id)).toEqual(['id:a', 'id:b']);
    expect(await fillOne('id:b', 'B')).toMatchObject({ status: 'filled' });
  });
});

describe('Phase 16: common fill pipeline hardening', () => {
  const listbox = (id: string, label: string, options: string) =>
    `<label id="${id}-l">${label}</label><div id="${id}" role="combobox" tabindex="0" aria-labelledby="${id}-l" aria-controls="${id}-list" aria-expanded="false"></div><ul id="${id}-list" role="listbox" hidden>${options}</ul>`;

  it('a page that submits its form when a field changes is stopped; the field fails, the next still fills', async () => {
    document.body.innerHTML = `<form id="f"><label for="a">City</label><input id="a"><label for="b">Company</label><input id="b"><button>Submit</button></form>`;
    let submitted = 0;
    const form = element('#f') as HTMLFormElement;
    form.addEventListener('submit', () => (submitted += 1));
    // A page script that submits as soon as City changes.
    input('#a').addEventListener('change', () => form.requestSubmit());
    const results = await fillFields(document, [
      instructionFor('id:a', 'Springfield'),
      instructionFor('id:b', 'Example Co'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['failed', 'filled']);
    expect(results[0]?.message).toMatch(/tried to submit the form or leave the page/);
    expect(submitted).toBe(0);
    // The guard is gone after filling: the user's own submit works.
    form.requestSubmit();
    expect(submitted).toBe(1);
  });

  it('a script click on a link that leaves the page is cancelled while filling; in-page links are not', async () => {
    document.body.innerHTML = `<form><label for="a">City</label><input id="a"></form><a id="away" href="https://elsewhere.example/next">x</a><a id="here" href="#top">y</a>`;
    const defaults: Record<string, boolean> = {};
    for (const id of ['away', 'here']) {
      element(`#${id}`).addEventListener('click', (event) => {
        defaults[id] = event.defaultPrevented;
        event.preventDefault(); // keep the test document in place
      });
    }
    input('#a').addEventListener('input', () => {
      (element('#here') as HTMLElement).click();
      (element('#away') as HTMLElement).click();
    });
    const [result] = await fillFields(document, [instructionFor('id:a', 'Springfield')]);
    expect(result?.status).toBe('failed');
    expect(defaults).toEqual({ here: false, away: true });
  });

  it('a page that can no longer be scanned: every field is unsupported, nothing filled', async () => {
    document.body.innerHTML = `<label for="a">City</label><input id="a">`;
    const instruction = instructionFor('id:a', 'Springfield');
    const results = await fillFields(document, [instruction, { ...instruction, fieldId: 'x' }], {
      scan: () => {
        throw new Error('several application containers');
      },
    });
    expect(results).toEqual([
      {
        fieldId: 'id:a',
        status: 'unsupported',
        message: 'ApplyOnce cannot read this page safely now. Analyze it again.',
      },
      {
        fieldId: 'x',
        status: 'unsupported',
        message: 'ApplyOnce cannot read this page safely now. Analyze it again.',
      },
    ]);
    expect(input('#a').value).toBe('');
  });

  it('custom hooks: run only after the generic checks, results normalized, failures isolated', async () => {
    document.body.innerHTML =
      listbox('a', 'Country', '<li role="option">Canada</li>') +
      listbox('b', 'State', '<li role="option">Quebec</li>') +
      listbox('c', 'Region', '<li role="option">North</li>') +
      listbox('d', 'Area', '<li role="option">East</li>');
    element('#d').setAttribute('aria-disabled', 'true');
    const seen: string[] = [];
    const results = await fillFields(
      document,
      [
        instructionFor('id:a', 'Canada'),
        instructionFor('id:b', 'Quebec'),
        instructionFor('id:c', 'North'),
        instructionFor('id:d', 'East'),
      ],
      {
        customControlTiming: { timeoutMs: 100, intervalMs: 5 },
        fillCustom: ({ field }, value) => {
          seen.push(field.id);
          if (field.id === 'id:a') return Promise.resolve({ status: 'bogus', message: 1 } as never);
          if (field.id === 'id:b')
            return Promise.resolve({
              status: 'failed',
              message: `Could not choose ${String(value)}`,
            });
          if (field.id === 'id:c') throw new Error('hook crashed');
          return undefined;
        },
      },
    );
    expect(results.map((r) => [r.status, r.message])).toEqual([
      ['failed', 'Something went wrong while filling this field.'],
      ['failed', 'Something went wrong while filling this field.'], // never repeats the value
      ['failed', 'Something went wrong while filling this field.'],
      ['skipped', 'The field is disabled now.'],
    ]);
    // The disabled field never reached the hook.
    expect(seen).toEqual(['id:a', 'id:b', 'id:c']);
  });

  it('a custom control that is itself a navigation button is refused before any hook', async () => {
    document.body.innerHTML = `<form><label id="l">Continue</label><button type="button" id="n" aria-haspopup="listbox" aria-labelledby="l" aria-controls="n-list">Continue</button><ul id="n-list" role="listbox" hidden><li role="option">Yes</li></ul></form>`;
    let hookCalls = 0;
    let clicks = 0;
    element('#n').addEventListener('click', () => (clicks += 1));
    const [result] = await fillFields(document, [instructionFor('id:n', 'Yes')], {
      fillCustom: () => {
        hookCalls += 1;
        return undefined;
      },
    });
    expect(result).toMatchObject({ status: 'failed' });
    expect(hookCalls + clicks).toBe(0);
  });

  it.each<[string, () => void, string]>([
    ['removed', () => element('#a').remove(), 'not-found'],
    ['replaced (other name)', () => element('#a').setAttribute('name', 'other'), 'not-found'],
    ['type changed', () => element('#a').setAttribute('type', 'email'), 'not-found'],
    [
      'label changed',
      () => {
        element('label').textContent = 'Company';
      },
      'skipped',
    ],
    ['disabled', () => element('#a').setAttribute('disabled', ''), 'skipped'],
    ['read-only', () => element('#a').setAttribute('readonly', ''), 'skipped'],
    [
      'now repeated',
      () =>
        document.body.insertAdjacentHTML('beforeend', '<label>City <input name="city"></label>'),
      'skipped',
    ],
  ])('Analyze → field %s → Fill: refused', async (_, mutate, status) => {
    document.body.innerHTML = `<label for="a">City</label><input id="a" name="city">`;
    const instruction = instructionFor('id:a', 'Springfield');
    mutate();
    const [result] = await fillFields(document, [instruction]);
    expect(result?.status).toBe(status);
    expect((document.querySelector('#a') as HTMLInputElement | null)?.value ?? '').toBe('');
  });
});

describe('Phase 16: phone fields reformatted by the page', () => {
  const formatter = (format: (digits: string) => string) => {
    input('#p').addEventListener('input', () => {
      const digits = input('#p').value.replace(/\D/g, '');
      input('#p').value = format(digits);
    });
  };

  it('counts a reformatted number with exactly the same digits as filled', async () => {
    document.body.innerHTML = '<label for="p">Phone</label><input id="p" type="tel">';
    formatter((d) => `+${d.slice(0, 1)} ${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`);
    expect(await fillOne('id:p', '+1 555 010 0199')).toMatchObject({ status: 'filled' });
    expect(input('#p').value).toBe('+1 555-010-0199');
  });

  it('still fails when the page changed the digits', async () => {
    document.body.innerHTML = '<label for="p">Phone</label><input id="p" type="tel">';
    formatter((d) => d.slice(0, 6));
    expect(await fillOne('id:p', '+1 555 010 0199')).toMatchObject({ status: 'failed' });
  });

  it('only for phone fields: other text must be kept exactly', async () => {
    document.body.innerHTML = '<label for="p">Postal code</label><input id="p" type="text">';
    formatter((d) => `${d.slice(0, 3)}-${d.slice(3)}`);
    expect(await fillOne('id:p', '123456')).toMatchObject({ status: 'failed' });
  });
});
