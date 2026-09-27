import { describe, expect, it } from 'vitest';
import {
  createEmptyProfile,
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
  it('migrates a version 1 profile without losing any value', () => {
    const migrated = migrateProfile(clone(phase4Profile));

    expect(migrated).toEqual({
      ...phase4Profile,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      education: { institution: 'Example University', degree: 'MSc', graduationYear: 2021 },
      preferences: { openToRelocation: true, workMode: 'remote', employmentType: 'full-time' },
      legacy: {
        education: [{ institution: 'First College', degree: 'BSc', graduationYear: 2019 }],
        workModes: ['hybrid'],
      },
    });
  });

  it('gives new fields safe empty defaults', () => {
    const migrated = migrateProfile({ schemaVersion: 1, identity: { firstName: 'Jane' } });
    expect(migrated).toEqual({ ...createEmptyProfile(), identity: { firstName: 'Jane' } });
    expect(migrated?.links.website).toBeUndefined();
    expect(migrated?.legacy).toBeUndefined();
  });

  it('migrates a version 1 profile with an empty education list and no preferences', () => {
    const migrated = migrateProfile({ ...phase4Profile, education: [], preferences: {} });
    expect(migrated?.education).toEqual({});
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

  it.each([undefined, null, 'profile', [], { schemaVersion: 3 }, { schemaVersion: '1' }, {}])(
    'refuses data it does not understand: %j',
    (stored) => {
      expect(migrateProfile(stored)).toBeUndefined();
    },
  );
});
