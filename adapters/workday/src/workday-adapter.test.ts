// @vitest-environment happy-dom
import { selectAdapter, type FillInstruction, type FillValue } from '@applyonce/core';
import { genericAdapter } from '@applyonce/adapter-generic';
import { createAliasMatcher, mapFields } from '@applyonce/field-mapper';
import { beforeEach, describe, expect, it } from 'vitest';
import { detectWorkday, scanWorkdayFields, workdayAdapter } from './index';

/** Chrome observed on a real Workday candidate site: header, navigation, footer. */
const HEADER = `
  <div data-automation-id="header">
    <div data-automation-id="navigationContainer">
      <div data-automation-id="utilityButtonBar">
        <div data-automation-id="utilityButtonBarLanguageMenu">
          <button type="submit" id="languageSelectorButton" data-automation-id="utilityMenuButton" aria-haspopup="listbox">English</button>
        </div>
        <a data-automation-id="utilityButtonSignIn" href="#">Sign In</a>
      </div>
    </div>
  </div>`;
const FOOTER = `<div data-automation-id="footerContainer"><a data-automation-id="privacyLink" href="#">Privacy</a></div>`;

let generated = 0;
/** Workday-style field: container with automation id, label for a generated input id. */
function textField(auto: string, label: string, extra = '') {
  generated += 1;
  return `
    <div data-automation-id="formField-${auto}">
      <label for="input-${generated}">${label}<abbr title="required">*</abbr></label>
      <input id="input-${generated}" type="text" data-automation-id="${auto}" data-uxi-widget-type="inputField" ${extra}>
    </div>`;
}

function page(body: string, { scoped = true } = {}) {
  const content = scoped
    ? `<div data-automation-id="applyFlowPage">
         <div data-automation-id="progressBar"><div data-automation-id="progressBarActiveStep">My Information</div></div>
         ${body}
         <button type="button" data-automation-id="pageFooterBackButton" id="back">Back</button>
         <button type="button" data-automation-id="pageFooterNextButton" id="next">Save and Continue</button>
       </div>`
    : body;
  document.body.innerHTML = HEADER + content + FOOTER;
}

const URL_PLAIN = 'https://careers.example.com/apply';
const context = () => ({ url: URL_PLAIN, root: document });
const matcher = createAliasMatcher();

function instructionFor(fieldId: string, value: FillValue): FillInstruction {
  const field = scanWorkdayFields(document).find((f) => f.id === fieldId);
  if (!field) throw new Error(`No field ${fieldId}`);
  const { name, htmlId, label } = field.signals;
  return { fieldId, value, expected: { type: field.type, name, htmlId, label } };
}

beforeEach(() => {
  document.body.innerHTML = '';
  generated = 0;
});

describe('platform detection', () => {
  it.each([
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R123/apply',
    'https://acme.wd5.myworkdaysite.com/recruiting/acme/Careers',
    'https://wd5.myworkday.com/acme/d/task/1.htmld',
  ])('recognises the Workday host %s', (url) => {
    expect(detectWorkday({ url, root: document })).toMatchObject({ platform: 'workday' });
  });

  it.each(['applyFlowPage', 'jobPostingPage', 'jobSearchPage', 'applyAdventurePage'])(
    'recognises the Workday page container "%s" on a custom domain',
    (marker) => {
      document.body.innerHTML = `<div data-automation-id="${marker}"></div>`;
      expect(detectWorkday(context())).toEqual({
        platform: 'workday',
        evidence: [`Workday page container "${marker}"`],
      });
    },
  );

  it('recognises many automation ids together with Workday widget types', () => {
    document.body.innerHTML =
      Array.from({ length: 12 }, (_, i) => `<div data-automation-id="a${i}"></div>`).join('') +
      '<input data-uxi-widget-type="inputField">';
    expect(detectWorkday(context()).platform).toBe('workday');
  });

  it.each([
    [
      'only automation ids',
      Array.from({ length: 12 }, (_, i) => `<div data-automation-id="a${i}"></div>`).join(''),
    ],
    ['only a widget type', '<input data-uxi-widget-type="inputField">'],
    [
      'the word Workday in text',
      '<p>We use Workday. Apply with Workday!</p><form><input name="q"></form>',
    ],
    ['an ordinary form', '<form><label for="f">First name</label><input id="f"></form>'],
    ['a look-alike host', ''],
  ])('leaves weak or no evidence to the generic adapter: %s', (_, html) => {
    document.body.innerHTML = html;
    const url = html === '' ? 'https://myworkdayjobs.com.evil.example/apply' : URL_PLAIN;
    expect(detectWorkday({ url, root: document }).platform).toBe('generic');
  });

  it('handles an invalid URL', () => {
    expect(detectWorkday({ url: 'not a url', root: document }).platform).toBe('generic');
  });

  it('is selected over the generic adapter only with Workday evidence', () => {
    page(textField('a', 'First Name'));
    expect(selectAdapter([workdayAdapter], genericAdapter, context()).id).toBe('workday');
    document.body.innerHTML = '<form><input name="q"></form>';
    expect(selectAdapter([workdayAdapter], genericAdapter, context()).id).toBe('generic');
  });
});

