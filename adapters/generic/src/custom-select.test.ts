// @vitest-environment happy-dom
import type { FillInstruction, FillValue } from '@applyonce/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { findListbox } from './custom-select';
import { fillFields } from './fill-fields';
import { scanControls, scanFields, type ScannedField } from './scan-fields';

const TIMING = { customControlTiming: { timeoutMs: 300, intervalMs: 10 } };

interface WidgetOption {
  label: string;
  value?: string;
  /** Inner HTML, for nested or decorative content. */
  html?: string;
  disabled?: boolean;
}

interface WidgetConfig {
  id: string;
  label: string;
  kind?: 'input' | 'div' | 'button';
  options: WidgetOption[];
  selectedIndex?: number;
  openOn?: 'mousedown' | 'click' | 'keyboard';
  portal?: boolean;
  createOnOpen?: boolean;
  controlsOnlyWhenOpen?: boolean;
  optionsDelayMs?: number;
  /** How a selection becomes visible. */
  confirm?: 'display' | 'aria-selected' | 'outside' | 'none';
  /** Declares no relationship at all (no aria-controls/owns/expanded). */
  noRelationship?: boolean;
  multiselectable?: boolean;
  /** A <button> trigger left with the default type (submit). */
  submitButton?: boolean;
}

/** A minimal ARIA dropdown built from plain DOM listeners, standing in for UI libraries. */
function mountWidget(config: WidgetConfig) {
  const {
    id,
    label,
    kind = 'div',
    options,
    openOn = 'click',
    portal = false,
    createOnOpen = false,
    controlsOnlyWhenOpen = false,
    optionsDelayMs,
    confirm = 'display',
  } = config;
  const listboxId = `${id}-listbox`;
  const state: { selected?: number; opened: number } = {
    selected: config.selectedIndex,
    opened: 0,
  };

  const container = document.createElement('div');
  container.className = 'field';
  container.innerHTML = `<label for="${id}">${label}</label>`;
  document.body.append(container);

  const control = document.createElement(
    kind === 'input' ? 'input' : kind === 'button' ? 'button' : 'div',
  );
  control.id = id;
  if (kind === 'button') {
    control.setAttribute('aria-haspopup', 'listbox');
    if (!config.submitButton) (control as HTMLButtonElement).type = 'button';
  } else control.setAttribute('role', 'combobox');
  if (!config.noRelationship) {
    control.setAttribute('aria-expanded', 'false');
    if (!controlsOnlyWhenOpen) control.setAttribute('aria-controls', listboxId);
  }
  container.append(control);
  const outside = document.createElement('div');
  outside.className = 'value-outside';
  container.append(outside);

  let listbox: HTMLElement | null = null;
  const display = () => {
    const text = state.selected === undefined ? '' : (options[state.selected]?.label ?? '');
    if (confirm === 'outside') outside.textContent = text;
    else if (kind === 'input')
      (control as HTMLInputElement).value = confirm === 'display' ? text : '';
    else control.textContent = confirm === 'display' && text ? text : 'Select…';
  };
  const createListbox = () => {
    const element = document.createElement('div');
    element.id = listboxId;
    element.setAttribute('role', 'listbox');
    if (config.multiselectable) element.setAttribute('aria-multiselectable', 'true');
    element.hidden = true;
    (portal ? document.body : container).append(element);
    return element;
  };
  const renderOptions = () => {
    if (!listbox) return;
    listbox.innerHTML = '';
    options.forEach((option, index) => {
      const element = document.createElement('div');
      element.setAttribute('role', 'option');
      element.id = `${id}-option-${index}`;
      if (option.value !== undefined) element.dataset.value = option.value;
      if (option.disabled) element.setAttribute('aria-disabled', 'true');
      element.innerHTML = option.html ?? option.label;
      if (state.selected === index && confirm !== 'none')
        element.setAttribute('aria-selected', 'true');
      element.addEventListener('click', () => select(index));
      listbox?.append(element);
    });
  };
  const open = () => {
    if (control.getAttribute('aria-expanded') === 'true') return;
    state.opened += 1;
    listbox ??= createListbox();
    listbox.hidden = false;
    control.setAttribute('aria-expanded', 'true');
    if (controlsOnlyWhenOpen) control.setAttribute('aria-controls', listboxId);
    if (optionsDelayMs) setTimeout(renderOptions, optionsDelayMs);
    else renderOptions();
  };
  const close = () => {
    control.setAttribute('aria-expanded', 'false');
    if (controlsOnlyWhenOpen) control.removeAttribute('aria-controls');
    if (createOnOpen) {
      listbox?.remove();
      listbox = null;
    } else if (listbox) listbox.hidden = true;
  };
  const select = (index: number) => {
    if (confirm === 'none') return close();
    state.selected = index;
    display();
    if (confirm === 'aria-selected') renderOptions();
    else close();
  };

  if (!createOnOpen) listbox = createListbox();
  display();
  control.addEventListener(openOn === 'keyboard' ? 'keydown' : openOn, (event) => {
    if (openOn === 'keyboard' && (event as KeyboardEvent).key !== 'ArrowDown') return;
    if (control.getAttribute('aria-expanded') === 'true' && openOn === 'click') close();
    else open();
  });
  control.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') close();
  });
  return {
    control,
    state,
    outside,
    isOpen: () => control.getAttribute('aria-expanded') === 'true',
  };
}

