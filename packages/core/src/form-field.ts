import type { FieldType } from './field-type';
import type { ProfileRecordCollection } from './profile-field';

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
  /** Set when the control is read-only; such fields are never filled. */
  readOnly?: boolean;
  /**
   * For checkboxes: how many checkboxes share this one's name in the same form, when more
   * than one. Such a group is a multi-option question, which a scalar profile value cannot
   * answer, so it is never filled.
   */
  groupSize?: number;
  /**
   * Set for custom (non-native) single-select controls, i.e. ARIA comboboxes and
   * listbox popup buttons. Such fields have type "select"; only filling differs.
   */
  custom?: CustomControl;
  /**
   * Set by adapters that recognise repeated record sections (e.g. several work-experience
   * blocks): how many fields on the page ask this same question. A scalar profile value
   * cannot answer each of them, so such fields are never filled.
   */
  repeatedCount?: number;
  /**
   * Set when the field sits in one record of a repeated application section, e.g. the
   * second of several "Education" blocks: the kind of record and its position (0-based)
   * among those blocks on the page. Such fields map only to that record's fields.
   */
  record?: FormFieldRecord;
  /**
   * The field's semantic identity on this page (see FieldIdentity). Set by the scanner;
   * used to keep explicit record assignments on the right field.
   */
  identity?: FieldIdentity;
  signals: FieldSignals;
  /** The enclosing form, when the field belongs to one. Many pages have none. */
  form?: FormContext;
  /** Choices for select/radio fields. Which choice is selected is never captured. */
  options?: readonly FieldOption[];
}

/**
 * A deterministic fingerprint of a field's semantic metadata (form, fieldset legend, labeled
 * container, question, control type, stable name/id, autocomplete, platform key): never its
 * position, value, classes, or surrounding page text. `unique` is false when another field
 * on the page has the same fingerprint: then neither has a stable identity.
 */
export interface FieldIdentity {
  /** "fp-" + 16 hex digits. Opaque; never shown to the user or written to the page. */
  key: string;
  unique: boolean;
}

export interface FormFieldRecord {
  collection: ProfileRecordCollection;
  index: number;
}

export interface CustomControl {
  /**
   * - input-combobox: `<input role="combobox">`
   * - combobox: another element with role="combobox"
   * - listbox-button: an element with aria-haspopup="listbox"
   * - search-input: a text input whose value must be chosen from typed-search suggestions
   *   (aria-autocomplete); never supported for filling
   */
  pattern: 'input-combobox' | 'combobox' | 'listbox-button' | 'search-input';
  /**
   * Whether the control declares a popup relationship (aria-controls, aria-owns, or
   * aria-expanded). Unsupported controls are reported but never operated.
   */
  supported: boolean;
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
