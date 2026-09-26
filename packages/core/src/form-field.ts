import type { FieldType } from './field-type';

/**
 * A field discovered on a page, described only by its metadata.
 *
 * Adapters produce these; the mapper consumes them. No DOM references live here so the
 * mapping logic stays browser-independent. Values already typed into the page are
 * intentionally not captured.
 */
export interface FormField {
  /** Stable within one page scan; assigned by the adapter that extracted the field. */
  id: string;
  type: FieldType;
  required: boolean;
  signals: FieldSignals;
  /** Choices for select/radio fields. */
  options?: readonly FieldOption[];
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