const WORK_MODES: WidgetOption[] = [{ label: 'Remote' }, { label: 'Hybrid' }, { label: 'On-site' }];

function instructionFor(fieldId: string, value: FillValue): FillInstruction {
  const field = scanFields(document).find((f) => f.id === fieldId);
  if (!field) throw new Error(`No field ${fieldId}`);
  const { name, htmlId, label } = field.signals;
  return { fieldId, value, expected: { type: field.type, name, htmlId, label } };
}

async function fillOne(fieldId: string, value: FillValue) {
  const [result] = await fillFields(document, [instructionFor(fieldId, value)], TIMING);
  return result;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('detection', () => {
  it.each([
    ['input', 'input-combobox', 'combobox'],
    ['div', 'combobox', 'combobox'],
    ['button', 'listbox-button', 'listbox-button'],
  ] as const)('%s control → one select field (%s)', (kind, pattern, htmlType) => {
    mountWidget({ id: 'mode', label: 'Work mode', kind, options: WORK_MODES });
    expect(scanFields(document)).toEqual([
      {
        id: 'id:mode',
        type: 'select',
        htmlType,
        required: false,
        visible: true,
        disabled: false,
        custom: { pattern, supported: true },
        signals: { htmlId: 'mode', label: 'Work mode' },
        // Phase 14: every scanned field has a semantic identity (unique here).
        identity: { key: expect.stringMatching(/^fp-[0-9a-f]{16}$/) as string, unique: true },
      },
    ]);
  });

  it('accepts aria-owns and aria-expanded as the relationship', () => {
    document.body.innerHTML = `
      <div role="combobox" id="a" aria-owns="lb" aria-label="A"></div>
      <div role="combobox" id="b" aria-expanded="false" aria-label="B"></div>`;
    expect(scanFields(document).map((f) => f.custom?.supported)).toEqual([true, true]);
  });

  it('marks a combobox without any popup relationship as unsupported', () => {
    mountWidget({ id: 'x', label: 'Work mode', options: WORK_MODES, noRelationship: true });
    expect(scanFields(document)[0]?.custom).toEqual({ pattern: 'combobox', supported: false });
  });

  it('does not use the current value as the question', () => {
    document.body.innerHTML = `
      <span id="lbl">Work mode</span>
      <div role="combobox" id="mode" aria-labelledby="lbl mode" aria-controls="lb" aria-expanded="false">Remote</div>`;
    expect(scanFields(document)[0]?.signals.label).toBe('Work mode');
  });

  it('strips the control out of a wrapping label', () => {
    document.body.innerHTML = `<label>Work mode <button aria-haspopup="listbox" aria-expanded="false">Remote</button></label>`;
    expect(scanFields(document)[0]?.signals.label).toBe('Work mode');
  });

  it('treats the trigger, its inner input, hidden native input, and options as one field', () => {
    document.body.innerHTML = `
      <div class="field"><label>Degree</label>
        <div role="combobox" id="deg" aria-controls="deg-lb" aria-expanded="true">
          <input type="text" name="deg-search">
          <span>Master's</span>
        </div>
        <input name="degree" value="" aria-hidden="true" tabindex="-1">
        <div role="listbox" id="deg-lb"><div role="option">Bachelor's</div><div role="option" aria-selected="true">Master's</div></div>
      </div>`;
    const fields = scanFields(document);
    expect(fields.map((f) => [f.id, f.type, f.signals.label])).toEqual([
      ['id:deg', 'select', 'Degree'],
    ]);
  });

  it('never makes an ordinary input a combobox', () => {
    document.body.innerHTML = '<label for="c">City</label><input id="c" aria-autocomplete="list">';
    expect(scanFields(document)[0]).toMatchObject({ type: 'text', htmlType: 'text' });
    expect(scanFields(document)[0]?.custom).toBeUndefined();
  });

  it.each([
    ['aria-disabled', { attr: 'aria-disabled', value: 'true' }, 'disabled'],
    ['aria-readonly', { attr: 'aria-readonly', value: 'true' }, 'readOnly'],
    ['hidden', { attr: 'hidden', value: '' }, 'visible'],
  ] as const)('records %s custom controls', (_, { attr, value }, property) => {
    const { control } = mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES });
    control.setAttribute(attr, value);
    const field = scanFields(document)[0];
    expect(field?.[property]).toBe(property !== 'visible');
  });

  it('records a disabled button trigger', () => {
    const { control } = mountWidget({
      id: 'mode',
      label: 'Work mode',
      kind: 'button',
      options: WORK_MODES,
    });
    (control as HTMLButtonElement).disabled = true;
    expect(scanFields(document)[0]?.disabled).toBe(true);
  });

  it('keeps deterministic ids across re-renders', () => {
    mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES });
    const first = scanFields(document).map((f) => f.id);
    document.body.innerHTML = '';
    mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES });
    expect(scanFields(document).map((f) => f.id)).toEqual(first);
  });
});

