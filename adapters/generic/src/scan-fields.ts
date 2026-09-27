import type { FieldOption, FieldSignals, FieldType, FormContext, FormField } from '@applyonce/core';
import {
  ariaLabelledByText,
  attributeText,
  cleanText,
  collectLabelsByFor,
  CONTROL_SELECTOR,
  labelText,
  legendText,
  precedingText,
  wrapperLabelText,
} from './field-text';
import { isVisible } from './visibility';

export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** A detected field and the control(s) it currently corresponds to (several for a radio group). */
export interface ScannedField {
  field: FormField;
  controls: FormControl[];
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
 * options. Only metadata is read: the scanner never reads what the user typed or selected.
 */
export function scanFields(root: ParentNode): FormField[] {
  return scanControls(root).map(({ field }) => field);
}

/**
 * The same scan, keeping element references. Used for filling, where fields are located
 * again by id in the current DOM rather than through references kept since analysis.
 */
export function scanControls(root: ParentNode): ScannedField[] {
  const labelsByFor = collectLabelsByFor(root);
  const checkboxGroupSizes = countCheckboxesByName(root);
  const ids = new Set<string>();
  // Radio groups are keyed by form (null = outside any form), then by name.
  const radioGroups = new Map<HTMLFormElement | null, Map<string, ScannedField>>();
  const scanned: ScannedField[] = [];

  root.querySelectorAll<FormControl>(CONTROL_SELECTOR).forEach((control, index) => {
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
        signals: compact({ name, label: radioGroupLabel(control) }),
      });
      field.options = [option];
      const entry = { field, controls: [control] };
      groupsInForm.set(name, entry);
      scanned.push(entry);
      return;
    }

    const htmlId = control.id || undefined;
    const label =
      labelText(control, labelsByFor) ?? ariaLabelledByText(control) ?? wrapperLabelText(control);
    const ariaLabel = attributeText(control, 'aria-label');
    const nearbyText =
      legendText(control) ?? (label || ariaLabel ? undefined : precedingText(control));

    const field = createField(control, {
      id: claimId(ids, htmlId ? `id:${htmlId}` : name ? `name:${name}` : `index:${index}`),
      type,
      signals: compact({
        name,
        htmlId,
        label,
        ariaLabel,
        placeholder: attributeText(control, 'placeholder'),
        autocomplete: attributeText(control, 'autocomplete'),
        nearbyText,
      }),
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

  return scanned;
}

function createField(
  control: FormControl,
  { id, type, signals }: { id: string; type: FieldType; signals: FieldSignals },
): FormField {
  const field: FormField = {
    id,
    type,
    htmlType: control.type,
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

function isReadOnly(control: FormControl): boolean {
  const readOnly = 'readOnly' in control && control.readOnly;
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

function isRequired(control: FormControl): boolean {
  return control.required || control.getAttribute('aria-required') === 'true';
}

/**
 * Disabled directly, or inside a disabled <fieldset> (except within its first <legend>,
 * per the HTML spec). Written out rather than relying on `:disabled` support.
 */
function isDisabled(control: FormControl): boolean {
  if (control.disabled) return true;
  const fieldset = control.closest('fieldset[disabled]');
  if (!fieldset) return false;
  const firstLegend = Array.from(fieldset.children).find((c) => c.tagName === 'LEGEND');
  return !firstLegend?.contains(control);
}

/** Read with getAttribute: form.id/name/action can be shadowed by controls with those names. */
function formContext(control: FormControl): FormContext | undefined {
  const form = control.form;
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
