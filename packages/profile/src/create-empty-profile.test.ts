import { describe, expect, it } from 'vitest';
import { createEmptyProfile, PROFILE_SCHEMA_VERSION, type Profile } from './index';

describe('createEmptyProfile', () => {
  it('creates every section with no personal values', () => {
    expect(createEmptyProfile()).toEqual({
      schemaVersion: PROFILE_SCHEMA_VERSION,
      identity: {},
      contact: {},
      location: {},
      education: [],
      experience: {},
      workExperience: [],
      certifications: [],
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
    a.education.push({ institution: 'Example University' });
    a.workExperience.push({ company: 'Example Co' });
    a.certifications.push({ name: 'Example Cert' });

    expect(b.education).toEqual([]);
    expect(b.workExperience).toEqual([]);
    expect(b.certifications).toEqual([]);
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