describe('listbox relationship', () => {
  it('finds an inline or portal listbox through aria-controls', () => {
    const inline = mountWidget({ id: 'a', label: 'A', options: WORK_MODES });
    const portal = mountWidget({ id: 'b', label: 'B', options: WORK_MODES, portal: true });
    for (const widget of [inline, portal]) {
      widget.control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const listbox = findListbox(widget.control);
      expect(listbox).toBeInstanceOf(HTMLElement);
      expect((listbox as HTMLElement).id).toBe(`${widget.control.id}-listbox`);
    }
  });

  it('reports several referenced listboxes as ambiguous', () => {
    document.body.innerHTML = `
      <div role="combobox" id="x" aria-controls="one two" aria-expanded="true"></div>
      <div role="listbox" id="one"></div><div role="listbox" id="two"></div>`;
    expect(findListbox(document.getElementById('x') as HTMLElement)).toBe('ambiguous');
  });

  it('never picks a listbox without a relationship, however close it is', () => {
    document.body.innerHTML = `
      <div role="combobox" id="x" aria-expanded="true"></div><div role="listbox"><div role="option">A</div></div>`;
    expect(findListbox(document.getElementById('x') as HTMLElement)).toBeUndefined();
  });

  it('follows aria-activedescendant when nothing else is declared', () => {
    document.body.innerHTML = `
      <input role="combobox" id="x" aria-expanded="true" aria-activedescendant="o1">
      <div role="listbox" id="lb"><div role="option" id="o1">A</div></div>`;
    expect((findListbox(document.getElementById('x') as HTMLElement) as HTMLElement).id).toBe('lb');
  });
});

