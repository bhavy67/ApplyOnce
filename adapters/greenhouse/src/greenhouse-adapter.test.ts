// @vitest-environment happy-dom
import {
  selectAdapter,
  type FillInstruction,
  type FillValue,
  type FormField,
} from '@applyonce/core';
import { fillFields, genericAdapter } from '@applyonce/adapter-generic';
import { createAliasMatcher, mapFields } from '@applyonce/field-mapper';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectGreenhouse,
  fillGreenhouse,
  greenhouseAdapter,
  reactSelectSelection,
  scanGreenhouseFields,
} from './index';

const TIMING = { customControlTiming: { timeoutMs: 300, intervalMs: 10 } };
const JOB_URL = 'https://job-boards.greenhouse.io/example/jobs/1234567';
const matcher = createAliasMatcher();

/** A text question as Greenhouse renders it (label[for] + input[aria-label]). */
const text = (id: string, label: string, extra = '') => `
  <div class="field-wrapper"><div class="text-input-wrapper"><div class="input-wrapper">
    <label id="${id}-label" for="${id}" class="label">${label}<span aria-hidden="true">*</span></label>
    <input id="${id}" class="input input__single-line" aria-label="${label.replace(/<[^>]+>/g, '')}" type="text" ${extra}>
  </div></div></div>`;

/** A react-select question as Greenhouse renders it (input.select__input + hidden helper). */
const select = (id: string, label: string, selected = '') => `
  <div class="field-wrapper"><div class="select"><div class="select__container">
    <label id="${id}-label" for="${id}" class="label select__label">${label}</label>
    <div class="select-shell"><div class="select__control">
      <div class="select__value-container">
        ${selected ? `<div class="select__single-value">${selected}</div>` : '<div class="select__placeholder">Select...</div>'}
        <div class="select__input-container"><input class="select__input" id="${id}" type="text" role="combobox"
          aria-autocomplete="list" aria-expanded="false" aria-haspopup="true" aria-labelledby="${id}-label" value=""></div>
      </div>
      <div class="select__indicators"><button type="button" aria-label="Toggle flyout" tabindex="-1"></button></div>
    </div></div>
    <input required tabindex="-1" aria-hidden="true" value="">
  </div></div></div>`;

const page = (body: string) => {
  document.body.innerHTML = `
    <div class="job__description"><h1>Engineer</h1><p>Posted on Greenhouse.</p></div>
    <form id="application-form" class="application--form">
      <div class="application--questions">${body}</div>
      <button type="submit" class="btn">Submit application</button>
    </form>`;
};

/**
 * Behaves like react-select on Apple devices: opens on mousedown or ArrowDown, sets
 * aria-controls while open, never marks options aria-selected, and shows the chosen label in
 * .select__single-value (the input stays empty).
 */
function operate(id: string, labels: readonly string[]) {
  const input = document.getElementById(id) as HTMLInputElement;
  const control = input.closest('.select__control') as HTMLElement;
  const state = { opened: 0, chosen: [] as string[] };
  const close = () => {
    document.getElementById(`react-select-${id}-listbox`)?.remove();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-controls');
  };
  const open = () => {
    if (input.getAttribute('aria-expanded') === 'true') return;
    state.opened += 1;
    const menu = document.createElement('div');
    menu.id = `react-select-${id}-listbox`;
    menu.setAttribute('role', 'listbox');
    for (const label of labels) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = label;
      option.addEventListener('click', () => {
        state.chosen.push(label);
        const valueContainer = control.querySelector('.select__value-container') as HTMLElement;
        valueContainer.querySelector('.select__placeholder, .select__single-value')?.remove();
        valueContainer.insertAdjacentHTML(
          'afterbegin',
          `<div class="select__single-value">${label}</div>`,
        );
        close();
      });
      menu.append(option);
    }
    control.after(menu);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', menu.id);
  };
  control.addEventListener('mousedown', open);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') open();
    if (e.key === 'Escape') close();
  });
  return state;
}

function instructionFor(fieldId: string, value: FillValue): FillInstruction {
  const field = scanGreenhouseFields(document).find((f) => f.id === fieldId);
  if (!field) throw new Error(`No field ${fieldId}`);
  const { name, htmlId, label } = field.signals;
  return { fieldId, value, expected: { type: field.type, name, htmlId, label } };
}
const fillOne = async (fieldId: string, value: FillValue) =>
  (await fillGreenhouse(document, [instructionFor(fieldId, value)], TIMING))[0];
