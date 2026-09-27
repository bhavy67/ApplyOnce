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

function fillOne(fieldId: string, value: FillValue) {
  const [result] = fillFields(document, [instructionFor(fieldId, value)]);
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
  ] as const)('%s is filled and notified with input + change', (html, value) => {
    document.body.innerHTML = html;
    const events = recordEvents('#f');

    expect(fillOne('id:f', value)).toEqual({
      fieldId: 'id:f',
      status: 'filled',
      message: 'Filled.',
    });
    expect(input('#f').value).toBe(String(value));
    expect(events).toEqual(['input', 'change']);
  });

  it('writes through the native setter so framework value trackers see the change', () => {
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

    fillOne('id:f', 'Jane');
    expect(frameworkSawChange).toBe(true);
  });

  it('does not overwrite an existing value', () => {
    document.body.innerHTML = '<input id="f" value="Already typed">';
    expect(fillOne('id:f', 'Jane')).toMatchObject({ status: 'skipped' });
    expect(input('#f').value).toBe('Already typed');
  });

  it('refuses non-numeric values for number fields and yes/no values for text', () => {
    document.body.innerHTML = '<input id="n" type="number"><input id="t">';
    expect(fillOne('id:n', 'four')).toMatchObject({ status: 'failed' });
    expect(fillOne('id:t', true)).toMatchObject({ status: 'unsupported' });
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
  ])('%j selects %s', (value, expected) => {
    const events = recordEvents('#country');
    expect(fillOne('id:country', value)).toMatchObject({ status: 'filled' });
    expect(select().value).toBe(expected);
    expect(events).toEqual(['input', 'change']);
  });

  it('fails without changing the selection when no option matches', () => {
    expect(fillOne('id:country', 'Atlantis')).toMatchObject({ status: 'failed' });
    expect(select().value).toBe('');
  });
});

