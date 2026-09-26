import type { FieldType } from './field-type';

/**
 * A field discovered on a page, described only by its metadata.
 *
 * Adapters produce these; the mapper consumes them. No DOM references live here so the
 * mapping logic stays browser-independent. Values already typed into the page are
 * intentionally not captured.
 */
export interface FormField {
  /**
   * Assigned by the adapter that extracted the field. Deterministic for the same page
   * structure, so repeated scans of an unchanged page produce the same ids.
   */
  id: string;
  type: FieldType;
  /** The control's own type, e.g. "url" for an input treated as text, or "select-one". */
  htmlType: string;
  required: boolean;
  visible: boolean;
  disabled: boolean;
  signals: FieldSignals;
  /** The enclosing form, when the field belongs to one. Many pages have none. */
  form?: FormContext;
  /** Choices for select/radio fields. Which choice is selected is never captured. */
  options?: readonly FieldOption[];
}

/** Attributes of the field's form. Each is present only when the page sets it. */
export interface FormContext {
  id?: string;
  name?: string;
  action?: string;
}

/** Raw text signals used to understand what a field means (spec §16). */
export interface FieldSignals {
  name?: string;
  htmlId?: string;
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  autocomplete?: string;
  nearbyText?: string;
}

export interface FieldOption {
  value: string;
  label: string;
}