const mapped = (fields: FormField[]) =>
  Object.fromEntries(
    mapFields(fields, matcher).mappings.map((m, i) => [
      fields[i]?.signals.label,
      `${m.status}:${m.profileField ?? ''}`,
    ]),
  );

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('detection', () => {
  it('A. a Greenhouse job-board host is enough on its own', () => {
    for (const url of [
      JOB_URL,
      'https://job-boards.eu.greenhouse.io/x/jobs/1',
      'https://boards.greenhouse.io/x/jobs/1',
    ]) {
      expect(detectGreenhouse({ url, root: document })).toMatchObject({ platform: 'greenhouse' });
    }
  });

  it('B. Greenhouse’s application form is enough on its own (company-hosted page)', () => {
    page(text('question_123456', 'LinkedIn Profile'));
    expect(detectGreenhouse({ url: 'https://careers.example.com/apply', root: document })).toEqual({
      platform: 'greenhouse',
      evidence: ['Greenhouse application form'],
    });
  });

  it.each([
    [
      'C. the word "Greenhouse" in page text',
      '<p>We use Greenhouse. greenhouse GREENHOUSE</p><form><label for="n">Name</label><input id="n"></form>',
    ],
    ['D. a generic form', '<form><label for="f">First Name</label><input id="f"></form>'],
    [
      'E. an "application-form" id without Greenhouse questions',
      '<form id="application-form"><label for="f">First Name</label><input id="f"></form>',
    ],
    [
      'E. question sections without the form',
      '<div class="application--questions"><input id="question_1"></div>',
    ],
  ])('%s stays generic', (_, html) => {
    document.body.innerHTML = html;
    expect(detectGreenhouse({ url: 'https://example.com/jobs', root: document }).platform).toBe(
      'generic',
    );
  });

  it('never claims Greenhouse for greenhouse.io pages that are not job boards', () => {
    expect(
      detectGreenhouse({ url: 'https://www.greenhouse.io/blog', root: document }).platform,
    ).toBe('generic');
  });

  it('resolves Workday, Greenhouse, and generic without interfering', () => {
    page(text('question_1', 'LinkedIn Profile'));
    expect(
      selectAdapter([greenhouseAdapter], genericAdapter, { url: JOB_URL, root: document }).id,
    ).toBe('greenhouse');
    expect(
      selectAdapter([greenhouseAdapter], genericAdapter, {
        url: 'https://example.com',
        root: document,
      }).id,
    ).toBe('greenhouse');
    document.body.innerHTML = '<form><input id="x"></form>';
    expect(
      selectAdapter([greenhouseAdapter], genericAdapter, {
        url: 'https://example.com',
        root: document,
      }).id,
    ).toBe('generic');
  });
});

describe('scanning', () => {
  it('finds one field per question, with labels (aria-hidden required markers excluded) and stable ids', () => {
    page(`${text('first_name', 'First Name')}${text('email', 'Email')}${select('country', 'Country')}
      <div class="field-wrapper"><div role="group" aria-labelledby="upload-label-resume"><div id="upload-label-resume">Resume/CV</div>
        <button type="button">Attach</button><label class="visually-hidden" for="resume">Attach</label>
        <input id="resume" class="visually-hidden" type="file"></div></div>
      <input type="password" id="pw">${text('question_8581812008', 'LinkedIn Profile')}`);
    const fields = scanGreenhouseFields(document);
    expect(fields.map((f) => [f.id, f.type, f.signals.label, f.custom?.pattern ?? '-'])).toEqual([
      ['id:first_name', 'text', 'First Name', '-'],
      ['id:email', 'text', 'Email', '-'],
      ['id:country', 'select', 'Country', 'input-combobox'],
      ['id:question_8581812008', 'text', 'LinkedIn Profile', '-'],
    ]);
    expect(fields.every((f) => f.identity?.unique === true)).toBe(true);
  });

  it('never scans the voluntary self-identification (EEO / demographic) sections', () => {
    page(`${text('first_name', 'First Name')}
      <div class="eeoc__container"><h2>Voluntary Self-Identification</h2>${select('gender', 'Gender')}${select('veteran_status', 'Veteran Status')}</div>
      <div id="demographic-section" class="demographic--container">${select('4033064002', 'Gender')}</div>`);
    expect(scanGreenhouseFields(document).map((f) => f.id)).toEqual(['id:first_name']);
  });

  it('reports the location lookup as unsupported (it only suggests after typing)', () => {
    page(select('candidate-location', 'Location (City)'));
    const [field] = scanGreenhouseFields(document);
    expect(field?.custom).toEqual({ pattern: 'search-input', supported: false });
    // "Location (City)" matches no profile field; and even if taught, the control is unsupported.
    expect(mapFields(scanGreenhouseFields(document), matcher).mappings[0]?.status).toBe('unknown');
  });

  it('marks a question repeated without record context, and keeps record sections positional', () => {
    page(`${text('question_1', 'Degree')}${text('question_2', 'Degree')}
      <div><h3>Education 1</h3>${text('question_3', 'Institution')}</div><div><h3>Education 2</h3>${text('question_4', 'Institution')}</div>`);
    const fields = scanGreenhouseFields(document);
    expect(
      fields.map((f) => [
        f.id,
        f.repeatedCount ?? '-',
        f.record ? `${f.record.collection}[${f.record.index}]` : '-',
      ]),
    ).toEqual([
      ['id:question_1', 2, '-'],
      ['id:question_2', 2, '-'],
      ['id:question_3', '-', 'education[0]'],
      ['id:question_4', '-', 'education[1]'],
    ]);
  });

  it('gives each question its own identity; identity survives a re-render and changes with the question id', () => {
    const render = () => page(`${text('question_1', 'Degree')}${text('question_2', 'Degree')}`);
    render();
    const before = scanGreenhouseFields(document).map((f) => f.identity);
    expect(before.every((i) => i?.unique)).toBe(true);
    render();
    expect(scanGreenhouseFields(document).map((f) => f.identity)).toEqual(before);
    page(`${text('question_9', 'Degree')}${text('question_2', 'Degree')}`);
    expect(scanGreenhouseFields(document)[0]?.identity?.key).not.toBe(before[0]?.key);
  });
});