describe('filling', () => {
  it.each([
    ['div + click + inline', { kind: 'div' as const }],
    ['input + mousedown', { kind: 'input' as const, openOn: 'mousedown' as const }],
    ['button + click + portal', { kind: 'button' as const, portal: true }],
    ['keyboard-only combobox', { openOn: 'keyboard' as const }],
    [
      'listbox created on open, controls set only when open',
      { createOnOpen: true, controlsOnlyWhenOpen: true },
    ],
    ['options rendered after a delay', { optionsDelayMs: 50 }],
    ['confirmed through aria-selected only', { confirm: 'aria-selected' as const }],
    [
      'value shown outside the control (confirmed by re-opening)',
      { kind: 'input' as const, confirm: 'outside' as const },
    ],
  ])('selects the matching option: %s', async (_, config) => {
    const widget = mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES, ...config });
    expect(await fillOne('id:mode', 'onsite')).toMatchObject({ status: 'filled' });
    expect(widget.state.selected).toBe(2);
    expect(widget.isOpen()).toBe(false);
  });

  it('never opens anything during analysis', () => {
    const widget = mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES });
    scanFields(document);
    expect(widget.state.opened).toBe(0);
  });

  it('finds the control again after a re-render between analysis and fill', async () => {
    mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES });
    const instruction = instructionFor('id:mode', 'hybrid');
    document.body.innerHTML = '';
    const rerendered = mountWidget({
      id: 'mode',
      label: 'Work mode',
      options: WORK_MODES,
      portal: true,
    });
    const [result] = await fillFields(document, [instruction], TIMING);
    expect(result).toMatchObject({ status: 'filled' });
    expect(rerendered.state.selected).toBe(1);
  });

  it('reads option labels without decorative content and matches value metadata', async () => {
    const widget = mountWidget({
      id: 'mode',
      label: 'Work mode',
      options: [
        {
          label: 'Remote',
          value: 'remote',
          html: '<span>Remote</span><span aria-hidden="true">✓</span>',
        },
        { label: 'Office', value: 'onsite', html: '<span>Office</span>' },
      ],
    });
    expect(await fillOne('id:mode', 'onsite')).toMatchObject({ status: 'filled' });
    expect(widget.state.selected).toBe(1);
  });

  it.each([
    [
      'exact value metadata',
      [
        { label: 'A', value: 'full-time' },
        { label: 'B', value: 'contract' },
      ],
      0,
    ],
    [
      'normalized value metadata',
      [
        { label: 'A', value: 'FULL_TIME' },
        { label: 'B', value: 'CONTRACT' },
      ],
      0,
    ],
    ['exact normalized label', [{ label: 'Contract' }, { label: 'Full-time' }], 1],
    ['spacing/punctuation', [{ label: 'Contract' }, { label: 'Full time' }], 1],
  ])('matches by %s', async (_, options, expected) => {
    const widget = mountWidget({ id: 't', label: 'Employment type', options });
    expect(await fillOne('id:t', 'full-time')).toMatchObject({ status: 'filled' });
    expect(widget.state.selected).toBe(expected);
  });

  it.each([
    ['partial text', [{ label: 'Remote / Hybrid' }, { label: 'In office' }], 'remote'],
    ['a prefix', [{ label: 'Remote work' }, { label: 'Office' }], 'remote'],
    ['no match', [{ label: 'Remote' }, { label: 'Hybrid' }], 'onsite'],
    ['duplicate options', [{ label: 'Remote' }, { label: 'remote' }], 'remote'],
    ['punctuation-only duplicates', [{ label: 'On-site' }, { label: 'On site' }], 'onsite'],
    ['only a disabled match', [{ label: 'Remote', disabled: true }, { label: 'Hybrid' }], 'remote'],
  ])('fails safely on %s, selecting nothing and closing the list', async (_, options, value) => {
    const widget = mountWidget({ id: 'mode', label: 'Work mode', options });
    expect(await fillOne('id:mode', value)).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/^No unique option matched/),
    });
    expect(widget.state.selected).toBeUndefined();
    expect(widget.isOpen()).toBe(false);
  });

  it('fails when the selection cannot be confirmed', async () => {
    const widget = mountWidget({
      id: 'mode',
      label: 'Work mode',
      options: WORK_MODES,
      confirm: 'none',
    });
    expect(await fillOne('id:mode', 'onsite')).toMatchObject({
      status: 'failed',
      message: 'Unable to confirm the selection.',
    });
    expect(widget.isOpen()).toBe(false);
  });

  it('fails when the declared listbox never appears', async () => {
    document.body.innerHTML =
      '<label for="x">Work mode</label><div role="combobox" id="x" aria-controls="missing" aria-expanded="false"></div>';
    expect(await fillOne('id:x', 'onsite')).toMatchObject({
      status: 'failed',
      message: 'The list of options did not appear.',
    });
  });

  it('fails on several referenced listboxes', async () => {
    document.body.innerHTML = `
      <label for="x">Work mode</label>
      <div role="combobox" id="x" aria-controls="one two" aria-expanded="true"></div>
      <div role="listbox" id="one"><div role="option">On-site</div></div>
      <div role="listbox" id="two"><div role="option">On-site</div></div>`;
    expect(await fillOne('id:x', 'onsite')).toMatchObject({
      status: 'failed',
      message: 'Several lists are attached to this control.',
    });
  });

  it('refuses multi-select lists', async () => {
    mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES, multiselectable: true });
    expect(await fillOne('id:mode', 'onsite')).toMatchObject({ status: 'unsupported' });
  });

  it('never operates an unsupported control', async () => {
    const widget = mountWidget({
      id: 'mode',
      label: 'Work mode',
      options: WORK_MODES,
      noRelationship: true,
    });
    expect(await fillOne('id:mode', 'onsite')).toMatchObject({ status: 'unsupported' });
    expect(widget.state.opened).toBe(0);
  });
});

