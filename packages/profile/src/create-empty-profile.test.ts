import { describe, expect, it } from 'vitest';
import { createEmptyProfile, PROFILE_SCHEMA_VERSION } from './index';

describe('createEmptyProfile', () => {
  it('creates a profile with the current schema version and no values', () => {
    const profile = createEmptyProfile();

    expect(profile.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(profile.identity).toEqual({});
    expect(profile.experience.workHistory).toEqual([]);
    expect(profile.customAnswers).toEqual([]);
  });

  it('returns independent instances', () => {
    const a = createEmptyProfile();
    const b = createEmptyProfile();
    a.education.push({ institution: 'Example University' });

    expect(b.education).toEqual([]);
  });
});
