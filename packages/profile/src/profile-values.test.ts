import { PROFILE_FIELD_KEYS } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import {
  createEmptyProfile,
  getProfileValue,
  PROFILE_FIELD_PATHS,
  readProfilePath,
  type Profile,
} from './index';

const profile: Profile = {
  ...createEmptyProfile(),
  identity: { firstName: 'Jane', middleName: 'Q', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '   ' },
  location: { city: 'Springfield', country: 'Canada' },
  experience: { totalExperienceYears: 4.5, workHistory: [] },
  authorization: { requiresSponsorship: false },
  education: [{ institution: 'Example University' }],
};

describe('getProfileValue', () => {
  it('returns values for valid profile fields, including nested sections', () => {
    expect(getProfileValue(profile, 'first_name')).toBe('Jane');
    expect(getProfileValue(profile, 'email')).toBe('jane.doe@example.com');
    expect(getProfileValue(profile, 'city')).toBe('Springfield');
    expect(getProfileValue(profile, 'experience_years')).toBe(4.5);
    expect(getProfileValue(profile, 'requires_sponsorship')).toBe(false);
  });

  it('returns undefined for missing or blank values', () => {
    expect(getProfileValue(profile, 'postal_code')).toBeUndefined();
    expect(getProfileValue(profile, 'phone')).toBeUndefined();
    expect(getProfileValue(createEmptyProfile(), 'willing_to_relocate')).toBeUndefined();
  });

  it('derives the full name when no explicit full name is saved', () => {
    expect(getProfileValue(profile, 'full_name')).toBe('Jane Q Doe');
    const explicit = { ...profile, identity: { ...profile.identity, fullName: 'J. Doe' } };
    expect(getProfileValue(explicit, 'full_name')).toBe('J. Doe');
    expect(getProfileValue(createEmptyProfile(), 'full_name')).toBeUndefined();
  });

  it.each(['firstName', 'identity.firstName', '__proto__', 'constructor', ''])(
    'returns undefined for invalid key %j',
    (key) => {
      expect(getProfileValue(profile, key)).toBeUndefined();
    },
  );

  it('has a path for every profile field key that resolves on a full profile', () => {
    for (const key of PROFILE_FIELD_KEYS) {
      expect(PROFILE_FIELD_PATHS[key]).toMatch(/^[a-z]+\.[A-Za-z]+$/);
    }
  });
});

describe('readProfilePath', () => {
  it.each([
    ['location.city', 'Springfield'],
    ['location.missing', undefined],
    ['nope.city', undefined],
    ['location', undefined],
    ['education', undefined],
    ['education.0.institution', undefined],
    ['identity.__proto__', undefined],
    ['identity.firstName.length', undefined],
    ['schemaVersion', 1],
  ])('%s → %j', (path, expected) => {
    expect(readProfilePath(profile, path)).toBe(expected);
  });
});
