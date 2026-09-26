import type { Profile } from './profile';

/** Error messages keyed by dotted path, e.g. "contact.email" or "education.0.graduationYear". */
export type ProfileFieldErrors = Readonly<Record<string, string>>;

export interface ProfileValidationResult {
  valid: boolean;
  errors: ProfileFieldErrors;
}

export const MAX_EXPERIENCE_YEARS = 70;
export const MIN_GRADUATION_YEAR = 1950;
/** Allows expected graduation dates for people still studying. */
const MAX_YEARS_UNTIL_GRADUATION = 10;

/**
 * Checks the format of values that are present. Blank values are always allowed, so a
 * partially completed profile is valid.
 *
 * This is field validation only. Whether a profile has enough information for a given
 * form (completeness) is a separate concern and never blocks saving.
 */
export function validateProfile(profile: Profile): ProfileValidationResult {
  const errors: Record<string, string> = {};
  const check = (path: string, error: string | undefined) => {
    if (error) errors[path] = error;
  };

  check('contact.email', validateEmail(profile.contact.email));
  check('contact.phone', validatePhone(profile.contact.phone));
  check('contact.alternatePhone', validatePhone(profile.contact.alternatePhone));
  check('links.linkedin', validateUrl(profile.links.linkedin));
  check('links.github', validateUrl(profile.links.github));
  check('links.portfolio', validateUrl(profile.links.portfolio));
  check(
    'experience.totalExperienceYears',
    validateExperienceYears(profile.experience.totalExperienceYears),
  );
  profile.education.forEach((entry, index) => {
    check(`education.${index}.graduationYear`, validateGraduationYear(entry.graduationYear));
  });

  return { valid: Object.keys(errors).length === 0, errors };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARACTERS = /^\+?[\d\s().-]+$/;
/** http(s) scheme optional: people often type "github.com/name". */
const URL_PATTERN =
  /^(https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d{1,5})?([/?#]\S*)?$/i;

function validateEmail(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return EMAIL_PATTERN.test(text) ? undefined : 'Enter a valid email address.';
}

function validatePhone(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const digitCount = text.replace(/\D/g, '').length;
  // E.164 allows at most 15 digits; fewer than 7 is not a usable phone number.
  const valid = PHONE_CHARACTERS.test(text) && digitCount >= 7 && digitCount <= 15;
  return valid ? undefined : 'Enter a valid phone number.';
}

function validateUrl(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return URL_PATTERN.test(text) ? undefined : 'Enter a valid URL, e.g. https://example.com.';
}

function validateExperienceYears(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return 'Enter a number.';
  if (value < 0) return 'Years of experience cannot be negative.';
  if (value > MAX_EXPERIENCE_YEARS) return `Enter at most ${MAX_EXPERIENCE_YEARS} years.`;
  return undefined;
}

function validateGraduationYear(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const maxYear = new Date().getFullYear() + MAX_YEARS_UNTIL_GRADUATION;
  if (!Number.isInteger(value) || value < MIN_GRADUATION_YEAR || value > maxYear) {
    return `Enter a year between ${MIN_GRADUATION_YEAR} and ${maxYear}.`;
  }
  return undefined;
}
