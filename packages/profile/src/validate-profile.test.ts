import { describe, expect, it } from 'vitest';
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
        experience: { totalExperienceYears: 4.5, workHistory: [] },
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
    const result = validateProfile(
      profileWith({ experience: { totalExperienceYears: years, workHistory: [] } }),
    );
    expect(result.errors['experience.totalExperienceYears']).toBeDefined();
  });

  it.each([1800, 2019.5, new Date().getFullYear() + 11])(
    'rejects invalid graduation year %j',
    (graduationYear) => {
      const result = validateProfile(
        profileWith({ education: [{ institution: 'A' }, { graduationYear }] }),
      );
      expect(Object.keys(result.errors)).toEqual(['education.1.graduationYear']);
    },
  );

  it('treats blank text as not provided', () => {
    const result = validateProfile(profileWith({ contact: { email: '   ', phone: '' } }));
    expect(result.valid).toBe(true);
  });
});
