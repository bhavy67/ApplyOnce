import { PROFILE_FIELD_KEYS, type FillValue, type ProfileFieldKey } from '@applyonce/core';
import type { Profile } from './profile';

/** Where each mappable profile field lives in the profile. */
export const PROFILE_FIELD_PATHS: Readonly<Record<ProfileFieldKey, string>> = {
  first_name: 'identity.firstName',
  middle_name: 'identity.middleName',
  last_name: 'identity.lastName',
  full_name: 'identity.fullName',
  email: 'contact.email',
  phone: 'contact.phone',
  address: 'location.address',
  city: 'location.city',
  state: 'location.state',
  country: 'location.country',
  postal_code: 'location.postalCode',
  linkedin_url: 'links.linkedin',
  github_url: 'links.github',
  portfolio_url: 'links.portfolio',
  current_company: 'experience.currentCompany',
  current_title: 'experience.currentTitle',
  experience_years: 'experience.totalExperienceYears',
  notice_period: 'experience.noticePeriod',
  work_authorization: 'authorization.workAuthorization',
  requires_sponsorship: 'authorization.requiresSponsorship',
  willing_to_relocate: 'preferences.openToRelocation',
};

export function isProfileFieldKey(value: unknown): value is ProfileFieldKey {
  return typeof value === 'string' && (PROFILE_FIELD_KEYS as readonly string[]).includes(value);
}

/**
 * The value to fill for a profile field, or undefined when the profile has none (blank
 * text counts as none). Unknown keys return undefined rather than throwing.
 *
 * `full_name` falls back to first, middle, and last name when no explicit full name is set.
 */
export function getProfileValue(profile: Profile, key: string): FillValue | undefined {
  if (!isProfileFieldKey(key)) return undefined;
  const value = readProfilePath(profile, PROFILE_FIELD_PATHS[key]);
  if (value !== undefined || key !== 'full_name') return value;

  const { firstName, middleName, lastName } = profile.identity;
  const parts = [firstName, middleName, lastName].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Reads a dotted path such as "location.city". Only own properties are followed and only
 * scalar values are returned, so paths like "__proto__" or ones ending at an object or list
 * yield undefined.
 */
export function readProfilePath(profile: Profile, path: string): FillValue | undefined {
  let current: unknown = profile;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === 'string') return current.trim() === '' ? undefined : current.trim();
  if (typeof current === 'number') return Number.isFinite(current) ? current : undefined;
  if (typeof current === 'boolean') return current;
  return undefined;
}
