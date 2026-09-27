import {
  MAX_PROFILE_RECORDS,
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  PROFILE_RECORD_FIELDS,
  type ProfileFieldKey,
  type ProfileTarget,
} from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import {
  createEmptyProfile,
  getProfileValue,
  isProfileFieldKey,
  readProfilePath,
  addRecord,
  canAddRecord,
  isBlankRecord,
  moveRecord,
  readStoredValue,
  recordCount,
  removeRecord,
  sanitizeProfile,
  updateProfileValue,
  updateRecordValue,
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
  },
  preferences: { workMode: 'hybrid', employmentType: 'full-time', openToRelocation: true },
  education: [
    {
      degree: 'BSc',
      fieldOfStudy: 'Physics',
      institution: 'Example University',
      graduationYear: 2019,
    },
    { institution: 'Sample College', degree: 'Diploma', startYear: 2012 },
    { institution: '   ' },
  ],
  workExperience: [
    { company: 'Example Co', title: 'Software Engineer', current: true, startDate: '2021-06' },
    { company: 'Old Co', title: 'Intern', endDate: '2021-05' },
  ],
  certifications: [{ name: 'Example Certified', credentialUrl: 'https://cert.example.com/1' }],
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
    // A primary education field leaves a blank education[0], which saving drops.
    expect(sanitizeProfile(updateProfileValue(updated, key, undefined))).toEqual(
      createEmptyProfile(),
    );
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
    ['workExperience', undefined],
    ['education[0]', undefined],
    ['education[1].institution', 'Sample College'],
    ['education[9].institution', undefined],
    ['education.institution', undefined],
    ['identity.__proto__', undefined],
    ['identity.firstName.length', undefined],
    ['schemaVersion', 3],
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

describe('record values', () => {
  it.each([
    ['education[0].startYear', undefined],
    ['education[1].institution', 'Sample College'],
    ['education[1].degree', 'Diploma'],
    ['education[1].startYear', 2012],
    ['education[2].institution', undefined],
    ['education[3].institution', undefined],
    ['workExperience[0].company', 'Example Co'],
    ['workExperience[0].current', true],
    ['workExperience[1].company', 'Old Co'],
    ['workExperience[1].endDate', '2021-05'],
    ['workExperience[2].company', undefined],
    ['certifications[0].name', 'Example Certified'],
    ['certifications[0].issuer', undefined],
    ['certifications[1].name', undefined],
  ] as const)('%s → %j', (target, value) => {
    expect(getProfileValue(profile, target)).toBe(value);
  });

  it('reads the primary education record through the long-standing keys', () => {
    expect(getProfileValue(profile, 'institution')).toBe('Example University');
    expect(getProfileValue(profile, 'education[0].institution')).toBe('Example University');
    expect(getProfileValue({ ...profile, education: [] }, 'institution')).toBeUndefined();
  });

  it.each([
    'education[1]',
    'education.1.institution',
    'education[1].gpa',
    'education[1].institution.length',
    `education[${MAX_PROFILE_RECORDS}].institution`,
    'workExperience[0].__proto__',
    'workExperience[0].constructor',
    'legacy.education[0].institution',
    'experience.workHistory[0].company',
  ])('rejects the non-canonical path %j', (target) => {
    expect(getProfileValue(profile, target)).toBeUndefined();
  });

  it('never reads from a record that is not a plain object', () => {
    const odd = { ...profile, certifications: ['Example' as unknown as object] };
    expect(getProfileValue(odd, 'certifications[0].name')).toBeUndefined();
  });

  it('writes and reads every record field of any record through its target', () => {
    let edited = addRecord(addRecord(createEmptyProfile(), 'education'), 'education');
    edited = addRecord(addRecord(edited, 'workExperience'), 'workExperience');
    edited = addRecord(edited, 'certifications');
    for (const { collection, field, kind } of PROFILE_RECORD_FIELDS) {
      const index = collection === 'certifications' ? 0 : 1;
      const value =
        kind === 'year' ? 2020 : kind === 'boolean' ? true : kind === 'month' ? '2020-01' : 'x';
      const target = `${collection}[${index}].${field}` as ProfileTarget;
      edited = updateProfileValue(edited, target, value);
      expect(readStoredValue(edited, target)).toBe(value);
      expect(getProfileValue(edited, target)).toBe(value);
    }
    expect(edited.education[0]).toEqual({});
  });
});

