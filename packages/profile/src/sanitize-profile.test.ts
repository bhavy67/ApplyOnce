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

  it('drops empty education entries and keeps filled ones', () => {
    const profile = sanitizeProfile({
      ...createEmptyProfile(),
      education: [{ institution: ' ' }, { institution: 'Example University' }],
    });

    expect(profile.education).toEqual([{ institution: 'Example University' }]);
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
