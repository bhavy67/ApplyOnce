import { describe, expect, it } from 'vitest';
import { countProfileValues, createEmptyProfile } from './index';

describe('countProfileValues', () => {
  it('is zero for an empty profile', () => {
    expect(countProfileValues(createEmptyProfile())).toBe(0);
  });

  it('counts entered values, including list items, and ignores blanks', () => {
    const count = countProfileValues({
      ...createEmptyProfile(),
      identity: { firstName: 'Jane', lastName: '  ' },
      experience: { totalExperienceYears: 0, workHistory: [] },
      authorization: { requiresSponsorship: false },
      preferences: { workModes: ['remote', 'hybrid'] },
      education: [{ institution: 'Example University', graduationYear: 2019 }],
    });

    expect(count).toBe(7);
  });
});