describe('record editing', () => {
  const empty = createEmptyProfile();

  it('adds, edits, and removes records', () => {
    let edited = addRecord(empty, 'education');
    expect(edited.education).toEqual([{}]);
    edited = updateRecordValue(edited, 'education', 0, 'institution', 'University of Example');
    edited = addRecord(edited, 'education');
    edited = updateRecordValue(edited, 'education', 1, 'institution', 'Sample College');
    edited = updateRecordValue(edited, 'education', 1, 'graduationYear', 2015);
    expect(edited.education).toEqual([
      { institution: 'University of Example' },
      { institution: 'Sample College', graduationYear: 2015 },
    ]);
    edited = updateRecordValue(edited, 'education', 1, 'institution', 'Sample University');
    edited = updateRecordValue(edited, 'education', 1, 'graduationYear', undefined);
    expect(edited.education[1]).toEqual({ institution: 'Sample University' });
    edited = removeRecord(edited, 'education', 0);
    expect(edited.education).toEqual([{ institution: 'Sample University' }]);
    expect(getProfileValue(edited, 'institution')).toBe('Sample University');
    expect(empty.education).toEqual([]);
  });

  it('handles work experience with the current flag, and certifications', () => {
    let edited = addRecord(addRecord(empty, 'workExperience'), 'workExperience');
    edited = updateRecordValue(edited, 'workExperience', 0, 'company', 'Example Co');
    edited = updateRecordValue(edited, 'workExperience', 0, 'current', true);
    edited = updateRecordValue(edited, 'workExperience', 1, 'company', 'Old Co');
    edited = addRecord(edited, 'certifications');
    edited = updateRecordValue(edited, 'certifications', 0, 'name', 'Example Certified');
    expect(edited.workExperience).toEqual([
      { company: 'Example Co', current: true },
      { company: 'Old Co' },
    ]);
    edited = removeRecord(edited, 'certifications', 0);
    expect(edited.certifications).toEqual([]);
  });

  it('reorders records with up/down moves and ignores moves past either end', () => {
    const three = {
      ...empty,
      workExperience: [{ company: 'A' }, { company: 'B' }, { company: 'C' }],
    };
    expect(moveRecord(three, 'workExperience', 2, -1).workExperience).toEqual([
      { company: 'A' },
      { company: 'C' },
      { company: 'B' },
    ]);
    expect(moveRecord(three, 'workExperience', 0, 1).workExperience.map((r) => r.company)).toEqual([
      'B',
      'A',
      'C',
    ]);
    expect(moveRecord(three, 'workExperience', 0, -1)).toBe(three);
    expect(moveRecord(three, 'workExperience', 2, 1)).toBe(three);
  });

  it('writing a primary education field creates education[0] when there is none', () => {
    const edited = updateProfileValue(empty, 'institution', 'University of Example');
    expect(edited.education).toEqual([{ institution: 'University of Example' }]);
    expect(updateProfileValue(empty, 'institution', undefined)).toBe(empty);
  });

  it('refuses unknown record fields and indexes beyond the end', () => {
    expect(() => updateRecordValue(empty, 'education', 0, 'gpa', '4.0')).toThrow();
    expect(() => updateRecordValue(empty, 'education', 1, 'institution', 'X')).toThrow();
    expect(() => updateProfileValue(empty, 'education[1].gpa' as ProfileTarget, 'x')).toThrow();
    expect(removeRecord(empty, 'education', 0)).toBe(empty);
  });

  it(`stops adding at ${MAX_PROFILE_RECORDS} records`, () => {
    let edited = empty;
    for (let i = 0; i < MAX_PROFILE_RECORDS + 3; i++) edited = addRecord(edited, 'certifications');
    expect(recordCount(edited, 'certifications')).toBe(MAX_PROFILE_RECORDS);
    expect(canAddRecord(edited, 'certifications')).toBe(false);
  });

  it('knows a blank record', () => {
    expect(isBlankRecord({})).toBe(true);
    expect(isBlankRecord({ institution: '  ' })).toBe(true);
    expect(isBlankRecord({ current: true })).toBe(false);
    expect(isBlankRecord({ startYear: 2020 })).toBe(false);
  });
});
