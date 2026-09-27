import { describe, expect, it } from 'vitest';
import {
  createEmptyProfile,
  getProfileValue,
  migrateProfile,
  PROFILE_SCHEMA_VERSION,
  sanitizeProfile,
  validateProfile,
} from './index';

/** Stored data is copied, never shared, as with IndexedDB. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A profile exactly as Phase 1–4 stored it (schema version 1). */
const phase4Profile = {
  schemaVersion: 1,
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '+1 555 010 0199' },
  location: { city: 'Springfield', state: 'Ontario', country: 'Canada' },
  education: [
    { institution: 'Example University', degree: 'MSc', graduationYear: 2021 },
    { institution: 'First College', degree: 'BSc', graduationYear: 2019 },
  ],
  experience: { currentCompany: 'Example Co', totalExperienceYears: 4.5, workHistory: [] },
  links: {
    linkedin: 'https://www.linkedin.com/in/jane-doe-example',
    portfolio: 'https://jane.example.dev',
  },
  preferences: {
    workModes: ['remote', 'hybrid'],
    openToRelocation: true,
    employmentTypes: ['full-time'],
  },
  authorization: { workAuthorization: 'Authorized to work in Canada', requiresSponsorship: false },
  documents: { resumes: [], coverLetters: [] },
  customAnswers: [],
};

describe('migrateProfile', () => {
  it('migrates a version 1 profile to version 3 without losing any value', () => {
    const migrated = migrateProfile(clone(phase4Profile));

    expect(migrated).toEqual({
      ...phase4Profile,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      // The version 1 list order is kept: the first entry is the primary record.
      education: [
        { institution: 'Example University', degree: 'MSc', graduationYear: 2021 },
        { institution: 'First College', degree: 'BSc', graduationYear: 2019 },
      ],
      experience: { currentCompany: 'Example Co', totalExperienceYears: 4.5 },
      workExperience: [],
      certifications: [],
      preferences: { openToRelocation: true, workMode: 'remote', employmentType: 'full-time' },
      legacy: { workModes: ['hybrid'] },
    });
    expect(PROFILE_SCHEMA_VERSION).toBe(3);
  });

  it('gives new fields safe empty defaults', () => {
    const migrated = migrateProfile({ schemaVersion: 1, identity: { firstName: 'Jane' } });
    expect(migrated).toEqual({ ...createEmptyProfile(), identity: { firstName: 'Jane' } });
    expect(migrated?.links.website).toBeUndefined();
    expect(migrated?.legacy).toBeUndefined();
  });

  it('migrates a version 1 profile with an empty education list and no preferences', () => {
    const migrated = migrateProfile({ ...phase4Profile, education: [], preferences: {} });
    expect(migrated?.education).toEqual([]);
    expect(migrated?.preferences).toEqual({});
    expect(migrated?.legacy).toBeUndefined();
  });

  it('is idempotent', () => {
    const once = migrateProfile(clone(phase4Profile));
    expect(migrateProfile(clone(once))).toEqual(once);
  });

  it('survives load → migrate → save → load with values unchanged', () => {
    const loaded = migrateProfile(clone(phase4Profile));
    if (!loaded) throw new Error('migration failed');
    expect(validateProfile(loaded).valid).toBe(true);
    const saved = clone(sanitizeProfile(loaded));
    expect(migrateProfile(saved)).toEqual(loaded);
  });

  it('loads a current profile as is', () => {
    const current = { ...createEmptyProfile(), links: { website: 'https://jane.example.com' } };
    expect(migrateProfile(clone(current))).toEqual(current);
  });

  it.each([
    undefined,
    null,
    'profile',
    [],
    { schemaVersion: 4 },
    { schemaVersion: 99 },
    { schemaVersion: '1' },
    { schemaVersion: 0 },
    {},
  ])('refuses data it does not understand: %j', (stored) => {
    expect(migrateProfile(stored)).toBeUndefined();
  });
});

/** A profile exactly as Phases 5–9 stored it (schema version 2). */
const phase9Profile = {
  schemaVersion: 2,
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com' },
  location: { city: 'Springfield', state: 'Ontario', country: 'Canada' },
  education: {
    institution: 'University of Example',
    degree: "Master's",
    fieldOfStudy: 'Physics',
    graduationYear: 2021,
  },
  experience: {
    currentCompany: 'Example Co',
    currentTitle: 'Staff Engineer',
    totalExperienceYears: 6,
    noticePeriod: '30 days',
    workHistory: [],
  },
  links: { linkedin: 'https://www.linkedin.com/in/jane-doe-example' },
  preferences: { workMode: 'hybrid', employmentType: 'full-time', openToRelocation: true },
  authorization: { workAuthorization: 'Authorized to work in Canada', requiresSponsorship: false },
  documents: { resumes: [], coverLetters: [] },
  customAnswers: [],
};

