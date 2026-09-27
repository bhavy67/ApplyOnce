import { describe, expect, it } from 'vitest';
import { createEmptyProfile, sanitizeProfile } from './index';

describe('sanitizeProfile', () => {
  it('trims text and removes blank values', () => {
    const profile = sanitizeProfile({
      ...createEmptyProfile(),
      identity: { firstName: '  Jane ', middleName: '   ', lastName: '' },
    });

    expect(profile.identity).toEqual({ firstName: 'Jane' });
  });

  it('drops empty work history entries and keeps filled ones', () => {
    const profile = sanitizeProfile({
      ...createEmptyProfile(),
      experience: { workHistory: [{ company: ' ' }, { company: 'Example Co' }] },
    });

    expect(profile.experience.workHistory).toEqual([{ company: 'Example Co' }]);
  });

  it('stores choice fields in canonical form', () => {
    const profile = sanitizeProfile({
      ...createEmptyProfile(),
      preferences: {
        workMode: 'On-site' as 'onsite',
        employmentType: 'Full Time' as 'full-time',
      },
    });

    expect(profile.preferences).toEqual({ workMode: 'onsite', employmentType: 'full-time' });
  });

  it('keeps the primary education record and legacy data', () => {
    const profile = sanitizeProfile({
      ...createEmptyProfile(),
      education: { institution: ' Example University ', degree: '' },
      legacy: { education: [{ institution: 'Second School' }] },
    });

    expect(profile.education).toEqual({ institution: 'Example University' });
    expect(profile.legacy).toEqual({ education: [{ institution: 'Second School' }] });
  });

  it('keeps numbers, booleans, and empty required sections', () => {
    const profile = sanitizeProfile({
      ...createEmptyProfile(),
      experience: { totalExperienceYears: 0, workHistory: [] },
      authorization: { requiresSponsorship: false },
    });

    expect(profile.experience).toEqual({ totalExperienceYears: 0, workHistory: [] });
    expect(profile.authorization).toEqual({ requiresSponsorship: false });
    expect(profile.documents).toEqual({ resumes: [], coverLetters: [] });
  });
});
