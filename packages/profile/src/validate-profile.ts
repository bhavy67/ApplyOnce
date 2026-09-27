import { PROFILE_FIELD_KEYS, PROFILE_FIELDS, type ProfileValueKind } from '@applyonce/core';
import { normalizeChoice } from './choices';
import type { Profile } from './profile';
import { readStoredValue } from './profile-values';

/** Error messages keyed by profile path, e.g. "contact.email" or "education.graduationYear". */
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
 * Checks the format of values that are present, using each canonical field's value kind.
 * Blank values are always allowed, so a partially completed profile is valid.
 *
 * This is field validation only. Whether a profile has enough information for a given
 * form (completeness) is a separate concern and never blocks saving.
 */
export function validateProfile(profile: Profile): ProfileValidationResult {
  const errors: Record<string, string> = {};

  for (const key of PROFILE_FIELD_KEYS) {
    const { kind, path } = PROFILE_FIELDS[key];
    const value = readStoredValue(profile, key);
    const error = kind === 'choice' ? validateChoice(key, value) : validateValue(kind, value);
    if (error) errors[path] = error;
  }
  // Not a mappable field, but stored and validated the same way as phone.
  const alternatePhone = validateValue('phone', profile.contact.alternatePhone);
  if (alternatePhone) errors['contact.alternatePhone'] = alternatePhone;

  return { valid: Object.keys(errors).length === 0, errors };
}

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
