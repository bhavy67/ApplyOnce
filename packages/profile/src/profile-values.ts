import {
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  type FillValue,
  type ProfileFieldKey,
} from '@applyonce/core';
import type { Profile } from './profile';

/** A value as stored in the profile (what the editor shows), before fill normalization. */
export type StoredProfileValue = string | number | boolean;

export function isProfileFieldKey(value: unknown): value is ProfileFieldKey {
  return typeof value === 'string' && (PROFILE_FIELD_KEYS as readonly string[]).includes(value);
}

/**
 * The value to fill for a profile field, or undefined when the profile has none (blank
 * text counts as none). Unknown keys return undefined rather than throwing. Paths come only
 * from the canonical definitions, never from the caller.
 *
 * `full_name` falls back to first, middle, and last name when no explicit full name is set.
 */
export function getProfileValue(profile: Profile, key: string): FillValue | undefined {
  if (!isProfileFieldKey(key)) return undefined;
  const value = readProfilePath(profile, PROFILE_FIELDS[key].path);
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
  const value = readRaw(profile, path);
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return undefined;
}

/** The stored value exactly as entered (no trimming), for the profile editor. */
export function readStoredValue(
  profile: Profile,
  key: ProfileFieldKey,
): StoredProfileValue | undefined {
  const value = readRaw(profile, PROFILE_FIELDS[key].path);
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

/**
 * A copy of the profile with one canonical field set (undefined removes it). Only
 * canonical keys are accepted, so arbitrary paths can never be written.
 */
export function updateProfileValue(
  profile: Profile,
  key: ProfileFieldKey,
  value: StoredProfileValue | undefined,
): Profile {
  const [section, property] = splitPath(PROFILE_FIELDS[key].path);
  const current = profile[section] as unknown as Record<string, unknown>;
  const others = Object.entries(current).filter(([name]) => name !== property);
  const next = Object.fromEntries(value === undefined ? others : [...others, [property, value]]);
  return { ...profile, [section]: next };
}

type ProfileSectionKey = keyof Omit<Profile, 'schemaVersion'>;

function splitPath(path: string): [ProfileSectionKey, string] {
  const [section, property, ...rest] = path.split('.');
  if (!section || !property || rest.length > 0) throw new Error('Invalid canonical path');
  return [section as ProfileSectionKey, property];
}

function readRaw(profile: Profile, path: string): unknown {
  let current: unknown = profile;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
