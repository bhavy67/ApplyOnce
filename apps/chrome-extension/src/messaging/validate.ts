import {
  isFieldType,
  MAX_PROFILE_RECORDS,
  PROFILE_RECORD_COLLECTIONS,
  type FillInstruction,
  type FormField,
} from '@applyonce/core';

/**
 * Structural checks for message payloads. Messages only come from this extension, but a
 * content script shares a process with the web page, so payloads are never trusted blindly.
 */

/** Upper bound on fields per message, far above any real form. */
export const MAX_FIELDS_PER_MESSAGE = 2000;

const CUSTOM_PATTERNS = ['input-combobox', 'combobox', 'listbox-button', 'search-input'];

const SIGNAL_KEYS = [
  'name',
  'htmlId',
  'label',
  'ariaLabel',
  'placeholder',
  'autocomplete',
  'nearbyText',
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';

export function isBoundedArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_FIELDS_PER_MESSAGE;
}

export function isFormField(value: unknown): value is FormField {
  if (!isRecord(value)) return false;
  const { id, type, htmlType, required, visible, disabled, readOnly, groupSize } = value;
  const { signals, form, options, custom, repeatedCount, record } = value;
  return (
    typeof id === 'string' &&
    typeof type === 'string' &&
    isFieldType(type) &&
    typeof htmlType === 'string' &&
    typeof required === 'boolean' &&
    typeof visible === 'boolean' &&
    typeof disabled === 'boolean' &&
    (readOnly === undefined || typeof readOnly === 'boolean') &&
    (groupSize === undefined || (Number.isInteger(groupSize) && (groupSize as number) > 0)) &&
    (repeatedCount === undefined ||
      (Number.isInteger(repeatedCount) && (repeatedCount as number) > 0)) &&
    (record === undefined || isFieldRecord(record)) &&
    (custom === undefined ||
      (isRecord(custom) &&
        typeof custom.pattern === 'string' &&
        CUSTOM_PATTERNS.includes(custom.pattern) &&
        typeof custom.supported === 'boolean')) &&
    isRecord(signals) &&
    SIGNAL_KEYS.every((key) => isOptionalString(signals[key])) &&
    (form === undefined ||
      (isRecord(form) && ['id', 'name', 'action'].every((key) => isOptionalString(form[key])))) &&
    (options === undefined ||
      (isBoundedArray(options) &&
        options.every(
          (o) => isRecord(o) && typeof o.value === 'string' && typeof o.label === 'string',
        )))
  );
}

export function isFillInstruction(value: unknown): value is FillInstruction {
  if (!isRecord(value) || !isRecord(value.expected)) return false;
  const { fieldId, value: fillValue, expected } = value;
  return (
    typeof fieldId === 'string' &&
    ['string', 'number', 'boolean'].includes(typeof fillValue) &&
    typeof expected.type === 'string' &&
    isFieldType(expected.type) &&
    ['name', 'htmlId', 'label'].every((key) => isOptionalString(expected[key])) &&
    (expected.record === undefined || isFieldRecord(expected.record))
  );
}

/** A record position: a known collection and an index within the record limit. */
function isFieldRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.collection === 'string' &&
    (PROFILE_RECORD_COLLECTIONS as readonly string[]).includes(value.collection) &&
    Number.isInteger(value.index) &&
    (value.index as number) >= 0 &&
    (value.index as number) < MAX_PROFILE_RECORDS
  );
}

/** A bare hostname (no scheme, port, or path), e.g. "jobs.example.com". */
export function isHostname(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9.-]{1,253}$/i.test(value);
}

/** Saved mapping keys are short, versioned strings built by field-mapper. */
export function isMappingKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('v1|') && value.length <= 2000;
}
