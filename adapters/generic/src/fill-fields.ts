import type {
  FieldOption,
  FillInstruction,
  FillResult,
  FillValue,
  FormField,
} from '@applyonce/core';
import { normalizeText } from '@applyonce/field-mapper';
import {
  DEFAULT_CUSTOM_CONTROL_TIMING,
  fillCustomSelect,
  type CustomControlTiming,
} from './custom-select';
import {
  ALREADY_MATCHES,
  EXISTING_VALUE,
  failed,
  filled,
  skipped,
  unsupported,
  type Outcome,
} from './fill-outcome';
import { findMatchingOption } from './option-match';
import { scanControls, type FormControl, type ScannedField } from './scan-fields';

export { findMatchingOption } from './option-match';

type TextControl = HTMLInputElement | HTMLTextAreaElement;

export interface FillOptions {
  /** Waits used for custom dropdowns (see custom-select.ts). */
  customControlTiming?: CustomControlTiming;
  /**
   * How fields are found again before filling. Site adapters pass the same scan they
   * analyze with, so field ids and flags match.
   */
  scan?: (root: ParentNode) => ScannedField[];
  /**
   * A site adapter's filler for custom controls the generic engine does not operate (e.g.
   * search-as-you-type inputs). Return undefined to let the generic engine handle it.
   */
  fillCustom?: CustomFiller;
}

export type CustomFiller = (
  target: { field: FormField; control: HTMLElement },
  value: FillValue,
  timing: CustomControlTiming,
) => Promise<Outcome> | undefined;

/**
 * Fills approved fields one at a time and resolves to one result per instruction, in
 * order.
 *
 * The page is scanned again first and each field is located by its deterministic id in
 * the current DOM, then checked against the metadata recorded at analysis time. So a
 * re-rendered field is still found, while a removed or different field is reported as
 * not found. A failure in one field never stops the others. Never submits anything.
 */
export async function fillFields(
  root: ParentNode,
  instructions: readonly FillInstruction[],
  {
    customControlTiming = DEFAULT_CUSTOM_CONTROL_TIMING,
    scan = scanControls,
    fillCustom,
  }: FillOptions = {},
): Promise<FillResult[]> {
  const current = new Map(scan(root).map((scanned) => [scanned.field.id, scanned]));
  const results: FillResult[] = [];
  // Sequential: custom dropdowns open popups, which must not overlap.
  for (const instruction of instructions) {
    let outcome: Outcome;
    try {
      outcome = await fillOne(
        current.get(instruction.fieldId),
        instruction,
        customControlTiming,
        fillCustom,
      );
    } catch {
      outcome = failed('Something went wrong while filling this field.');
    }
    results.push({ fieldId: instruction.fieldId, ...outcome });
  }
  return results;
}

async function fillOne(
  target: ScannedField | undefined,
  { value, expected }: FillInstruction,
  timing: CustomControlTiming,
  fillCustom: CustomFiller | undefined,
): Promise<Outcome> {
  if (!target || !matchesExpected(target.field, expected)) {
    return { status: 'not-found', message: 'The field is no longer on the page.' };
  }
  const { field, controls } = target;
  // Re-checked on the page as it is now. A repeated question is filled only when the user
  // assigned this field to a profile record, and only if the repetition is unchanged since
  // Analyze; a question that has become repeated no longer identifies one profile record.
  // An assigned field must still have the identity it had when it was approved.
  if (
    expected.identity &&
    (field.identity?.key !== expected.identity.key ||
      field.identity.unique !== expected.identity.unique)
  ) {
    return skipped('This field is not the one that was assigned. Analyze again.');
  }
  if (expected.repeatedCount !== undefined) {
    if (field.repeatedCount !== expected.repeatedCount) {
      return skipped('The repeated questions on the page changed. Analyze again.');
    }
  } else if ((field.repeatedCount ?? 1) > 1) {
    return skipped('This question now appears more than once on the page. Analyze again.');
  }
  if (!field.visible) return skipped('The field is hidden now.');
  if (field.disabled) return skipped('The field is disabled now.');
  if (field.readOnly) return skipped('The field is read-only.');
  const [control] = controls;
  if (!control) return { status: 'not-found', message: 'The field is no longer on the page.' };

  if (field.custom) {
    if (!field.custom.supported) {
      return unsupported('This dropdown does not expose enough information to fill it safely.');
    }
    const handled = fillCustom?.({ field, control }, value, timing);
    if (handled) return handled;
    // Search-as-you-type inputs need a site-specific filler; the generic engine never types.
    if (field.custom.pattern === 'search-input') {
      return unsupported('Search fields are not supported on this page.');
    }
    return fillCustomSelect(control, value, timing);
  }

  switch (field.type) {
    case 'text':
    case 'email':
    case 'tel':
    case 'number':
    case 'textarea':
      return fillText(control as TextControl, field.type, value);
    case 'select':
      return fillSelect(control as HTMLSelectElement, value);
    case 'checkbox':
      return fillCheckbox(control as HTMLInputElement, value);
    case 'radio':
      return fillRadio(controls as HTMLInputElement[], field.options ?? [], value);
  }
}

