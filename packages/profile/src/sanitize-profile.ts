import { PROFILE_FIELD_KEYS, PROFILE_FIELDS } from '@applyonce/core';
import { normalizeChoice } from './choices';
import type { Profile } from './profile';
import { isBlankRecord, readStoredValue, updateProfileValue } from './profile-values';

/**
 * Prepares an edited profile for storage: trims text, treats blank text as "not
 * provided" (the property is removed), stores choice fields in their canonical form
 * ("Full Time" → "full-time"), and drops records (education, work experience,
 * certifications) left completely empty. Partially filled records are kept as they are.
 */
export function sanitizeProfile(profile: Profile): Profile {
  // Safe cast: sanitizeValue preserves the shape; it only removes blank optional values.
  let clean = sanitizeValue(profile) as Profile;
  for (const key of PROFILE_FIELD_KEYS) {
    if (PROFILE_FIELDS[key].kind !== 'choice') continue;
    const value = readStoredValue(clean, key);
    const canonical = normalizeChoice(key, value);
    if (value !== undefined && canonical !== undefined) {
      clean = updateProfileValue(clean, key, canonical);
    }
  }
  return {
    ...clean,
    education: clean.education.filter((record) => !isBlankRecord(record)),
    workExperience: clean.workExperience.filter((record) => !isBlankRecord(record)),
    certifications: clean.certifications.filter((record) => !isBlankRecord(record)),
  };
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? undefined : text;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((item) => item !== undefined);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, sanitizeValue(item)] as const)
        .filter(([, item]) => item !== undefined),
    );
  }
  return value;
}