describe('mapping (existing deterministic mapper)', () => {
  it('maps Greenhouse questions to the canonical profile fields', () => {
    page(
      [
        text('first_name', 'First Name'),
        text('last_name', 'Last Name'),
        text('email', 'Email'),
        text('phone', 'Phone'),
        text('question_1', 'City'),
        text('question_2', 'State'),
        select('country', 'Country'),
        text('question_3', 'LinkedIn Profile'),
        text('question_4', 'GitHub'),
        text('question_5', 'Portfolio'),
        text('question_6', 'Website'),
        text('question_7', 'Current Job Title'),
        text('question_8', 'Current Company'),
        text('question_9', 'Years of Experience'),
        text('question_10', 'Degree'),
        text('question_11', 'Field of Study'),
        text('question_12', 'University'),
        text('question_13', 'Graduation Year'),
        select('question_14', 'Employment Type'),
        select('question_15', 'Work Mode'),
        select('question_16', 'Work Authorization'),
      ].join(''),
    );
    expect(mapped(scanGreenhouseFields(document))).toEqual({
      'First Name': 'mapped:first_name',
      'Last Name': 'mapped:last_name',
      Email: 'mapped:email',
      Phone: 'mapped:phone',
      City: 'mapped:city',
      State: 'mapped:state',
      Country: 'mapped:country',
      'LinkedIn Profile': 'mapped:linkedin_url',
      GitHub: 'mapped:github_url',
      Portfolio: 'mapped:portfolio_url',
      Website: 'mapped:website_url',
      'Current Job Title': 'mapped:current_title',
      'Current Company': 'mapped:current_company',
      'Years of Experience': 'mapped:experience_years',
      Degree: 'mapped:highest_degree',
      'Field of Study': 'mapped:field_of_study',
      University: 'mapped:institution',
      'Graduation Year': 'mapped:graduation_year',
      'Employment Type': 'mapped:employment_type',
      'Work Mode': 'mapped:work_mode',
      'Work Authorization': 'mapped:work_authorization',
    });
  });

  it('leaves Greenhouse custom and legal questions unknown or for review, never guessed', () => {
    page(
      [
        text('question_1', 'Why do you want to work at Example?'),
        select(
          'question_2',
          'Are you legally authorized to work in the United States for any employer?',
        ),
        select('question_3', 'Have you previously worked at or consulted for Example?'),
        text('question_4', 'Company'),
      ].join(''),
    );
    const result = mapFields(scanGreenhouseFields(document), matcher).mappings;
    expect(result.map((m) => m.status)).toEqual(['unknown', 'unknown', 'unknown', 'review']);
  });
});

