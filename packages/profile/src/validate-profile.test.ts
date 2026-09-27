import { describe, expect, it } from 'vitest';
import { MAX_PROFILE_RECORDS } from '@applyonce/core';
import { createEmptyProfile, validateProfile, type Profile } from './index';

function profileWith(overrides: Partial<Profile>): Profile {
  return { ...createEmptyProfile(), ...overrides };
}

describe('validateProfile', () => {
  it('accepts an empty profile', () => {
    expect(validateProfile(createEmptyProfile())).toEqual({ valid: true, errors: {} });
  });

  it('accepts a valid, partially completed profile', () => {
    const result = validateProfile(
      profileWith({
        identity: { firstName: 'Jane', lastName: 'Doe' },
        contact: { email: ' jane.doe@example.com ', phone: '+1 (555) 010-0199' },
        links: { linkedin: 'https://www.linkedin.com/in/jane-doe', github: 'github.com/janedoe' },
        experience: { totalExperienceYears: 4.5 },
        education: [{ institution: 'Example University', graduationYear: 2019 }],
      }),
    );

    expect(result).toEqual({ valid: true, errors: {} });
  });

  it.each(['jane', 'jane@', 'jane@example', 'jane doe@example.com'])(
    'rejects invalid email %j',
    (email) => {
      const result = validateProfile(profileWith({ contact: { email } }));
      expect(result.valid).toBe(false);
      expect(result.errors['contact.email']).toBeDefined();
    },
  );

  it.each(['12345', 'call me', '+1 555 010 0199 0199 0199'])(
    'rejects invalid phone %j',
    (phone) => {
      expect(
        validateProfile(profileWith({ contact: { phone } })).errors['contact.phone'],
      ).toBeDefined();
    },
  );

  it.each(['not a url', 'javascript:alert(1)', 'ftp://example.com', 'https://'])(
    'rejects invalid URL %j',
    (portfolio) => {
      const result = validateProfile(profileWith({ links: { portfolio } }));
      expect(result.errors['links.portfolio']).toBeDefined();
    },
  );

  it.each([-1, 71, Number.NaN])('rejects invalid years of experience %j', (years) => {
    const result = validateProfile(profileWith({ experience: { totalExperienceYears: years } }));
    expect(result.errors['experience.totalExperienceYears']).toBeDefined();
  });

  it.each([1800, 2019.5, new Date().getFullYear() + 11])(
    'rejects invalid graduation year %j',
    (graduationYear) => {
      const result = validateProfile(
        profileWith({ education: [{ institution: 'A', graduationYear }] }),
      );
      expect(Object.keys(result.errors)).toEqual(['education[0].graduationYear']);
    },
  );

  it('treats blank text as not provided', () => {
    const result = validateProfile(profileWith({ contact: { email: '   ', phone: '' } }));
    expect(result.valid).toBe(true);
  });
});

describe('validateProfile: Phase 5 fields', () => {
  it('accepts valid values for the new fields', () => {
    const result = validateProfile(
      profileWith({
        links: { website: 'https://jane.example.com', portfolio: 'jane.example.dev' },
        preferences: { workMode: 'hybrid', employmentType: 'contract', openToRelocation: true },
        education: [
          {
            degree: 'BSc',
            fieldOfStudy: 'Physics',
            institution: 'Example U',
            graduationYear: 2020,
          },
        ],
        experience: {
          currentTitle: 'Engineer',
          currentCompany: 'Example Co',
          totalExperienceYears: 0,
        },
      }),
    );
    expect(result).toEqual({ valid: true, errors: {} });
  });

  it.each([
    [{ links: { website: 'not a website' } }, 'links.website'],
    [{ preferences: { workMode: 'sometimes' as 'remote' } }, 'preferences.workMode'],
    [{ preferences: { employmentType: 'freelance' as 'contract' } }, 'preferences.employmentType'],
    [
      { preferences: { openToRelocation: 'yes' as unknown as boolean } },
      'preferences.openToRelocation',
    ],
    [{ education: [{ graduationYear: 20.5 }] }, 'education[0].graduationYear'],
  ])('rejects invalid value %j', (overrides, path) => {
    expect(Object.keys(validateProfile(profileWith(overrides as Partial<Profile>)).errors)).toEqual(
      [path],
    );
  });

  it('accepts non-canonical spellings of choices (they are normalized on save)', () => {
    const result = validateProfile(
      profileWith({
        preferences: { workMode: 'REMOTE' as 'remote', employmentType: 'full_time' as 'full-time' },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('treats blank new fields as not provided', () => {
    const result = validateProfile(
      profileWith({ links: { website: '  ' }, education: [{ institution: '' }] }),
    );
    expect(result.valid).toBe(true);
  });
});

describe('validateProfile: repeatable records', () => {
  const nextYear = new Date().getFullYear() + 1;

  it('accepts several complete and partial records in every collection', () => {
    const result = validateProfile(
      profileWith({
        education: [
          {
            institution: 'University of Example',
            degree: "Master's",
            startYear: 2019,
            graduationYear: nextYear,
          },
          { institution: 'Sample College' },
          { fieldOfStudy: 'Physics' },
        ],
        workExperience: [
          { company: 'Example Co', title: 'Engineer', startDate: '2021-06', current: true },
          { company: 'Old Co', startDate: '2018-01-15', endDate: '2021-05', current: false },
          { description: 'Built things.' },
        ],
        certifications: [
          {
            name: 'Example Certified',
            issuer: 'Example Org',
            issueYear: 2022,
            credentialUrl: 'https://cert.example.com/abc',
          },
          { name: 'Another' },
        ],
      }),
    );
    expect(result).toEqual({ valid: true, errors: {} });
  });

  it('treats blank values and blank records as valid', () => {
    const result = validateProfile(
      profileWith({
        education: [{}, { institution: ' ' }],
        workExperience: [{ startDate: '', endDate: '  ' }],
        certifications: [{ credentialUrl: '' }],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it.each([
    [{ education: [{}, { graduationYear: 1800 }] }, 'education[1].graduationYear'],
    [{ education: [{ startYear: 2019.5 }] }, 'education[0].startYear'],
    [{ education: [{ institution: 42 as unknown as string }] }, 'education[0].institution'],
    [{ workExperience: [{ startDate: '2021-13' }] }, 'workExperience[0].startDate'],
    [{ workExperience: [{}, { endDate: 'June 2021' }] }, 'workExperience[1].endDate'],
    [{ workExperience: [{ startDate: '1800-01' }] }, 'workExperience[0].startDate'],
    [{ workExperience: [{ current: 'yes' as unknown as boolean }] }, 'workExperience[0].current'],
    [{ workExperience: [{ current: true, endDate: '2021-05' }] }, 'workExperience[0].endDate'],
    [{ certifications: [{ credentialUrl: 'not a url' }] }, 'certifications[0].credentialUrl'],
    [{ certifications: [{}, {}, { issueYear: 12 }] }, 'certifications[2].issueYear'],
  ])('rejects %j at %s', (overrides, path) => {
    expect(Object.keys(validateProfile(profileWith(overrides as Partial<Profile>)).errors)).toEqual(
      [path],
    );
  });

  it('limits each collection to MAX_PROFILE_RECORDS entries', () => {
    const many = Array.from({ length: MAX_PROFILE_RECORDS + 1 }, (_, i) => ({ name: `Cert ${i}` }));
    expect(validateProfile(profileWith({ certifications: many })).errors).toEqual({
      certifications: `Keep at most ${MAX_PROFILE_RECORDS} entries.`,
    });
    expect(validateProfile(profileWith({ certifications: many.slice(1) })).valid).toBe(true);
  });
});