describe('field detection', () => {
  it('scans only the application step: never the header language selector or footer', () => {
    document.body.innerHTML = HEADER + '<input name="outside" aria-label="Outside">' + FOOTER;
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-automation-id="applyFlowPage">${textField('fn', 'First Name')}</div>`,
    );
    expect(scanWorkdayFields(document).map((f) => f.signals.label)).toEqual(['First Name*']);
  });

  it('without an application step, still excludes the site chrome', () => {
    page(textField('kw', 'Search for jobs'), { scoped: false });
    const fields = scanWorkdayFields(document);
    expect(fields.map((f) => f.id)).toEqual(['key:kw']);
    // The generic scanner alone would include the language selector.
    expect(genericAdapter.getFields(context()).map((f) => f.htmlType)).toContain('listbox-button');
  });

  it('identifies fields by automation id, so a re-render with new generated ids keeps the id', () => {
    page(textField('legalName-firstName', 'First Name'));
    const before = scanWorkdayFields(document).map((f) => f.id);
    generated = 40;
    page(textField('legalName-firstName', 'First Name'));
    expect(scanWorkdayFields(document).map((f) => f.id)).toEqual(before);
    expect(before).toEqual(['key:legalName-firstName']);
  });

  it('extracts the question from label, aria-labelledby, and aria-label', () => {
    page(`
      ${textField('a', 'First Name')}
      <div data-automation-id="formField-b"><span id="3f2a-uuid">Last Name</span><input type="text" data-automation-id="b" aria-labelledby="3f2a-uuid"></div>
      <div data-automation-id="formField-c"><input type="text" data-automation-id="c" aria-label="Email Address"></div>`);
    expect(scanWorkdayFields(document).map((f) => f.signals.label ?? f.signals.ariaLabel)).toEqual([
      'First Name*',
      'Last Name',
      'Email Address',
    ]);
  });

  it('treats a visible control and its hidden helper input as one field', () => {
    page(`
      <div data-automation-id="formField-country">
        <label for="input-9">Country</label>
        <input id="input-9" type="text" data-automation-id="countryInput">
        <input type="text" data-automation-id="countryHelper" style="display:none">
      </div>`);
    expect(scanWorkdayFields(document).map((f) => f.id)).toEqual(['key:countryInput']);
  });

  it('uses the generic custom-dropdown detection for listbox buttons', () => {
    page(`
      <div data-automation-id="formField-mode">
        <label id="mode-label">Work Mode</label>
        <button type="button" data-automation-id="modeDropdown" aria-haspopup="listbox" aria-expanded="false" aria-controls="mode-list" aria-labelledby="mode-label">Select One</button>
      </div>`);
    expect(scanWorkdayFields(document)[0]).toMatchObject({
      id: 'key:modeDropdown',
      type: 'select',
      custom: { pattern: 'listbox-button', supported: true },
      signals: { label: 'Work Mode' },
    });
  });

  it('marks search-and-select inputs unsupported (no typing into suggestion searches)', () => {
    page(textField('school', 'University', 'aria-autocomplete="list"'));
    const [field] = scanWorkdayFields(document);
    expect(field?.custom).toEqual({ pattern: 'search-input', supported: false });
    expect(mapFields(scanWorkdayFields(document), matcher).mappings[0]).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'unsupported-control',
      profileField: 'institution',
    });
  });

  it('marks questions repeated across record sections, but not single sections', () => {
    page(`
      <div data-automation-id="workExperienceSection">
        <div data-automation-id="workExperience-1">${textField('jobTitle', 'Job Title')}${textField('company', 'Company')}</div>
        <div data-automation-id="workExperience-2">${textField('jobTitle', 'Job Title')}${textField('company', 'Company')}</div>
      </div>
      <div data-automation-id="educationSection">
        <div data-automation-id="education-1">${textField('school', 'Field of Study')}</div>
      </div>`);
    const fields = scanWorkdayFields(document);
    expect(fields.map((f) => [f.id, f.repeatedCount])).toEqual([
      ['key:jobTitle', 2],
      ['key:company', 2],
      ['key:jobTitle~2', 2],
      ['key:company~2', 2],
      ['key:school', undefined],
    ]);
    const mappings = mapFields(fields, matcher).mappings;
    expect(mappings.map((m) => m.status)).toEqual([
      'unsupported',
      'unsupported',
      'unsupported',
      'unsupported',
      'mapped',
    ]);
    expect(mappings[0]).toMatchObject({ unsupportedReason: 'repeated-question' });
  });

  it('detects radio groups and checkboxes; ignores file uploads, passwords, and buttons', () => {
    page(`
      <fieldset data-automation-id="formField-sponsor"><legend>Will you require visa sponsorship?</legend>
        <label><input type="radio" name="sponsor" value="1"> Yes</label>
        <label><input type="radio" name="sponsor" value="0"> No</label>
      </fieldset>
      <div data-automation-id="formField-relocate"><label><input type="checkbox" data-automation-id="relocate"> Willing to relocate</label></div>
      <div data-automation-id="formField-veteran"><label><input type="checkbox" data-automation-id="veteran"> I identify as a protected veteran</label></div>
      <div data-automation-id="file-upload-drop-zone"><input type="file" data-automation-id="file-upload-input-ref"></div>
      <input type="password" data-automation-id="password">`);
    const fields = scanWorkdayFields(document);
    expect(fields.map((f) => [f.type, f.signals.label])).toEqual([
      ['radio', 'Will you require visa sponsorship?'],
      ['checkbox', 'Willing to relocate'],
      ['checkbox', 'I identify as a protected veteran'],
    ]);
    const mappings = mapFields(fields, matcher).mappings;
    expect(mappings.map((m) => [m.status, m.profileField])).toEqual([
      ['review', 'requires_sponsorship'],
      ['mapped', 'willing_to_relocate'],
      ['unknown', undefined],
    ]);
  });
});

describe('filling through the generic engine', () => {
  function stepWithDropdown() {
    page(`
      ${textField('firstName', 'First Name')}
      ${textField('email', 'Email Address', 'value="kept@example.com"')}
      <div data-automation-id="formField-mode">
        <label id="mode-label">Work Mode</label>
        <button type="button" data-automation-id="modeDropdown" aria-haspopup="listbox" aria-expanded="false" aria-controls="mode-list" aria-labelledby="mode-label">Select One</button>
      </div>
      ${textField('school', 'University', 'aria-autocomplete="list"')}`);
    // A Workday-like popup rendered at the end of <body>, opened by the trigger.
    const trigger = document.querySelector(
      '[data-automation-id="modeDropdown"]',
    ) as HTMLButtonElement;
    const list = document.createElement('ul');
    list.id = 'mode-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    for (const label of ['Remote', 'Hybrid', 'On-site']) {
      const option = document.createElement('li');
      option.setAttribute('role', 'option');
      option.setAttribute('data-automation-id', 'promptOption');
      option.textContent = label;
      option.addEventListener('click', () => {
        trigger.textContent = label;
        trigger.setAttribute('aria-expanded', 'false');
        list.hidden = true;
      });
      list.append(option);
    }
    document.body.append(list);
    trigger.addEventListener('click', () => {
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    });
    let navigation = 0;
    for (const id of ['next', 'back'])
      document.getElementById(id)?.addEventListener('click', () => (navigation += 1));
    return { trigger, navigation: () => navigation };
  }

  const fill = (instructions: FillInstruction[]) =>
    workdayAdapter.fillFields({ url: URL_PLAIN, root: document }, instructions);

  it('fills text and custom dropdowns, keeps existing values, never types into searches or navigates', async () => {
    const { trigger, navigation } = stepWithDropdown();
    const instructions = [
      instructionFor('key:firstName', 'Jane'),
      instructionFor('key:email', 'jane.doe@example.com'),
      instructionFor('key:modeDropdown', 'onsite'),
      instructionFor('key:school', 'Example University'),
    ];
    const results = await workdayAdapter.fillFields(
      { url: URL_PLAIN, root: document },
      instructions,
    );
    expect(results.map((r) => r.status)).toEqual(['filled', 'skipped', 'filled', 'unsupported']);
    expect(
      (document.querySelector('[data-automation-id="firstName"]') as HTMLInputElement).value,
    ).toBe('Jane');
    expect((document.querySelector('[data-automation-id="email"]') as HTMLInputElement).value).toBe(
      'kept@example.com',
    );
    expect(trigger.textContent).toBe('On-site');
    expect(
      (document.querySelector('[data-automation-id="school"]') as HTMLInputElement).value,
    ).toBe('');
    expect(navigation()).toBe(0);
  });

  it('rediscovers fields after a re-render with new generated ids', async () => {
    page(textField('firstName', 'First Name'));
    const instruction = instructionFor('key:firstName', 'Jane');
    generated = 90;
    page(textField('firstName', 'First Name'));
    expect((await fill([instruction]))[0]).toMatchObject({ status: 'filled' });
  });

  it('reports a removed field and keeps filling the others', async () => {
    page(`${textField('firstName', 'First Name')}${textField('city', 'City')}`);
    const instructions = [
      instructionFor('key:firstName', 'Jane'),
      instructionFor('key:city', 'Springfield'),
    ];
    document.querySelector('[data-automation-id="formField-firstName"]')?.remove();
    expect((await fill(instructions)).map((r) => r.status)).toEqual(['not-found', 'filled']);
  });

  it('never clicks a dropdown trigger or option named like a navigation action', async () => {
    page(`
      <div data-automation-id="formField-x"><label id="xl">Notice Period</label>
        <button type="button" data-automation-id="x" aria-haspopup="listbox" aria-expanded="false" aria-controls="x-list" aria-labelledby="xl">Next</button>
      </div>`);
    let clicks = 0;
    document
      .querySelector('[data-automation-id="x"]')
      ?.addEventListener('click', () => (clicks += 1));
    const [result] = await workdayAdapter.fillFields({ url: URL_PLAIN, root: document }, [
      instructionFor('key:x', '30 days'),
    ]);
    expect(result).toMatchObject({ status: 'failed' });
    expect(clicks).toBe(0);
  });

  it('uses bounded waits: a dropdown whose list never appears fails', async () => {
    page(`
      <div data-automation-id="formField-y"><label id="yl">Work Mode</label>
        <button type="button" data-automation-id="y" aria-haspopup="listbox" aria-expanded="false" aria-controls="never" aria-labelledby="yl">Select One</button>
      </div>`);
    const started = Date.now();
    const [result] = await workdayAdapter.fillFields({ url: URL_PLAIN, root: document }, [
      instructionFor('key:y', 'remote'),
    ]);
    expect(result).toMatchObject({
      status: 'failed',
      message: 'The list of options did not appear.',
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
