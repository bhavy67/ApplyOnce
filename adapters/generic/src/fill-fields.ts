import type {
  FieldOption,
  FillInstruction,
  FillResult,
  FillStatus,
  FillValue,
  FormField,
} from '@applyonce/core';
import { compactText, normalizeText } from '@applyonce/field-mapper';
import { scanControls, type FormControl, type ScannedField } from './scan-fields';

type Outcome = { status: FillStatus; message: string };
type TextControl = HTMLInputElement | HTMLTextAreaElement;

/**
 * Fills approved fields and returns one result per instruction, in order.
 *
 * The page is scanned again first and each field is located by its deterministic id in
 * the current DOM, then checked against the metadata recorded at analysis time. So a
 * re-rendered field is still found, while a removed or different field is reported as
 * not found. A failure in one field never stops the others. Never submits anything.
 */
export function fillFields(
  root: ParentNode,
  instructions: readonly FillInstruction[],
): FillResult[] {
  const current = new Map(scanControls(root).map((scanned) => [scanned.field.id, scanned]));
  return instructions.map((instruction) => {
    let outcome: Outcome;
    try {
      outcome = fillOne(current.get(instruction.fieldId), instruction);
    } catch {
      outcome = failed('Something went wrong while filling this field.');
    }
    return { fieldId: instruction.fieldId, ...outcome };
  });
}

function fillOne(target: ScannedField | undefined, { value, expected }: FillInstruction): Outcome {
  if (!target || !matchesExpected(target.field, expected)) {
    return { status: 'not-found', message: 'The field is no longer on the page.' };
  }
  const { field, controls } = target;
  if (!field.visible) return skipped('The field is hidden now.');
  if (field.disabled) return skipped('The field is disabled now.');

  switch (field.type) {
    case 'text':
    case 'email':
    case 'tel':
    case 'number':
    case 'textarea':
      return fillText(controls[0] as TextControl, field.type, value);
    case 'select':
      return fillSelect(controls[0] as HTMLSelectElement, value);
    case 'checkbox':
      return fillCheckbox(controls[0] as HTMLInputElement, value);
    case 'radio':
      return fillRadio(controls as HTMLInputElement[], field.options ?? [], value);
  }
}

/** Same kind of field, with the same name/id (or label, when it has neither). */
function matchesExpected(field: FormField, expected: FillInstruction['expected']): boolean {
  const { name, htmlId, label } = field.signals;
  if (field.type !== expected.type || name !== expected.name || htmlId !== expected.htmlId) {
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
  if (control.value.trim() !== '') return skipped('The field already has a value.');

  setValueWithNativeSetter(control, text);
  notifyChange(control);
  return control.value === text ? filled() : failed('The page did not accept the value.');
}

function fillSelect(select: HTMLSelectElement, value: FillValue): Outcome {
  const options = Array.from(select.options).filter((option) => !option.disabled);
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
  // click() toggles the box and fires click/input/change, which is what frameworks
  // listen to for checkboxes and radios.
  if (checkbox.checked !== checked) checkbox.click();
  return checkbox.checked === checked ? filled() : failed('The page did not accept the change.');
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

  if (!match.radio.checked) match.radio.click();
  return match.radio.checked ? filled() : failed('The page did not accept the selection.');
}

/**
 * Deterministic option matching, in order of strictness: exact option value, normalized
 * option value, normalized option label, then value or label ignoring spaces and
 * punctuation (so "onsite" matches "On-site" and "fulltime" matches "Full time"). Each
 * stage is whole-text equality, never "contains": "Remote / Hybrid" does not match
 * "remote". The first stage with exactly one match wins; several matches in a stage is
 * ambiguous. No match means nothing is selected.
 */
export function findMatchingOption<T>(
  options: readonly T[],
  describe: (option: T) => { value: string; label: string },
  value: FillValue,
): T | 'ambiguous' | undefined {
  const candidates = candidateTexts(value);
  const normalized = candidates.map(normalizeText).filter(Boolean);
  const compacted = candidates.map(compactText).filter(Boolean);
  const stages: ((option: T) => boolean)[] = [
    (option) => candidates.includes(describe(option).value),
    (option) => normalized.includes(normalizeText(describe(option).value)),
    (option) => normalized.includes(normalizeText(describe(option).label)),
    (option) =>
      compacted.includes(compactText(describe(option).value)) ||
      compacted.includes(compactText(describe(option).label)),
  ];
  for (const stage of stages) {
    const matches = options.filter(stage);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return 'ambiguous';
  }
  return undefined;
}

function candidateTexts(value: FillValue): string[] {
  if (value === true) return ['yes', 'true'];
  if (value === false) return ['no', 'false'];
  return [String(value)];
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
function setValueWithNativeSetter(control: TextControl, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
}

/** input + change, bubbling: what React, Vue, Angular, and plain listeners observe. */
function notifyChange(control: FormControl) {
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

const filled = (): Outcome => ({ status: 'filled', message: 'Filled.' });
const skipped = (message: string): Outcome => ({ status: 'skipped', message });
const failed = (message: string): Outcome => ({ status: 'failed', message });
const unsupported = (message: string): Outcome => ({ status: 'unsupported', message });
