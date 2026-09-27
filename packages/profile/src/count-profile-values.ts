import type { Profile } from './profile';

/**
 * Number of values the user has entered (non-blank text, numbers, booleans, list items'
 * values). Metadata such as `schemaVersion`, and legacy data, are not counted. Useful for reporting that a
 * profile exists without exposing any of its values.
 */
export function countProfileValues(profile: Profile): number {
  // Legacy data is kept from older versions but is not part of the usable profile.
  const withoutIds = (records: readonly object[]) =>
    records.map((record) => ({ ...record, id: undefined }));
  return countValues({
    ...profile,
    schemaVersion: undefined,
    legacy: undefined,
    // Record ids identify records; they are not values the user entered.
    education: withoutIds(profile.education),
    workExperience: withoutIds(profile.workExperience),
    certifications: withoutIds(profile.certifications),
  });
}

function countValues(value: unknown): number {
  if (typeof value === 'string') return value.trim() === '' ? 0 : 1;
  if (typeof value === 'number' || typeof value === 'boolean') return 1;
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countValues(item), 0);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).reduce((sum: number, item) => sum + countValues(item), 0);
  }
  return 0;
}
