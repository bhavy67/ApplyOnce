import { describe, expect, it } from 'vitest';
import { createEmptyProfile, PROFILE_SCHEMA_VERSION, type Profile } from './index';

describe('createEmptyProfile', () => {
  it('creates every section with no personal values', () => {
    expect(createEmptyProfile()).toEqual({
      schemaVersion: PROFILE_SCHEMA_VERSION,
      identity: {},
      contact: {},
      location: {},
      education: {},
      experience: { workHistory: [] },
      links: {},
      preferences: {},
      authorization: {},
      documents: { resumes: [], coverLetters: [] },
      customAnswers: [],
    });
  });

  it('returns independent instances', () => {
    const a = createEmptyProfile();
    const b = createEmptyProfile();
    a.education.institution = 'Example University';
    a.experience.workHistory.push({ company: 'Example Co' });

    expect(b.education).toEqual({});
    expect(b.experience.workHistory).toEqual([]);
  });

  it('can represent a partially completed profile', () => {
    const profile: Profile = {
      ...createEmptyProfile(),
      identity: { firstName: 'Jane' },
      contact: { email: 'jane@example.com' },
      preferences: { workMode: 'remote' },
    };

    expect(profile.identity.lastName).toBeUndefined();
    expect(profile.location).toEqual({});
  });
});
