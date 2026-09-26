import type { Profile } from './profile';

/**
 * Prepares an edited profile for storage: trims text, treats blank text as "not
 * provided" (the property is removed), and drops list entries left completely empty.
 */
export function sanitizeProfile(profile: Profile): Profile {
  // Safe cast: sanitizeValue preserves the shape; it only removes blank optional values.
  const clean = sanitizeValue(profile) as Profile;
  return {
    ...clean,
    education: clean.education.filter(hasAnyValue),
    experience: {
      ...clean.experience,
      workHistory: clean.experience.workHistory.filter(hasAnyValue),
    },
  };
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? undefined : text;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((item) => item !== undefined);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, sanitizeValue(item)] as const)
        .filter(([, item]) => item !== undefined),
    );
  }
  return value;
}

function hasAnyValue(entry: object): boolean {
  return Object.keys(entry).length > 0;
}
