import { PROFILE_FIELD_KEYS, PROFILE_FIELDS, type ProfileFieldKey } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import {
  createEmptyProfile,
  getProfileValue,
  isProfileFieldKey,
  readProfilePath,
  readStoredValue,
  updateProfileValue,
  type Profile,
  type StoredProfileValue,
} from './index';

const profile: Profile = {
  ...createEmptyProfile(),
  identity: { firstName: 'Jane', middleName: 'Q', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '   ' },
  location: { city: 'Springfield', country: 'Canada' },
  links: { website: 'https://jane.example.com' },
  experience: {
    currentTitle: 'Software Engineer',
    currentCompany: 'Example Co',
    totalExperienceYears: 4.5,
    workHistory: [],
  },
  preferences: { workMode: 'hybrid', employmentType: 'full-time', openToRelocation: true },
  education: {
    degree: 'BSc',
    fieldOfStudy: 'Physics',
    institution: 'Example University',
    graduationYear: 2019,
  },
  authorization: { requiresSponsorship: false },
};

describe('getProfileValue', () => {
  it.each([
    ['first_name', 'Jane'],
    ['email', 'jane.doe@example.com'],
    ['city', 'Springfield'],
    ['website_url', 'https://jane.example.com'],
    ['current_title', 'Software Engineer'],
    ['current_company', 'Example Co'],
    ['experience_years', 4.5],
    ['work_mode', 'hybrid'],
    ['employment_type', 'full-time'],
    ['willing_to_relocate', true],
    ['highest_degree', 'BSc'],
    ['field_of_study', 'Physics'],
    ['institution', 'Example University'],
    ['graduation_year', 2019],
    ['requires_sponsorship', false],
  ] as const)('%s → %j', (key, value) => {
    expect(getProfileValue(profile, key)).toBe(value);
  });

  it('returns undefined for missing or blank values', () => {
    expect(getProfileValue(profile, 'postal_code')).toBeUndefined();
    expect(getProfileValue(profile, 'phone')).toBeUndefined();
    for (const key of PROFILE_FIELD_KEYS) {
      expect(getProfileValue(createEmptyProfile(), key)).toBeUndefined();
    }
  });

  it('derives the full name when no explicit full name is saved', () => {
    expect(getProfileValue(profile, 'full_name')).toBe('Jane Q Doe');
    const explicit = { ...profile, identity: { ...profile.identity, fullName: 'J. Doe' } };
    expect(getProfileValue(explicit, 'full_name')).toBe('J. Doe');
  });

  it.each(['firstName', 'identity.firstName', 'education.degree', '__proto__', 'constructor', ''])(
    'returns undefined for unknown key or raw path %j',
    (key) => {
      expect(getProfileValue(profile, key)).toBeUndefined();
    },
  );

  it('never returns legacy data', () => {
    const withLegacy = {
      ...createEmptyProfile(),
      legacy: { education: [{ institution: 'Old U' }] },
    };
    expect(getProfileValue(withLegacy, 'institution')).toBeUndefined();
  });
});

describe('canonical paths', () => {
  const samples: Record<string, StoredProfileValue> = {
    text: 'x',
    email: 'a@example.com',
    phone: '+1 555 010 0199',
    url: 'https://example.com',
    years: 3,
    year: 2020,
    boolean: true,
    choice: 'remote',
  };

  it.each(PROFILE_FIELD_KEYS)('%s can be written and read back through its path', (key) => {
    const { kind, choices } = PROFILE_FIELDS[key];
    const value = kind === 'choice' ? (choices?.[0]?.value ?? '') : (samples[kind] ?? 'x');
    const updated = updateProfileValue(createEmptyProfile(), key, value);
    expect(readStoredValue(updated, key)).toBe(value);
    expect(getProfileValue(updated, key)).toBe(value);
    expect(updateProfileValue(updated, key, undefined)).toEqual(createEmptyProfile());
  });

  it('keeps other values when updating one field', () => {
    const updated = updateProfileValue(profile, 'city', 'Shelbyville');
    expect(updated.location).toEqual({ city: 'Shelbyville', country: 'Canada' });
    expect(profile.location.city).toBe('Springfield');
  });

  it('reads stored values exactly as entered for editing', () => {
    const typed = updateProfileValue(createEmptyProfile(), 'first_name', ' Jane ');
    expect(readStoredValue(typed, 'first_name')).toBe(' Jane ');
    expect(getProfileValue(typed, 'first_name')).toBe('Jane');
  });
});

describe('readProfilePath', () => {
  it.each([
    ['location.city', 'Springfield'],
    ['location.missing', undefined],
    ['nope.city', undefined],
    ['location', undefined],
    ['education', undefined],
    ['experience.workHistory', undefined],
    ['identity.__proto__', undefined],
    ['identity.firstName.length', undefined],
    ['schemaVersion', 2],
  ])('%s → %j', (path, expected) => {
    expect(readProfilePath(profile, path)).toBe(expected);
  });
});

describe('isProfileFieldKey', () => {
  it('accepts every canonical key', () => {
    expect(PROFILE_FIELD_KEYS.every(isProfileFieldKey)).toBe(true);
  });

  it.each([
    'location.city',
    'identity.firstName',
    'firstName',
    'currentJobTitle',
    '__proto__',
    'toString',
    'education.0.institution',
    '',
    42,
    null,
  ])('rejects arbitrary or invalid target %j', (key) => {
    expect(isProfileFieldKey(key)).toBe(false);
  });

  it('resolves keys to nested paths only through the definitions', () => {
    const key: ProfileFieldKey = 'city';
    expect(PROFILE_FIELDS[key].path).toBe('location.city');
  });
});