describe('existing selection', () => {
  it.each([
    [
      'aria-selected option (value shown elsewhere)',
      { confirm: 'outside' as const, selectedIndex: 0 },
    ],
    ['trigger text equal to an option', { kind: 'button' as const, selectedIndex: 0 }],
    ['div display equal to an option', { selectedIndex: 1 }],
  ])('keeps an existing %s', async (_, config) => {
    const widget = mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES, ...config });
    const before = widget.state.selected;
    expect(await fillOne('id:mode', 'onsite')).toMatchObject({
      status: 'skipped',
      message: 'The field already has a value.',
    });
    expect(widget.state.selected).toBe(before);
    expect(widget.isOpen()).toBe(false);
  });

  it('keeps text already in an input combobox without opening it', async () => {
    const widget = mountWidget({
      id: 'mode',
      label: 'Work mode',
      kind: 'input',
      options: WORK_MODES,
    });
    (widget.control as HTMLInputElement).value = 'Typed by user';
    expect(await fillOne('id:mode', 'onsite')).toMatchObject({ status: 'skipped' });
    expect(widget.state.opened).toBe(0);
  });

  it('treats a placeholder that is not an option as no selection', async () => {
    const widget = mountWidget({
      id: 'mode',
      label: 'Work mode',
      kind: 'button',
      options: WORK_MODES,
    });
    expect(widget.control.textContent).toBe('Select…');
    expect(await fillOne('id:mode', 'hybrid')).toMatchObject({ status: 'filled' });
  });
});

describe('state and isolation', () => {
  it.each([
    ['aria-disabled', 'aria-disabled', 'true'],
    ['aria-readonly', 'aria-readonly', 'true'],
    ['hidden', 'hidden', ''],
  ])('skips a %s control without touching it', async (_, attr, value) => {
    const widget = mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES });
    const instruction = instructionFor('id:mode', 'onsite');
    widget.control.setAttribute(attr, value);
    const [result] = await fillFields(document, [instruction], TIMING);
    expect(result).toMatchObject({ status: 'skipped' });
    expect(widget.state.opened).toBe(0);
  });

  it('reports a removed control as not found', async () => {
    mountWidget({ id: 'mode', label: 'Work mode', options: WORK_MODES });
    const instruction = instructionFor('id:mode', 'onsite');
    document.body.innerHTML = '';
    const [result] = await fillFields(document, [instruction], TIMING);
    expect(result).toMatchObject({ status: 'not-found' });
  });

  it('keeps filling other fields when a custom field fails', async () => {
    mountWidget({
      id: 'mode',
      label: 'Work mode',
      options: [{ label: 'Remote' }, { label: 'remote' }],
    });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<label for="city">City</label><input id="city">',
    );
    mountWidget({
      id: 'type',
      label: 'Employment type',
      options: [{ label: 'Full time' }, { label: 'Contract' }],
    });
    const results = await fillFields(
      document,
      [
        instructionFor('id:mode', 'remote'),
        instructionFor('id:city', 'Springfield'),
        instructionFor('id:type', 'contract'),
      ],
      TIMING,
    );
    expect(results.map((r) => r.status)).toEqual(['failed', 'filled', 'filled']);
    expect((document.getElementById('city') as HTMLInputElement).value).toBe('Springfield');
  });

  it.each([
    ['a type="button" trigger', false],
    ['a trigger left as a submit button', true],
  ])('never submits the form with %s', async (_, submitButton) => {
    document.body.innerHTML = '<form id="f"></form>';
    let submitted = false;
    document.getElementById('f')?.addEventListener('submit', (event) => {
      submitted = true;
      event.preventDefault();
    });
    const widget = mountWidget({
      id: 'mode',
      label: 'Work mode',
      kind: 'button',
      options: WORK_MODES,
      submitButton,
    });
    document.getElementById('f')?.append(widget.control.parentElement as HTMLElement);
    const result = await fillOne('id:mode', 'onsite');
    expect(submitted).toBe(false);
    // A submit-button trigger is never clicked, so a click-to-open widget cannot open.
    expect(result?.status).toBe(submitButton ? 'failed' : 'filled');
  });

  it('never clicks an option that is a submit button', async () => {
    document.body.innerHTML = `
      <form id="f"><label for="x">Work mode</label>
        <div role="combobox" id="x" aria-controls="lb" aria-expanded="true"></div>
        <div role="listbox" id="lb"><button role="option">On-site</button><button role="option">Remote</button></div>
      </form>`;
    let submitted = false;
    document.getElementById('f')?.addEventListener('submit', (event) => {
      submitted = true;
      event.preventDefault();
    });
    expect(await fillOne('id:x', 'onsite')).toMatchObject({ status: 'failed' });
    expect(submitted).toBe(false);
  });
});

