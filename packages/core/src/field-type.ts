/**
 * Form field types supported in V1 (spec §15).
 *
 * Deferred until later: date, combobox, custom autocomplete, file upload, rich text,
 * custom widgets. File upload in particular needs its own user-driven flow.
 */
export const FIELD_TYPES = [
  'text',
  'email',
  'tel',
  'number',
  'textarea',
  'select',
  'checkbox',
  'radio',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}
