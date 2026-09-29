import type {
  FieldOption,
  FillInstruction,
  FillResult,
  FillStatus,
  FillValue,
  FormField,
} from '@applyonce/core';
import { normalizeQuestion, normalizeText } from '@applyonce/field-mapper';
import {
  DEFAULT_CUSTOM_CONTROL_TIMING,
  fillCustomSelect,
  isNavigationAction,
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
import { isGeneratedId } from './field-identity';
import { guardPage, PAGE_ACTION_BLOCKED } from './page-guard';
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

/**
 * A site adapter's control-specific filler. It is called only after every generic check
 * has passed for an approved field (found again, same field, visible, enabled, writable,
 * not repeated, not a navigation or submit button), receives only that field, its control,
 * and the one approved value, and runs inside the same page guard and failure isolation.
 * Its outcome is normalized to a standard result. It is not a second security boundary:
 * it cannot see the profile, other fields, or approvals.
 */
export type CustomFiller = (
  target: { field: FormField; control: HTMLElement },
  value: FillValue,
  timing: CustomControlTiming,
) => Promise<Outcome> | undefined;

/**
 * Fills approved fields one at a time and resolves to one result per instruction, in
 * order.
 *
 * The page is scanned again right before each field (Phase 17; earlier fields' dropdowns can
 * take seconds), and the field is located by its deterministic id in the current DOM, then
 * checked against the metadata recorded at analysis time, with nothing awaited between the
 * checks and the first interaction. So a
 * re-rendered field is still found, while a removed or different field is reported as
 * not found. A failure in one field never stops the others. Never submits anything: while
 * filling, the page guard cancels any submission or navigation, and the field being filled
 * is reported as failed.
 *
 * If the page can no longer be scanned with the adapter's rules, nothing is filled and
 * every field is reported as unsupported.
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
  const scanNow = (): Map<string, ScannedField> | undefined => {
    try {
      return new Map(scan(root).map((entry) => [entry.field.id, entry]));
    } catch {
      return undefined;
    }
  };
  const initial = scanNow();
  if (!initial) {
    return instructions.map(({ fieldId }) => ({ fieldId, ...unsupported(UNREADABLE_PAGE) }));
  }
  const results: FillResult[] = [];
  const guard = guardPage(root);
  try {
    // Sequential: custom dropdowns open popups, which must not overlap.
    for (const instruction of instructions) {
      guard.reset();
      // Phase 17: scanned again right before each field, so every check below sees the page
      // as it is now, not as it was before earlier fields (whose dropdowns can take seconds).
      const current = scanNow();
      let outcome: Outcome;
      try {
        outcome = current
          ? normalizeOutcome(
              await fillOne(
                locate(instruction.fieldId, current, initial),
                instruction,
                customControlTiming,
                fillCustom,
              ),
              instruction.value,
            )
          : unsupported(UNREADABLE_PAGE);
      } catch {
        outcome = failed(SOMETHING_WENT_WRONG);
      }
      if (guard.tripped()) outcome = failed(PAGE_ACTION_BLOCKED);
      results.push({ fieldId: instruction.fieldId, ...outcome });
    }
  } finally {
    guard.release();
  }
  return results;
}

/**
 * The field as it is now. Normally found by its id in the fresh scan. Frameworks that
 * generate element ids (e.g. Vue's "v-12", React's "_r_3_") can change a field's id on every
 * render, including renders caused by filling an earlier field, and may even replace the
 * element. Then the field is found again only if its id at the start of this fill was a
 * generated one and exactly one current field has the same unique identity (which ignores
 * generated ids: same question, section, form, name, type…). All other checks then run on
 * that current field's metadata. Anything else is "not found".
 */
function locate(
  fieldId: string,
  current: Map<string, ScannedField>,
  initial: Map<string, ScannedField>,
): ScannedField | undefined {
  const found = current.get(fieldId);
  if (found) return found;
  const earlier = initial.get(fieldId);
  const { htmlId } = earlier?.field.signals ?? {};
  const identity = earlier?.field.identity;
  if (!earlier || !htmlId || !isGeneratedId(htmlId) || identity?.unique !== true) return undefined;
  const same = [...current.values()].filter(
    (entry) => entry.field.identity?.key === identity.key && entry.field.identity.unique,
  );
  const [match] = same;
  if (same.length !== 1 || !match) return undefined;
  return {
    ...match,
    field: { ...match.field, id: fieldId, signals: { ...match.field.signals, htmlId } },
  };
}

const SOMETHING_WENT_WRONG = 'Something went wrong while filling this field.';
const UNREADABLE_PAGE = 'ApplyOnce cannot read this page safely now. Analyze it again.';
const FILL_STATUSES: ReadonlySet<string> = new Set<FillStatus>([
  'filled',
  'skipped',
  'failed',
  'not-found',
  'unsupported',
]);

/**
 * Every outcome, including a site adapter's, becomes a standard result: a known status and
 * a short message that never repeats the value being filled.
 */
function normalizeOutcome(outcome: unknown, value: FillValue): Outcome {
  if (
    typeof outcome !== 'object' ||
    outcome === null ||
    !FILL_STATUSES.has((outcome as Outcome).status) ||
    typeof (outcome as Outcome).message !== 'string'
  ) {
    return failed(SOMETHING_WENT_WRONG);
  }
  const { status, message } = outcome as Outcome;
  const text = String(value);
  if (typeof value !== 'boolean' && text.length >= 3 && message.includes(text)) {
    return { status, message: status === 'filled' ? 'Filled.' : SOMETHING_WENT_WRONG };
  }
  return { status, message };
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
  if (!sameQuestion(field, expected)) {
    return skipped('The question on the page changed. Analyze the page again.');
  }
  // Re-checked on the page as it is now. A repeated question is filled only when the user
  // assigned this field to a profile record, and only if the repetition is unchanged since
  // Analyze; a question that has become repeated no longer identifies one profile record.
  // (The field's identity was checked against a fresh scan by the service worker before
  // the instruction was sent; fingerprints are never sent to the page.)
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
  if (!control?.isConnected) {
    return { status: 'not-found', message: 'The field is no longer on the page.' };
  }

  if (field.custom) {
    // Never operate a control that is itself a navigation or submit action, whichever
    // filler would handle it.
    if (isNavigationAction(control)) {
      return failed('The control is a navigation or submit button, so it was not clicked.');
    }
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

/** The field still asks the question it asked at Analyze (ignoring case, spacing, markers). */
function sameQuestion(field: FormField, expected: FillInstruction['expected']): boolean {
  return normalizeQuestion(field.signals.label ?? '') === normalizeQuestion(expected.label ?? '');
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
  return control.value === text || sameReformattedPhone(type, control.value, text)
    ? filled()
    : failed('The page did not accept the value.');
}

/**
 * Phone inputs often reformat what is entered ("+1 555 010 0199" → "+1 555-010-0199"). That
 * is still the approved number when exactly the same digits remain, in the same order.
 */
function sameReformattedPhone(type: FormField['type'], shown: string, text: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, '');
  return type === 'tel' && digits(text) !== '' && digits(shown) === digits(text);
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