describe('Phase 8: navigation and submission safety', () => {
  it.each(['Next', 'Save and Continue', 'Submit', 'Continue', 'Apply', 'Back'])(
    'never clicks a trigger named "%s"',
    async (name) => {
      document.body.innerHTML = `
        <label id="l">Notice period</label>
        <button type="button" id="x" aria-haspopup="listbox" aria-expanded="false" aria-controls="lb" aria-labelledby="l">${name}</button>
        <div role="listbox" id="lb" hidden><div role="option">30 days</div></div>`;
      let clicks = 0;
      document.getElementById('x')?.addEventListener('click', () => (clicks += 1));
      expect(await fillOne('id:x', '30 days')).toMatchObject({ status: 'failed' });
      expect(clicks).toBe(0);
    },
  );

  it('still operates a trigger whose current value merely contains such a word', async () => {
    const widget = mountWidget({
      id: 'n',
      label: 'Notice period',
      kind: 'button',
      options: [{ label: 'Next month' }, { label: '30 days' }],
    });
    expect(await fillOne('id:n', '30 days')).toMatchObject({ status: 'filled' });
    expect(widget.state.selected).toBe(1);
  });

  it('never clicks an option named like a navigation action', async () => {
    document.body.innerHTML = `
      <label for="x">Work mode</label>
      <div role="combobox" id="x" aria-controls="lb" aria-expanded="true"></div>
      <div role="listbox" id="lb"><button type="button" role="option">Next</button></div>`;
    let clicks = 0;
    document.querySelector('[role=option]')?.addEventListener('click', () => (clicks += 1));
    expect(await fillOne('id:x', 'next')).toMatchObject({ status: 'failed' });
    expect(clicks).toBe(0);
  });
});

describe('Phase 9: site-specific custom fillers', () => {
  /** A scan that marks the combobox input as a search field, like the Workday scan does. */
  const searchScan = (root: ParentNode): ScannedField[] =>
    scanControls(root).map((entry) =>
      entry.field.custom
        ? {
            ...entry,
            field: { ...entry.field, custom: { pattern: 'search-input', supported: true } },
          }
        : entry,
    );

  beforeEach(() => {
    document.body.innerHTML = `
      <label for="s">University</label>
      <input id="s" role="combobox" aria-autocomplete="list" aria-controls="lb" aria-expanded="false">`;
  });

  it('leaves a search field untouched when no site filler handles it', async () => {
    const instruction: FillInstruction = {
      fieldId: 'id:s',
      value: 'University of Example',
      expected: { type: 'select', htmlId: 's', label: 'University' },
    };
    const [result] = await fillFields(document, [instruction], { ...TIMING, scan: searchScan });
    expect(result).toMatchObject({ status: 'unsupported' });
    expect((document.getElementById('s') as HTMLInputElement).value).toBe('');
  });

  it('hands custom controls to the site filler, and falls back when it declines', async () => {
    const seen: string[] = [];
    const instruction: FillInstruction = {
      fieldId: 'id:s',
      value: 'University of Example',
      expected: { type: 'select', htmlId: 's', label: 'University' },
    };
    const [result] = await fillFields(document, [instruction], {
      ...TIMING,
      scan: searchScan,
      fillCustom: ({ field, control }, value) => {
        seen.push(`${field.custom?.pattern}:${control.id}:${String(value)}`);
        return Promise.resolve({ status: 'filled', message: 'Filled.' });
      },
    });
    expect(seen).toEqual(['search-input:s:University of Example']);
    expect(result).toMatchObject({ status: 'filled' });

    const [declined] = await fillFields(document, [instruction], {
      ...TIMING,
      scan: searchScan,
      fillCustom: () => undefined,
    });
    expect(declined).toMatchObject({ status: 'unsupported' });
  });
});
