import {
  isFieldType,
  isProfileTarget,
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

/** Upper bound on any page-derived text (labels, names, ids…), far above real forms. */
export const MAX_TEXT_LENGTH = 10_000;

/** Upper bound on one value sent for filling (a long free-text answer fits easily). */
export const MAX_VALUE_LENGTH = 100_000;

/** Upper bound on a profile target such as "education@<id>.fieldOfStudy". */
const MAX_TARGET_LENGTH = 200;

/** Only these keys may be present (unknown properties are rejected, never ignored). */
export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export const isBoundedText = (value: unknown, max = MAX_TEXT_LENGTH): value is string =>
  typeof value === 'string' && value.length <= max;

/** A canonical profile target (scalar key, record position, or record id), never a path. */
export function isProfileTargetText(value: unknown): value is string {
  return isBoundedText(value, MAX_TARGET_LENGTH) && isProfileTarget(value);
}

const FORM_FIELD_KEYS = [
  'id',
  'type',
  'htmlType',
  'required',
  'visible',
  'disabled',
  'readOnly',
  'groupSize',
  'custom',
  'repeatedCount',
  'record',
  'identity',
  'signals',
  'form',
  'options',
];

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

const isOptionalString = (value: unknown) => value === undefined || isBoundedText(value);

export function isBoundedArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_FIELDS_PER_MESSAGE;
}

export function isFormField(value: unknown): value is FormField {
  if (!isRecord(value)) return false;
  const { id, type, htmlType, required, visible, disabled, readOnly, groupSize } = value;
  const { signals, form, options, custom, repeatedCount, record, identity } = value;
  return (
    hasOnlyKeys(value, FORM_FIELD_KEYS) &&
    isBoundedText(id, 2000) &&
    typeof type === 'string' &&
    isFieldType(type) &&
    isBoundedText(htmlType, 100) &&
    typeof required === 'boolean' &&
    typeof visible === 'boolean' &&
    typeof disabled === 'boolean' &&
    (readOnly === undefined || typeof readOnly === 'boolean') &&
    (groupSize === undefined || (Number.isInteger(groupSize) && (groupSize as number) > 0)) &&
    (repeatedCount === undefined ||
      (Number.isInteger(repeatedCount) && (repeatedCount as number) > 0)) &&
    (record === undefined || isFieldRecord(record)) &&
    (identity === undefined || isFieldIdentity(identity)) &&
    (custom === undefined ||
      (isRecord(custom) &&
        hasOnlyKeys(custom, ['pattern', 'supported']) &&
        typeof custom.pattern === 'string' &&
        CUSTOM_PATTERNS.includes(custom.pattern) &&
        typeof custom.supported === 'boolean')) &&
    isRecord(signals) &&
    hasOnlyKeys(signals, SIGNAL_KEYS) &&
    SIGNAL_KEYS.every((key) => isOptionalString(signals[key])) &&
    (form === undefined ||
      (isRecord(form) &&
        hasOnlyKeys(form, ['id', 'name', 'action']) &&
        ['id', 'name', 'action'].every((key) => isOptionalString(form[key])))) &&
    (options === undefined ||
      (isBoundedArray(options) &&
        options.every(
          (o) =>
            isRecord(o) &&
            hasOnlyKeys(o, ['value', 'label']) &&
            isBoundedText(o.value) &&
            isBoundedText(o.label),
        )))
  );
}

export function isFillInstruction(value: unknown): value is FillInstruction {
  if (!isRecord(value) || !isRecord(value.expected)) return false;
  const { fieldId, value: fillValue, expected } = value;
  return (
    hasOnlyKeys(value, ['fieldId', 'value', 'expected']) &&
    // Fingerprints never go to the page (the service worker checks them): no `identity`.
    hasOnlyKeys(expected, ['type', 'name', 'htmlId', 'label', 'record', 'repeatedCount']) &&
    isBoundedText(fieldId, 2000) &&
    (isBoundedText(fillValue, MAX_VALUE_LENGTH) ||
      (typeof fillValue === 'number' && Number.isFinite(fillValue)) ||
      typeof fillValue === 'boolean') &&
    typeof expected.type === 'string' &&
    isFieldType(expected.type) &&
    ['name', 'htmlId', 'label'].every((key) => isOptionalString(expected[key])) &&
    (expected.record === undefined || isFieldRecord(expected.record)) &&
    (expected.repeatedCount === undefined ||
      (Number.isInteger(expected.repeatedCount) && (expected.repeatedCount as number) > 1))
  );
}

/** A field identity: an "fp-" fingerprint and whether it is unique on the page. */
function isFieldIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['key', 'unique']) &&
    typeof value.key === 'string' &&
    /^fp-[0-9a-f]{16}$/.test(value.key) &&
    typeof value.unique === 'boolean'
  );
}

/** A record position: a known collection and an index within the record limit. */
function isFieldRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['collection', 'index']) &&
    typeof value.collection === 'string' &&
    (PROFILE_RECORD_COLLECTIONS as readonly string[]).includes(value.collection) &&
    Number.isInteger(value.index) &&
    (value.index as number) >= 0 &&
    (value.index as number) < MAX_PROFILE_RECORDS
  );
}

/**
 * The page a record assignment belongs to: origin + path, never credentials, query, or
 * fragment ("https://user:pw@example.com/p?token=x#y" → "https://example.com/p"). Only
 * http(s) pages have one.
 */
export function pageKeyOf(url: string | undefined): string | undefined {
  try {
    const parsed = new URL(url ?? '');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.origin + parsed.pathname;
  } catch {
    return undefined;
  }
}

export function isPageKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && pageKeyOf(value) === value;
}

/** A bare hostname (no scheme, port, or path), e.g. "jobs.example.com". */
export function isHostname(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9.-]{1,253}$/i.test(value);
}

/** Saved mapping keys are short, versioned strings built by field-mapper. */
export function isMappingKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('v1|') && value.length <= 2000;
}
