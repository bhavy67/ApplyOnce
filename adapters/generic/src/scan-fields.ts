import type {
  CustomControl,
  FieldOption,
  FieldSignals,
  FieldType,
  FormContext,
  FormField,
} from '@applyonce/core';
import {
  ariaLabelledByText,
  attributeText,
  cleanText,
  collectLabelsByFor,
  CONTROL_SELECTOR,
  CUSTOM_CONTROL_SELECTOR,
  labelText,
  legendText,
  precedingText,
  wrapperLabelText,
} from './field-text';
import { markFieldIdentity } from './field-identity';
import { markRepeatedQuestions } from './repeated-questions';
import { markRepeatedSections } from './repeated-sections';
import { isVisible } from './visibility';

export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * A detected field and the element(s) it currently corresponds to: several for a radio
 * group, the trigger/combobox element for a custom dropdown.
 */
export interface ScannedField {
  field: FormField;
  controls: HTMLElement[];
}

/**
 * Hooks for site adapters, which reuse this scanner. The generic adapter uses none.
 */
export interface ScanOptions {
  /** Controls to leave out entirely, e.g. site navigation chrome. */
  exclude?: (element: HTMLElement) => boolean;
  /**
   * A stable identity for a control (e.g. a site attribute), preferred over generated ids
   * so a re-rendered page still yields the same field id.
   */
  stableIdentity?: (element: HTMLElement) => string | undefined;
  /** Adjusts the finished scan (e.g. merges or marks fields); must stay deterministic. */
  postProcess?: (scanned: ScannedField[]) => ScannedField[];
}

/**
 * Supported controls by their `type` property. Everything else is ignored: password,
 * hidden, file, date/time, color, range, and buttons.
 */
const FIELD_TYPE_BY_HTML_TYPE: Readonly<Record<string, FieldType>> = {
  text: 'text',
  search: 'text',
  url: 'text',
  email: 'email',
  tel: 'tel',
  number: 'number',
  textarea: 'textarea',
  'select-one': 'select',
  'select-multiple': 'select',
  checkbox: 'checkbox',
  radio: 'radio',
};

/**
 * One pass over the standard form controls under `root`, in document order.
 *
 * Works at page level: fields do not need a <form>, and form context is attached when
 * present. Radio buttons sharing a name (within the same form) become one field with
 * options. Custom dropdowns (ARIA comboboxes, listbox popup buttons) become one "select"
 * field each; their inner inputs and options are not separate fields. Controls marked
 * aria-hidden="true" are skipped: they are not presented to users. Only metadata is read:
 * the scanner never reads what the user typed or selected.
 */
export function scanFields(root: ParentNode, options?: ScanOptions): FormField[] {
  return scanControls(root, options).map(({ field }) => field);
}

/**
 * The same scan, keeping element references. Used for filling, where fields are located
 * again by id in the current DOM rather than through references kept since analysis.
 */
export function scanControls(root: ParentNode, options: ScanOptions = {}): ScannedField[] {
  const labelsByFor = collectLabelsByFor(root);
  const checkboxGroupSizes = countCheckboxesByName(root);
  const ids = new Set<string>();
  // Radio groups are keyed by form (null = outside any form), then by name.
  const radioGroups = new Map<HTMLFormElement | null, Map<string, ScannedField>>();
  const scanned: ScannedField[] = [];

  root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR).forEach((element, index) => {
    if (element.getAttribute('aria-hidden') === 'true') return;
    if (options.exclude?.(element)) return;
    // Part of a custom dropdown (e.g. its search input): the widget is the field.
    if (element.parentElement?.closest(CUSTOM_CONTROL_SELECTOR)) return;

    const custom = customControl(element);
    if (custom) {
      scanned.push({ field: customField(element, custom, index), controls: [element] });
      return;
    }

    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) return;
    const control = element as FormControl;
    const type = FIELD_TYPE_BY_HTML_TYPE[control.type];
    if (!type) return;

    const name = attributeText(control, 'name');

    if (control.type === 'radio' && name) {
      const groupsInForm = radioGroups.get(control.form) ?? new Map<string, ScannedField>();
      radioGroups.set(control.form, groupsInForm);
      const option = radioOption(control, labelsByFor);
      const group = groupsInForm.get(name);
      if (group) {
        const { field } = group;
        field.options = [...(field.options ?? []), option];
        field.visible ||= isVisible(control);
        field.disabled &&= isDisabled(control);
        field.required ||= isRequired(control);
        group.controls.push(control);
        return;
      }
      const field = createField(control, {
        id: claimId(ids, `radio:${name}`),
        type,
        htmlType: control.type,
        signals: compact({ name, label: radioGroupLabel(control) }),
      });
      field.options = [option];
      const entry = { field, controls: [control] };
      groupsInForm.set(name, entry);
      scanned.push(entry);
      return;
    }

    const field = createField(control, {
      id: fieldId(control, index),
      type,
      htmlType: control.type,
      signals: questionSignals(control),
    });
    if (type === 'select') {
      field.options = Array.from((control as HTMLSelectElement).options, (option) => ({
        value: option.value,
        label: cleanText(option.text) ?? option.value,
      }));
    } else if (type === 'radio') {
      field.options = [radioOption(control, labelsByFor)];
    } else if (type === 'checkbox' && name) {
      const groupSize = checkboxGroupSizes.get(control.form)?.get(name) ?? 1;
      if (groupSize > 1) field.groupSize = groupSize;
    }
    scanned.push({ field, controls: [control] });
  });

  // Record sections first (their fields have record context), then site adjustments, then
  // questions still asked more than once without record context.
  markRepeatedSections(scanned);
  const adjusted = markRepeatedQuestions(
    options.postProcess ? options.postProcess(scanned) : scanned,
  );
  return markFieldIdentity(adjusted, options.stableIdentity);

  function fieldId(element: HTMLElement, index: number): string {
    const stable = options.stableIdentity?.(element);
    if (stable) return claimId(ids, `key:${stable}`);
    const htmlId = element.id || undefined;
    const name = attributeText(element, 'name');
    return claimId(ids, htmlId ? `id:${htmlId}` : name ? `name:${name}` : `index:${index}`);
  }

  /** The question signals shared by native and custom controls. */
  function questionSignals(element: HTMLElement): FieldSignals {
    const label =
      labelText(element, labelsByFor) ?? ariaLabelledByText(element) ?? wrapperLabelText(element);
    const ariaLabel = attributeText(element, 'aria-label');
    return compact({
      name: attributeText(element, 'name'),
      htmlId: element.id || undefined,
      label,
      ariaLabel,
      placeholder: attributeText(element, 'placeholder'),
      autocomplete: attributeText(element, 'autocomplete'),
      nearbyText: legendText(element) ?? (label || ariaLabel ? undefined : precedingText(element)),
    });
  }

  function customField(element: HTMLElement, custom: CustomControl, index: number): FormField {
    const field = createField(element, {
      id: fieldId(element, index),
      type: 'select',
      htmlType: custom.pattern === 'listbox-button' ? 'listbox-button' : 'combobox',
      signals: questionSignals(element),
    });
    field.custom = custom;
    return field;
  }
}