describe('migrateProfile: version 2 → 3', () => {
  it('makes the primary education record education[0] and keeps current employment as is', () => {
    const migrated = migrateProfile(clone(phase9Profile));
    const currentEmployment: Record<string, unknown> = { ...phase9Profile.experience };
    delete currentEmployment.workHistory;
    expect(migrated).toEqual({
      ...phase9Profile,
      schemaVersion: 3,
      education: [phase9Profile.education],
      experience: currentEmployment,
      workExperience: [],
      certifications: [],
    });
  });

  it('keeps every primary education value readable through the old keys', () => {
    const migrated = migrateProfile(clone(phase9Profile));
    if (!migrated) throw new Error('migration failed');
    expect(getProfileValue(migrated, 'institution')).toBe('University of Example');
    expect(getProfileValue(migrated, 'highest_degree')).toBe("Master's");
    expect(getProfileValue(migrated, 'field_of_study')).toBe('Physics');
    expect(getProfileValue(migrated, 'graduation_year')).toBe(2021);
    expect(getProfileValue(migrated, 'current_company')).toBe('Example Co');
    expect(getProfileValue(migrated, 'current_title')).toBe('Staff Engineer');
    expect(getProfileValue(migrated, 'experience_years')).toBe(6);
  });

  it('creates no records from blank data and never fabricates work experience', () => {
    const migrated = migrateProfile({
      ...clone(phase9Profile),
      education: { institution: '  ' },
    });
    expect(migrated?.education).toEqual([]);
    expect(migrated?.workExperience).toEqual([]);
    expect(migrated?.certifications).toEqual([]);
    expect(migrateProfile({ ...clone(phase9Profile), education: {} })?.education).toEqual([]);
  });

  it('turns legacy education entries into records after the primary one', () => {
    const migrated = migrateProfile({
      ...clone(phase9Profile),
      legacy: {
        education: [{ institution: 'First College', graduationYear: 2015 }, {}],
        workModes: ['remote'],
      },
    });
    expect(migrated?.education).toEqual([
      phase9Profile.education,
      { institution: 'First College', graduationYear: 2015 },
    ]);
    expect(migrated?.legacy).toEqual({ workModes: ['remote'] });
  });

  it('keeps legacy education in legacy when there is no primary record to follow', () => {
    const legacy = { education: [{ institution: 'First College' }] };
    const migrated = migrateProfile({ ...clone(phase9Profile), education: {}, legacy });
    expect(migrated?.education).toEqual([]);
    expect(migrated?.legacy).toEqual(legacy);
  });

  it('moves stored work history entries to work experience unchanged, dropping blank ones', () => {
    const workHistory = [
      { company: 'Old Co', title: 'Intern', startDate: '2016-06', endDate: '2016-09' },
      {},
    ];
    const migrated = migrateProfile({
      ...clone(phase9Profile),
      experience: { ...phase9Profile.experience, workHistory },
    });
    expect(migrated?.workExperience).toEqual([workHistory[0]]);
    expect(migrated?.experience).not.toHaveProperty('workHistory');
  });

  it('is idempotent and survives load → save → load', () => {
    const once = migrateProfile(clone(phase9Profile));
    if (!once) throw new Error('migration failed');
    expect(migrateProfile(clone(once))).toEqual(once);
    expect(validateProfile(once).valid).toBe(true);
    expect(migrateProfile(clone(sanitizeProfile(once)))).toEqual(once);
  });

  it('does not change the stored data it reads', () => {
    const stored = clone(phase9Profile);
    migrateProfile(stored);
    expect(stored).toEqual(phase9Profile);
  });

  it('keeps a version 3 profile with records as is, ignoring malformed entries', () => {
    const current = {
      ...createEmptyProfile(),
      education: [{ institution: 'A' }, { institution: 'B' }],
      workExperience: [{ company: 'C', current: true }],
      certifications: [{ name: 'D' }],
    };
    expect(migrateProfile(clone(current))).toEqual(current);
    expect(
      migrateProfile({ ...clone(current), certifications: ['x', null, { name: 'D' }] })
        ?.certifications,
    ).toEqual([{ name: 'D' }]);
  });
});