describe('checkbox', () => {
  beforeEach(() => {
    document.body.innerHTML = '<label><input id="c" type="checkbox"> Willing to relocate</label>';
  });

  it.each([
    [true, true],
    ['yes', true],
    [false, false],
  ] as const)('%j → checked=%s', (value, checked) => {
    expect(fillOne('id:c', value)).toMatchObject({ status: 'filled' });
    expect(input('#c').checked).toBe(checked);
  });

  it('unchecks a checked box for false and fires change', () => {
    input('#c').checked = true;
    const events = recordEvents('#c');
    fillOne('id:c', false);
    expect(input('#c').checked).toBe(false);
    expect(events).toContain('change');
  });

  it.each(['maybe', 3])('rejects non yes/no value %j', (value) => {
    expect(fillOne('id:c', value)).toMatchObject({ status: 'failed' });
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

  it('selects only the option matching the profile value', () => {
    expect(fillOne('radio:sponsorship', false)).toMatchObject({ status: 'filled' });
    expect(checkedValues()).toEqual(['0']);
    fillOne('radio:sponsorship', true);
    expect(checkedValues()).toEqual(['1']);
  });

  it('fails and selects nothing when no option matches', () => {
    expect(fillOne('radio:sponsorship', 'Sometimes')).toMatchObject({ status: 'failed' });
    expect(checkedValues()).toEqual([]);
  });
});

describe('page changes and failures', () => {
  it('reports a removed field as not found and still fills the others', () => {
    document.body.innerHTML = '<input id="a"><input id="b">';
    const instructions = [instructionFor('id:a', 'A'), instructionFor('id:b', 'B')];
    input('#a').remove();

    expect(fillFields(document, instructions).map((r) => r.status)).toEqual([
      'not-found',
      'filled',
    ]);
    expect(input('#b').value).toBe('B');
  });

  it('fills a field that was re-rendered as an equivalent element', () => {
    document.body.innerHTML = '<div id="root"><input id="email" name="email" type="email"></div>';
    const instruction = instructionFor('id:email', 'jane.doe@example.com');
    element('#root').innerHTML = '<input id="email" name="email" type="email">';

    expect(fillFields(document, [instruction])[0]).toMatchObject({ status: 'filled' });
  });

  it('does not fill a field replaced by a different one under the same id', () => {
    document.body.innerHTML = '<input><input>';
    const instruction = instructionFor('index:1', 'value');
    document.body.innerHTML = '<input><input type="email" name="other">';

    expect(fillFields(document, [instruction])[0]).toMatchObject({ status: 'not-found' });
  });

  it.each([
    ['hidden', 'style="display:none"'],
    ['disabled', 'disabled'],
  ])('skips a field that became %s', (_, attribute) => {
    document.body.innerHTML = '<input id="f">';
    const instruction = instructionFor('id:f', 'x');
    document.body.innerHTML = `<input id="f" ${attribute}>`;
    expect(fillFields(document, [instruction])[0]).toMatchObject({ status: 'skipped' });
  });

  it('reports an unknown field id as not found', () => {
    document.body.innerHTML = '<input id="f">';
    const instruction: FillInstruction = {
      fieldId: 'id:ghost',
      value: 'x',
      expected: { type: 'text' },
    };
    expect(fillFields(document, [instruction])[0]).toMatchObject({ status: 'not-found' });
  });

  it('contains an error in one field without breaking the rest', () => {
    document.body.innerHTML = '<input id="c" type="checkbox"><input id="t">';
    const instructions = [instructionFor('id:c', true), instructionFor('id:t', 'T')];
    input('#c').click = () => {
      throw new Error('page script error');
    };

    expect(fillFields(document, instructions).map((r) => r.status)).toEqual(['failed', 'filled']);
  });

  it('never submits the form', () => {
    document.body.innerHTML = '<form><input id="f"><button type="submit">Send</button></form>';
    let submitted = false;
    element('form').addEventListener('submit', (event) => {
      submitted = true;
      event.preventDefault();
    });
    fillOne('id:f', 'Jane');
    expect(submitted).toBe(false);
  });
});

describe('option matching helpers', () => {
  const options = [
    { value: 'y', label: 'Yes' },
    { value: 'n', label: 'No' },
  ];
  const describeOption = (o: (typeof options)[number]) => o;

  it('maps booleans to yes/no options', () => {
    expect(findMatchingOption(options, describeOption, true)).toBe(options[0]);
    expect(findMatchingOption(options, describeOption, false)).toBe(options[1]);
  });

  it('reports ambiguity instead of guessing', () => {
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
  ] as const)('toBoolean(%j) → %j', (value, expected) => {
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
  ])('work mode / employment type select %s with %j → %s', (options, value, expected) => {
    document.body.innerHTML = `<select id="s"><option value="">Select…</option>${options}</select>`;
    expect(fillOne('id:s', value)).toMatchObject({ status: 'filled' });
    expect((document.querySelector('#s') as HTMLSelectElement).value).toBe(expected);
  });

  it('does not treat a combined option such as "Remote / Hybrid" as Remote', () => {
    document.body.innerHTML =
      '<select id="s"><option value="">Select…</option><option value="rh">Remote / Hybrid</option><option value="o">On-site</option></select>';
    expect(fillOne('id:s', 'remote')).toMatchObject({ status: 'failed' });
    expect((document.querySelector('#s') as HTMLSelectElement).value).toBe('');
  });

  it('refuses to guess between options that only differ in punctuation', () => {
    document.body.innerHTML =
      '<select id="s"><option value="a">Full-time</option><option value="b">Full time</option></select>';
    expect(fillOne('id:s', 'fulltime')).toMatchObject({ status: 'failed' });
  });

  it('fills a work mode radio group', () => {
    document.body.innerHTML = `
      <fieldset><legend>Work mode</legend>
        <label><input type="radio" name="mode" value="r"> Remote</label>
        <label><input type="radio" name="mode" value="h"> Hybrid</label>
        <label><input type="radio" name="mode" value="o"> On-site</label>
      </fieldset>`;
    expect(fillOne('radio:mode', 'onsite')).toMatchObject({ status: 'filled' });
    expect((document.querySelector('input:checked') as HTMLInputElement).value).toBe('o');
  });

  it.each([
    [4.5, '4.5'],
    [2019, '2019'],
    [0, '0'],
  ])('fills number %j', (value, expected) => {
    document.body.innerHTML = '<input id="n" type="number">';
    expect(fillOne('id:n', value)).toMatchObject({ status: 'filled' });
    expect(input('#n').value).toBe(expected);
  });

  it('selects a year from a graduation year dropdown', () => {
    document.body.innerHTML =
      '<select id="y"><option value="">Year</option><option>2018</option><option>2019</option></select>';
    expect(fillOne('id:y', 2019)).toMatchObject({ status: 'filled' });
    expect((document.querySelector('#y') as HTMLSelectElement).value).toBe('2019');
  });

  it('preserves URLs exactly', () => {
    document.body.innerHTML = '<input id="u" type="url">';
    const url = 'https://www.linkedin.com/in/jane-doe-example?trk=Profile_Link';
    expect(fillOne('id:u', url)).toMatchObject({ status: 'filled' });
    expect(input('#u').value).toBe(url);
  });
});
