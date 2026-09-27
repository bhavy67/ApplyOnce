import {
  MAX_PROFILE_RECORDS,
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  PROFILE_RECORD_COLLECTIONS,
  recordFieldsOf,
  type ProfileValueKind,
} from '@applyonce/core';
import { normalizeChoice } from './choices';
import type { Profile } from './profile';
import { readStoredValue } from './profile-values';

/**
 * Error messages keyed by profile path, e.g. "contact.email" or
 * "education[1].graduationYear"; a collection over the record limit is keyed by its name.
 */
export type ProfileFieldErrors = Readonly<Record<string, string>>;

export interface ProfileValidationResult {
  valid: boolean;
  errors: ProfileFieldErrors;
}

export const MAX_EXPERIENCE_YEARS = 70;
export const MIN_GRADUATION_YEAR = 1950;
/** Allows expected graduation dates for people still studying. */
const MAX_YEARS_UNTIL_GRADUATION = 10;

/**
 * Checks the format of values that are present, using each canonical field's value kind,
 * for scalar fields and for every field of every record. Blank values are always allowed,
 * so a partially completed profile (or record) is valid.
 *
 * This is field validation only. Whether a profile has enough information for a given
 * form (completeness) is a separate concern and never blocks saving.
 */
export function validateProfile(profile: Profile): ProfileValidationResult {
  const errors: Record<string, string> = {};

  for (const key of PROFILE_FIELD_KEYS) {
    const { kind, path, record } = PROFILE_FIELDS[key];
    // Primary-record fields are validated with their record below, under the same path.
    if (record) continue;
    const value = readStoredValue(profile, key);
    const error = kind === 'choice' ? validateChoice(key, value) : validateValue(kind, value);
    if (error) errors[path] = error;
  }
  // Not a mappable field, but stored and validated the same way as phone.
  const alternatePhone = validateValue('phone', profile.contact.alternatePhone);
  if (alternatePhone) errors['contact.alternatePhone'] = alternatePhone;

  for (const collection of PROFILE_RECORD_COLLECTIONS) {
    const records = profile[collection] as unknown as readonly Record<string, unknown>[];
    if (records.length > MAX_PROFILE_RECORDS) {
      errors[collection] = `Keep at most ${MAX_PROFILE_RECORDS} entries.`;
    }
    records.forEach((record, index) => {
      for (const { field, kind } of recordFieldsOf(collection)) {
        const error = validateValue(kind, record[field]);
        if (error) errors[`${collection}[${index}].${field}`] = error;
      }
    });
  }
  profile.workExperience.forEach((entry, index) => {
    const path = `workExperience[${index}].endDate`;
    if (entry.current === true && entry.endDate?.trim() && !errors[path]) {
      errors[path] = 'Leave the end date blank for a role you currently have.';
    }
  });

  return { valid: Object.keys(errors).length === 0, errors };
}

/** "YYYY-MM" or "YYYY-MM-DD"; checked as text, never parsed into a date. */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARACTERS = /^\+?[\d\s().-]+$/;
/** http(s) scheme optional: people often type "github.com/name". */
const URL_PATTERN =
  /^(https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d{1,5})?([/?#]\S*)?$/i;

function validateValue(kind: ProfileValueKind, value: unknown): string | undefined {
  if (value === undefined || (typeof value === 'string' && value.trim() === '')) return undefined;

  switch (kind) {
    case 'text':
      return typeof value === 'string' ? undefined : 'Enter text.';
    case 'email':
      return typeof value === 'string' && EMAIL_PATTERN.test(value.trim())
        ? undefined
        : 'Enter a valid email address.';
    case 'phone': {
      const text = typeof value === 'string' ? value.trim() : '';
      const digitCount = text.replace(/\D/g, '').length;
      // E.164 allows at most 15 digits; fewer than 7 is not a usable phone number.
      return PHONE_CHARACTERS.test(text) && digitCount >= 7 && digitCount <= 15
        ? undefined
        : 'Enter a valid phone number.';
    }
    case 'url':
      return typeof value === 'string' && URL_PATTERN.test(value.trim())
        ? undefined
        : 'Enter a valid URL, e.g. https://example.com.';
    case 'years':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.';
      if (value < 0) return 'Years of experience cannot be negative.';
      if (value > MAX_EXPERIENCE_YEARS) return `Enter at most ${MAX_EXPERIENCE_YEARS} years.`;
      return undefined;
    case 'year': {
      const maxYear = new Date().getFullYear() + MAX_YEARS_UNTIL_GRADUATION;
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= MIN_GRADUATION_YEAR &&
        value <= maxYear
        ? undefined
        : `Enter a year between ${MIN_GRADUATION_YEAR} and ${maxYear}.`;
    }
    case 'month': {
      const year = Number(MONTH_PATTERN.exec(typeof value === 'string' ? value.trim() : '')?.[1]);
      const maxYear = new Date().getFullYear() + MAX_YEARS_UNTIL_GRADUATION;
      return year >= MIN_GRADUATION_YEAR && year <= maxYear
        ? undefined
        : 'Enter a month as YYYY-MM, e.g. 2021-06.';
    }
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'Choose yes or no.';
    case 'choice':
      return undefined;
  }
}

function validateChoice(
  key: Parameters<typeof normalizeChoice>[0],
  value: unknown,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  return normalizeChoice(key, value) === undefined ? 'Choose one of the options.' : undefined;
}
