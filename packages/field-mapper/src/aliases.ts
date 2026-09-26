import type { ProfileFieldKey } from '@applyonce/core';

/**
 * Known phrases per profile field. Grow this from real forms, adding a regression test
 * for each addition (spec §27).
 *
 * Multi-word phrases may also match inside a longer label (lower confidence); single
 * words only match exactly, because words like "name" or "email" appear in too many
 * unrelated questions.
 */
export const DEFAULT_ALIASES: Readonly<Partial<Record<ProfileFieldKey, readonly string[]>>> = {
  first_name: ['first name', 'given name', 'legal first name', 'fname', 'forename'],
  middle_name: ['middle name', 'middle initial'],
  last_name: ['last name', 'family name', 'surname', 'legal last name', 'lname'],
  full_name: ['full name', 'name', 'your name', 'legal name', 'full legal name'],
  email: ['email', 'email address', 'e-mail', 'e-mail address', 'your email'],
  phone: [
    'phone',
    'phone number',
    'mobile',
    'mobile number',
    'mobile phone',
    'telephone',
    'cell phone',
    'contact number',
  ],
  address: ['address', 'street address', 'address line 1', 'street'],
  city: ['city', 'town', 'city town'],
  state: ['state', 'province', 'state province', 'region', 'state region'],
  country: ['country', 'country of residence'],
  postal_code: ['postal code', 'zip', 'zip code', 'postcode', 'pin code', 'zip postal code'],
  linkedin_url: ['linkedin', 'linkedin profile', 'linkedin url', 'linkedin profile url'],
  github_url: ['github', 'github profile', 'github url'],
  portfolio_url: ['portfolio', 'website', 'personal website', 'portfolio url', 'portfolio website'],
  current_company: ['current company', 'current employer', 'current company name'],
  current_title: ['current title', 'current job title', 'job title', 'current role'],
  experience_years: [
    'years of experience',
    'total experience',
    'experience in years',
    'total years of experience',
    'total years of professional experience',
    'years of professional experience',
  ],
  notice_period: ['notice period', 'notice period in days'],
  work_authorization: ['work authorization', 'work authorisation', 'work permit'],
  requires_sponsorship: [
    'sponsorship',
    'visa sponsorship',
    'require sponsorship',
    'require visa sponsorship',
    'requires sponsorship',
    'need sponsorship',
    'need visa sponsorship',
  ],
  willing_to_relocate: ['relocate', 'relocation', 'willing to relocate', 'open to relocation'],
};

/** Standard HTML autocomplete tokens that identify a profile field unambiguously. */
export const AUTOCOMPLETE_TOKENS: Readonly<Record<string, ProfileFieldKey>> = {
  'given-name': 'first_name',
  'additional-name': 'middle_name',
  'family-name': 'last_name',
  name: 'full_name',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'street-address': 'address',
  'address-line1': 'address',
  'address-level2': 'city',
  'address-level1': 'state',
  country: 'country',
  'country-name': 'country',
  'postal-code': 'postal_code',
  organization: 'current_company',
  'organization-title': 'current_title',
};
