// @vitest-environment happy-dom
/**
 * Phase 17 security: hostile pages. Misleading options and widgets, pages that try to turn a
 * fill into a submission or navigation, changes made while a fill runs, and where approved
 * values end up. The fill engines must interact only with the exact intended control or
 * option, and fail safely otherwise.
 */
import type { FillInstruction, FillValue } from '@applyonce/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { fillFields, findMatchingOption } from './fill-fields';
import { scanFields } from './scan-fields';

const TIMING = { customControlTiming: { timeoutMs: 150, intervalMs: 5 } };

function instructionFor(fieldId: string, value: FillValue): FillInstruction {
  const field = scanFields(document).find((f) => f.id === fieldId);
  if (!field) throw new Error(`No field ${fieldId}`);
  const { name, htmlId, label } = field.signals;
  return { fieldId, value, expected: { type: field.type, name, htmlId, label } };
}

/** Records every event ApplyOnce causes: keys, clicks (by target), and submissions. */
function recordInteractions() {
  const log = { keys: [] as string[], clicks: [] as string[], submits: 0 };
  document.addEventListener('keydown', (e) => log.keys.push((e as KeyboardEvent).key), true);
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as HTMLElement;
      log.clicks.push(t.id || t.getAttribute('role') || t.tagName.toLowerCase());
    },
    true,
  );
  document.addEventListener('submit', () => (log.submits += 1), true);
  return log;
}

/** A plain-DOM dropdown: opens on click, selects the clicked option and shows its text. */
function dropdown(id: string, label: string, options: string, trigger = 'div') {
  const open =
    trigger === 'div'
      ? `<div id="${id}" role="combobox" tabindex="0"`
      : `<button id="${id}" aria-haspopup="listbox"`;
  const close = trigger === 'div' ? '</div>' : '</button>';
  document.body.insertAdjacentHTML(
    'beforeend',
    `<form><label id="${id}-l">${label}</label>${open} aria-labelledby="${id}-l" aria-controls="${id}-list" aria-expanded="false">${close}<ul id="${id}-list" role="listbox" hidden>${options}</ul></form>`,
  );
  const control = document.getElementById(id) as HTMLElement;
  const list = document.getElementById(`${id}-list`) as HTMLElement;
  control.addEventListener('click', () => {
    list.hidden = false;
    control.setAttribute('aria-expanded', 'true');
  });
  control.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      list.hidden = true;
      control.setAttribute('aria-expanded', 'false');
    }
  });
  for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
    option.addEventListener('click', () => {
      option.setAttribute('aria-selected', 'true');
      control.textContent = option.textContent;
      list.hidden = true;
      control.setAttribute('aria-expanded', 'false');
    });
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('option spoofing: deterministic, and ambiguity fails safely', () => {
  const describe_ = (o: { value: string; label: string }) => o;
  it.each([
    [
      'same visible text, different values',
      [
        { value: 'CA', label: 'Canada' },
        { value: 'CA-evil', label: 'Canada' },
      ],
    ],
    [
      'a value that says one thing next to a label that says it',
      [
        { value: 'Canada', label: 'India' },
        { value: 'CA', label: 'Canada' },
      ],
    ],
    [
      'duplicate accessible names in different spellings',
      [
        { value: '1', label: 'Canada' },
        { value: '2', label: 'CANADA ' },
      ],
    ],
    [
      'compacted spellings colliding',
      [
        { value: '1', label: 'Can-ada' },
        { value: '2', label: 'Can ada' },
      ],
    ],
  ])('%s → ambiguous', (_, options) => {
    expect(findMatchingOption(options, describe_, 'Canada')).toBe('ambiguous');
  });

  it('same value, different visible text: the value decides only when nothing contradicts it', () => {
    const options = [
      { value: 'Canada', label: 'Canada (English)' },
      { value: 'Canada-fr', label: 'Canada (French)' },
    ];
    expect(findMatchingOption(options, describe_, 'Canada')).toBe(options[0]);
  });

  it('a native select with spoofed options is left alone', async () => {
    document.body.innerHTML = `<label for="c">Country</label><select id="c"><option value=""></option><option value="Canada">India</option><option value="CA">Canada</option></select>`;
    const [result] = await fillFields(document, [instructionFor('id:c', 'Canada')]);
    expect(result).toMatchObject({ status: 'failed' });
    expect((document.getElementById('c') as HTMLSelectElement).value).toBe('');
  });

  it('a custom dropdown with duplicate option names is left alone', async () => {
    dropdown('c', 'Country', '<li role="option">Canada</li><li role="option">Canada</li>');
    const log = recordInteractions();
    const [result] = await fillFields(document, [instructionFor('id:c', 'Canada')], TIMING);
    expect(result).toMatchObject({ status: 'failed' });
    expect(log.clicks.filter((c) => c === 'option')).toEqual([]);
    expect(document.getElementById('c')?.textContent).toBe('');
  });
});