describe('filling', () => {
  it('fills text questions with the generic engine', async () => {
    page(`${text('first_name', 'First Name')}${text('question_1', 'LinkedIn Profile')}`);
    const results = await fillGreenhouse(
      document,
      [
        instructionFor('id:first_name', 'Jane'),
        instructionFor('id:question_1', 'https://www.linkedin.com/in/jane'),
      ],
      TIMING,
    );
    expect(results.map((r) => r.status)).toEqual(['filled', 'filled']);
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Jane');
  });

  it('selects a react-select option and confirms it from the displayed value (no aria-selected)', async () => {
    page(select('country', 'Country'));
    const state = operate('country', ['Canada', 'India', 'United States']);
    expect(await fillOne('id:country', 'canada')).toMatchObject({ status: 'filled' });
    expect(state.chosen).toEqual(['Canada']);
    expect(reactSelectSelection(document.getElementById('country') as HTMLElement)).toBe('Canada');
  });

  it('keeps an existing react-select selection without even opening it', async () => {
    page(select('country', 'Country', 'India'));
    const state = operate('country', ['Canada', 'India']);
    expect(await fillOne('id:country', 'Canada')).toMatchObject({
      status: 'skipped',
      message: 'The field already has a value.',
    });
    expect(state).toEqual({ opened: 0, chosen: [] });
  });

  it('shows why the Greenhouse reader is needed: the generic engine alone would overwrite it', async () => {
    page(select('country', 'Country', 'India'));
    const state = operate('country', ['Canada', 'India']);
    const [result] = await fillFields(document, [instructionFor('id:country', 'Canada')], TIMING);
    expect(state.chosen).toEqual(['Canada']); // overwritten: the selection was invisible to it
    expect(result?.status).not.toBe('skipped');
  });

  it.each([
    ['duplicate options', ['Canada', 'canada'], 'No unique option matched: several options match.'],
    ['no matching option', ['India', 'Canadian Arctic'], 'No unique option matched.'],
  ])('fails safely on %s, nothing chosen', async (_, labels, message) => {
    page(select('country', 'Country'));
    const state = operate('country', labels);
    expect(await fillOne('id:country', 'Canada')).toMatchObject({ status: 'failed', message });
    expect(state.chosen).toEqual([]);
    expect(document.getElementById('react-select-country-listbox')).toBeNull();
  });

  it('never clicks Submit or navigation buttons, and never submits', async () => {
    page(`${select('country', 'Country')}${text('first_name', 'First Name')}
      <button type="button" id="next">Next</button><button type="button">Continue</button><button type="button">Apply</button>`);
    operate('country', ['Canada']);
    let clicks = 0;
    let submitted = false;
    document
      .querySelectorAll('button')
      .forEach((b) => b.addEventListener('click', () => (clicks += 1)));
    document.getElementById('application-form')?.addEventListener('submit', (e) => {
      submitted = true;
      e.preventDefault();
    });
    await fillGreenhouse(
      document,
      [instructionFor('id:country', 'Canada'), instructionFor('id:first_name', 'Jane')],
      TIMING,
    );
    expect(clicks).toBe(0);
    expect(submitted).toBe(false);
  });

  it('keeps existing text, and skips disabled and read-only questions', async () => {
    page(
      `${text('first_name', 'First Name', 'value="Kept"')}${text('question_1', 'City', 'disabled')}${text('question_2', 'State', 'readonly')}`,
    );
    const results = await fillGreenhouse(
      document,
      ['id:first_name', 'id:question_1', 'id:question_2'].map((id) => instructionFor(id, 'X')),
      TIMING,
    );
    expect(results.map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Kept');
  });

  it('refuses a question that was removed or replaced since Analyze', async () => {
    page(`${text('question_1', 'City')}${text('question_2', 'State')}`);
    const [city, state] = [
      instructionFor('id:question_1', 'Springfield'),
      instructionFor('id:question_2', 'Ontario'),
    ];
    // question_1 is now a different question (new id); question_2 was removed.
    page(`${text('question_7', 'City')}`);
    const results = await fillGreenhouse(document, [city, state], TIMING);
    expect(results.map((r) => r.status)).toEqual(['not-found', 'not-found']);
    expect((document.getElementById('question_7') as HTMLInputElement).value).toBe('');
  });

  it('isolates failures: a failing dropdown does not stop other questions', async () => {
    page(`${select('country', 'Country')}${text('first_name', 'First Name')}`);
    operate('country', ['India']);
    const results = await fillGreenhouse(
      document,
      [instructionFor('id:country', 'Canada'), instructionFor('id:first_name', 'Jane')],
      TIMING,
    );
    expect(results.map((r) => r.status)).toEqual(['failed', 'filled']);
  });
});