/**
 * Same kind of field, with the same name/id (or label, when it has neither), in the same
 * record of a repeated section (so a re-ordered page never fills another record's field).
 */
function matchesExpected(field: FormField, expected: FillInstruction['expected']): boolean {
  const { name, htmlId, label } = field.signals;
  if (field.type !== expected.type || name !== expected.name || htmlId !== expected.htmlId) {
    return false;
  }
  if (
    field.record?.collection !== expected.record?.collection ||
    field.record?.index !== expected.record?.index
  ) {
    return false;
  }
  return name !== undefined || htmlId !== undefined || label === expected.label;
}

function fillText(control: TextControl, type: FormField['type'], value: FillValue): Outcome {
  if (typeof value === 'boolean') return unsupported('A yes/no value cannot go in a text field.');
  const text = String(value);
  if (type === 'number' && !Number.isFinite(Number(text)))
    return failed('The value is not a number.');
  // Never overwrite what the user (or the page) already entered. The existing value is
  // only compared here; it is not read out or reported.
  if (control.value.trim() !== '') return skipped(EXISTING_VALUE);

  setValueWithNativeSetter(control, text);
  notifyChange(control);
  return control.value === text ? filled() : failed('The page did not accept the value.');
}

function fillSelect(select: HTMLSelectElement, value: FillValue): Outcome {
  if (hasSelection(select)) return skipped(EXISTING_VALUE);
  // Never choose options the user cannot choose: disabled, hidden, or empty placeholders.
  const options = Array.from(select.options).filter(
    (option) => !option.disabled && !option.hidden && option.value.trim() !== '',
  );
  const match = findMatchingOption(options, (o) => ({ value: o.value, label: o.text }), value);
  if (match === 'ambiguous') return failed('More than one option matches.');
  if (!match) return failed('No option matches your profile value.');

  if (select.multiple) match.selected = true;
  else select.selectedIndex = match.index;
  notifyChange(select);
  return match.selected ? filled() : failed('The page did not accept the selection.');
}

function fillCheckbox(checkbox: HTMLInputElement, value: FillValue): Outcome {
  const checked = toBoolean(value);
  if (checked === undefined) return failed('The value is not a yes/no value.');
  // A checked box is an existing answer: it is never unchecked. An unchecked box that
  // should stay unchecked needs no change.
  if (checkbox.checked) {
    return checked ? skipped(ALREADY_MATCHES) : skipped(EXISTING_VALUE);
  }
  if (!checked) return skipped(ALREADY_MATCHES);
  // click() toggles the box and fires click/input/change, which is what frameworks
  // listen to for checkboxes and radios.
  checkbox.click();
  return checkbox.checked ? filled() : failed('The page did not accept the change.');
}

function fillRadio(
  radios: HTMLInputElement[],
  options: readonly FieldOption[],
  value: FillValue,
): Outcome {
  const choices = radios
    .map((radio, index) => ({ radio, option: options[index] }))
    .filter(
      (choice): choice is { radio: HTMLInputElement; option: FieldOption } =>
        choice.option !== undefined && !choice.radio.disabled,
    );
  const match = findMatchingOption(choices, (choice) => choice.option, value);
  if (match === 'ambiguous') return failed('More than one option matches.');
  if (!match) return failed('No option matches your profile value.');

  // An already chosen option is an existing answer: never switch it.
  if (match.radio.checked) return skipped(ALREADY_MATCHES);
  if (radios.some((radio) => radio.checked)) return skipped(EXISTING_VALUE);
  match.radio.click();
  return match.radio.checked ? filled() : failed('The page did not accept the selection.');
}

export function toBoolean(value: FillValue): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const text = normalizeText(value);
  if (text === 'yes' || text === 'true') return true;
  if (text === 'no' || text === 'false') return false;
  return undefined;
}

/**
 * Frameworks such as React track an input's value through an instance-level `value`
 * property. Writing through the prototype's native setter bypasses that tracker, so the
 * framework notices the difference when the input event fires and updates its state.
 */
export function setValueWithNativeSetter(control: TextControl, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
}

/** input + change, bubbling: what React, Vue, Angular, and plain listeners observe. */
function notifyChange(control: FormControl) {
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Whether a select already has a chosen value. An empty-valued option (a placeholder) is no
 * value. A non-empty option counts when it is not the first option, or when the page marked
 * it as selected; a select that is simply showing its first option has no choice yet.
 */
function hasSelection(select: HTMLSelectElement): boolean {
  return Array.from(select.options).some(
    (option, index) =>
      option.selected &&
      option.value.trim() !== '' &&
      (index > 0 || option.hasAttribute('selected')),
  );
}