describe('custom controls: only the exact intended control and option', () => {
  it.each([
    [
      'an option that is a submit button',
      '<li role="option"><button type="submit">Canada</button></li>',
      'failed',
    ],
    [
      'an option named "Submit"',
      '<li role="option">Submit</li><li role="option">Canada</li>',
      'filled',
    ],
    [
      'an option element that is itself a submit button',
      '<button type="submit" role="option">Canada</button>',
      'failed',
    ],
    [
      'an option element that is a navigation link',
      '<a role="option" href="https://elsewhere.example/next">Canada</a>',
      'failed',
    ],
  ])('%s', async (_, options, status) => {
    dropdown('c', 'Country', options);
    const log = recordInteractions();
    let navigated = 0;
    for (const link of document.querySelectorAll('a'))
      link.addEventListener('click', (e) => {
        if (!e.defaultPrevented) navigated += 1;
        e.preventDefault();
      });
    const [result] = await fillFields(document, [instructionFor('id:c', 'Canada')], TIMING);
    expect(result?.status).toBe(status);
    expect(log.submits + navigated).toBe(0);
    // Never clicked: the "Submit" option, or any submit button.
    expect(log.clicks).not.toContain('button');
  });

  it('a trigger that is a submit button is opened without a click, so it cannot submit', async () => {
    dropdown('c', 'Country', '<li role="option">Canada</li>', 'button'); // <button> in a form: type=submit
    const trigger = document.getElementById('c') as HTMLElement;
    trigger.addEventListener('mousedown', () => trigger.click.call(document.createElement('div')));
    trigger.addEventListener('pointerdown', () => {
      (document.getElementById('c-list') as HTMLElement).hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    });
    const log = recordInteractions();
    await fillFields(document, [instructionFor('id:c', 'Canada')], TIMING);
    expect(log.submits).toBe(0);
    expect(log.clicks).not.toContain('c');
  });

  it.each(['Next', 'Continue', 'Save', 'Save and Continue', 'Submit', 'Apply', 'Finish', 'Back'])(
    'a dropdown trigger named "%s" is never operated',
    async (name) => {
      document.body.innerHTML = `<form><button type="button" id="n" aria-haspopup="listbox" aria-controls="n-list" aria-label="${name}">${name}</button><ul id="n-list" role="listbox" hidden><li role="option">Yes</li></ul></form>`;
      const log = recordInteractions();
      const [result] = await fillFields(document, [instructionFor('id:n', 'Yes')]);
      expect(result?.message).toMatch(/navigation or submit button/);
      expect(result?.status).toBe('failed');
      expect(log.clicks.length + log.keys.length + log.submits).toBe(0);
    },
  );
});