/**
 * A custom single-select control: an explicit role="combobox" (not a native select) or an
 * aria-haspopup="listbox" trigger. It is operable only if it declares its popup relationship
 * (aria-controls, aria-owns, or aria-expanded); class names are never used for detection.
 */
function customControl(element: HTMLElement): CustomControl | undefined {
  if (element.tagName === 'SELECT') return undefined;
  const isCombobox = element.getAttribute('role') === 'combobox';
  if (!isCombobox && element.getAttribute('aria-haspopup') !== 'listbox') return undefined;
  const pattern =
    element.tagName === 'INPUT' ? 'input-combobox' : isCombobox ? 'combobox' : 'listbox-button';
  const supported = ['aria-controls', 'aria-owns', 'aria-expanded'].some((name) =>
    element.hasAttribute(name),
  );
  return { pattern, supported };
}

function createField(
  control: HTMLElement,
  {
    id,
    type,
    htmlType,
    signals,
  }: { id: string; type: FieldType; htmlType: string; signals: FieldSignals },
): FormField {
  const field: FormField = {
    id,
    type,
    htmlType,
    required: isRequired(control),
    visible: isVisible(control),
    disabled: isDisabled(control),
    signals,
  };
  if (isReadOnly(control)) field.readOnly = true;
  const form = formContext(control);
  if (form) field.form = form;
  return field;
}

function isReadOnly(control: HTMLElement): boolean {
  const readOnly = 'readOnly' in control && control.readOnly === true;
  return readOnly || control.getAttribute('aria-readonly') === 'true';
}

/** Checkboxes per form (null = outside any form) and name; more than one is a group. */
function countCheckboxesByName(root: ParentNode): Map<HTMLFormElement | null, Map<string, number>> {
  const counts = new Map<HTMLFormElement | null, Map<string, number>>();
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((checkbox) => {
    const name = attributeText(checkbox, 'name');
    if (!name) return;
    const inForm = counts.get(checkbox.form) ?? new Map<string, number>();
    inForm.set(name, (inForm.get(name) ?? 0) + 1);
    counts.set(checkbox.form, inForm);
  });
  return counts;
}

function isRequired(control: HTMLElement): boolean {
  const required = 'required' in control && control.required === true;
  return required || control.getAttribute('aria-required') === 'true';
}

/**
 * Disabled directly, or inside a disabled <fieldset> (except within its first <legend>,
 * per the HTML spec), or aria-disabled="true". Written out rather than relying on
 * `:disabled` support.
 */
function isDisabled(control: HTMLElement): boolean {
  if ('disabled' in control && control.disabled === true) return true;
  if (control.getAttribute('aria-disabled') === 'true') return true;
  const fieldset = control.closest('fieldset[disabled]');
  if (!fieldset) return false;
  const firstLegend = Array.from(fieldset.children).find((c) => c.tagName === 'LEGEND');
  return !firstLegend?.contains(control);
}

/** Read with getAttribute: form.id/name/action can be shadowed by controls with those names. */
function formContext(control: HTMLElement): FormContext | undefined {
  const form =
    'form' in control && control.form instanceof HTMLFormElement
      ? control.form
      : control.closest('form');
  if (!form) return undefined;
  const context = compact({
    id: attributeText(form, 'id'),
    name: attributeText(form, 'name'),
    action: attributeText(form, 'action'),
  });
  return Object.keys(context).length > 0 ? context : undefined;
}

function radioOption(control: FormControl, labelsByFor: Map<string, Element[]>): FieldOption {
  // The value attribute is page markup, not user input.
  const value = control.getAttribute('value') ?? 'on';
  return { value, label: labelText(control, labelsByFor) ?? value };
}

/** The question a radio group answers: fieldset legend, radiogroup label, or preceding text. */
function radioGroupLabel(firstRadio: Element): string | undefined {
  const group = firstRadio.closest('[role="radiogroup"]');
  return (
    legendText(firstRadio) ??
    (group ? (attributeText(group, 'aria-label') ?? ariaLabelledByText(group)) : undefined) ??
    precedingText(firstRadio.closest('label') ?? firstRadio)
  );
}

function claimId(used: Set<string>, base: string): string {
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}~${n}`;
  used.add(id);
  return id;
}

/** Drops undefined properties so results contain only what the page actually provides. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