describe('submission: what ApplyOnce itself does', () => {
  it('a full fill of every control type sends no Enter and clicks no button', async () => {
    document.body.innerHTML = `<form id="f"><label for="t">City</label><input id="t"><label for="s">Country</label><select id="s"><option value=""></option><option>Canada</option></select><label><input type="checkbox" id="x"> Willing to relocate</label><fieldset><legend>Sponsorship</legend><label><input type="radio" name="r" value="yes"> Yes</label><label><input type="radio" name="r" value="no"> No</label></fieldset><button>Next</button><button type="submit">Submit</button></form>`;
    dropdown('m', 'Work mode', '<li role="option">Remote</li><li role="option">Hybrid</li>');
    const log = recordInteractions();
    const fields = scanFields(document);
    const results = await fillFields(
      document,
      [
        instructionFor('id:t', 'Springfield'),
        instructionFor('id:s', 'Canada'),
        instructionFor('id:x', true),
        instructionFor(fields.find((f) => f.type === 'radio')?.id ?? '', 'No'),
        instructionFor('id:m', 'Hybrid'),
      ],
      TIMING,
    );
    expect(results.map((r) => r.status)).toEqual([
      'filled',
      'filled',
      'filled',
      'filled',
      'filled',
    ]);
    expect(log.keys.every((k) => k === 'ArrowDown' || k === 'Escape')).toBe(true);
    expect(log.keys).not.toContain('Enter');
    expect(log.clicks.every((c) => ['x', 'input', 'm', 'option'].includes(c))).toBe(true);
    expect(log.submits).toBe(0);
  });

  it.each([
    ['input change submits (requestSubmit)', (form: HTMLFormElement) => form.requestSubmit()],
    ['keydown handler submits on any key', (form: HTMLFormElement) => form.requestSubmit()],
    [
      'a click on a submit button',
      (form: HTMLFormElement) => form.querySelector<HTMLButtonElement>('button')?.click(),
    ],
  ])('the page guard stops "%s" while filling', async (_, submit) => {
    document.body.innerHTML = `<form id="f"><label for="t">City</label><input id="t"><button type="submit">Submit</button></form>`;
    const form = document.getElementById('f') as HTMLFormElement;
    let submitted = 0;
    form.addEventListener('submit', (e) => {
      submitted += 1;
      e.preventDefault();
    });
    const input = document.getElementById('t') as HTMLInputElement;
    input.addEventListener('change', () => submit(form));
    input.addEventListener('keydown', () => submit(form));
    const [result] = await fillFields(document, [instructionFor('id:t', 'Springfield')]);
    expect(result?.status).toBe('failed');
    expect(submitted).toBe(0);
  });
});

describe('fields changed while a fill runs (race window)', () => {
  it('each field is checked against the page right before it is filled', async () => {
    document.body.innerHTML = `<label for="a">City</label><input id="a"><label for="b">Email</label><input id="b" type="email">`;
    const approved = [
      instructionFor('id:a', 'Springfield'),
      instructionFor('id:b', 'jane.doe@example.com'),
    ];
    // While the first field is filled, the page relabels the second one.
    document.getElementById('a')?.addEventListener('change', () => {
      const label = document.querySelector('label[for="b"]');
      if (label) label.textContent = 'Recovery email for another account';
    });
    const results = await fillFields(document, approved);
    expect(results.map((r) => r.status)).toEqual(['filled', 'skipped']);
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('');
  });

  it('a field swapped for another element while filling is not filled through a stale reference', async () => {
    document.body.innerHTML = `<label for="a">City</label><input id="a"><div id="slot"><label for="b">Email</label><input id="b" type="email"></div>`;
    const approved = [
      instructionFor('id:a', 'Springfield'),
      instructionFor('id:b', 'jane.doe@example.com'),
    ];
    const original = document.getElementById('b') as HTMLInputElement;
    document.getElementById('a')?.addEventListener('change', () => {
      (document.getElementById('slot') as HTMLElement).innerHTML =
        '<label for="b">Email</label><input id="b" type="email" disabled>';
    });
    const results = await fillFields(document, approved);
    expect(results[1]?.status).toBe('skipped'); // the new element is disabled: nothing filled
    expect(original.value).toBe('');
  });
});

describe('where approved values go', () => {
  it('only into the approved control’s value: never into attributes, text, or other fields', async () => {
    const hostile = '<img src=x onerror="window.__xss=1">';
    document.body.innerHTML = `<label for="a">First name</label><input id="a"><label for="b">Last name</label><input id="b">`;
    await fillFields(document, [instructionFor('id:a', hostile)]);
    expect((document.getElementById('a') as HTMLInputElement).value).toBe(hostile);
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain('onerror');
    expect(document.querySelector('img')).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
    const attributes = [...document.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].map((a) => a.value),
    );
    expect(attributes.some((v) => v.includes('img'))).toBe(false);
  });

  it.each(['javascript:alert(1)', '<script>alert(1)</script>', '"><svg onload=alert(1)>'])(
    '%j is written as plain text to the control, nothing else',
    async (value) => {
      document.body.innerHTML = `<label for="a">Website</label><input id="a" type="url">`;
      await fillFields(document, [instructionFor('id:a', value)]);
      expect((document.getElementById('a') as HTMLInputElement).value).toBe(value);
      expect(document.querySelectorAll('script, svg, img').length).toBe(0);
    },
  );
});

describe('generated ids changing while a fill runs', () => {
  const page = () => {
    document.body.innerHTML = `<form><fieldset><legend>Undergraduate</legend><label for="v-1">Degree</label><input id="v-1" name="ug"></fieldset><fieldset><legend>Postgraduate</legend><label for="v-2">Degree</label><input id="v-2" name="pg"></fieldset></form>`;
  };
  /** A framework render that replaces the second field with a new element and a new generated id. */
  const rerenderSecond = (change: (html: string) => string = (h) => h) =>
    document.getElementById('v-1')?.addEventListener('input', () => {
      const fieldset = document.querySelectorAll('fieldset')[1] as HTMLElement;
      fieldset.innerHTML = change(
        '<legend>Postgraduate</legend><label for="v-9">Degree</label><input id="v-9" name="pg">',
      );
    });

  it('a field whose generated id and element change after an earlier fill is found again by its identity', async () => {
    page();
    const approved = [instructionFor('id:v-1', 'BSc'), instructionFor('id:v-2', 'MSc')];
    rerenderSecond();
    const results = await fillFields(document, approved);
    expect(results.map((r) => r.status)).toEqual(['filled', 'filled']);
    expect((document.getElementById('v-9') as HTMLInputElement).value).toBe('MSc');
  });

  it.each([
    ['renamed', (h: string) => h.replace('name="pg"', 'name="other"')],
    ['relabeled', (h: string) => h.replace('>Degree<', '>Password hint<')],
    ['moved to another section', (h: string) => h.replace('Postgraduate', 'Emergency contact')],
  ])('but a %s field is refused', async (_, change) => {
    page();
    const approved = [instructionFor('id:v-1', 'BSc'), instructionFor('id:v-2', 'MSc')];
    rerenderSecond(change);
    const results = await fillFields(document, approved);
    expect(results[1]?.status).not.toBe('filled');
    expect((document.getElementById('v-9') as HTMLInputElement).value).toBe('');
  });

  it('an authored id that disappears is never matched to another element', async () => {
    document.body.innerHTML = `<label for="a">City</label><input id="a"><label for="b">Degree</label><input id="b" name="deg">`;
    const approved = [instructionFor('id:a', 'Springfield'), instructionFor('id:b', 'MSc')];
    document.getElementById('a')?.addEventListener('input', () => {
      document.getElementById('b')?.setAttribute('id', 'c');
      document.querySelector('label[for="b"]')?.setAttribute('for', 'c');
    });
    const results = await fillFields(document, approved);
    expect(results[1]?.status).toBe('not-found');
  });
});
