import type { ProfileFieldKey } from '@applyonce/core';

/**
 * Seed phrases per profile field. Grow this from real forms, adding a regression test
 * for each addition (spec §27).
 */
export const DEFAULT_ALIASES: Readonly<Partial<Record<ProfileFieldKey, readonly string[]>>> = {
  first_name: ['first name', 'given name', 'legal first name', 'fname'],
  last_name: ['last name', 'family name', 'surname', 'legal last name', 'lname'],
  full_name: ['full name', 'name', 'your name'],
  email: ['email', 'email address', 'e-mail', 'your email'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone'],
  city: ['city', 'town'],
  country: ['country'],
  postal_code: ['postal code', 'zip', 'zip code', 'postcode', 'pin code'],
  linkedin_url: ['linkedin', 'linkedin profile', 'linkedin url'],
  github_url: ['github', 'github profile', 'github url'],
  portfolio_url: ['portfolio', 'website', 'personal website', 'portfolio url'],
  current_company: ['current company', 'current employer'],
  current_title: ['current title', 'current job title', 'job title'],
  experience_years: [
    'years of experience',
    'total experience',
    'experience in years',
    'total years of experience',
    'total years of professional experience',
  ],
  notice_period: ['notice period'],
};

/** Standard HTML autocomplete tokens that identify a profile field unambiguously. */
export const AUTOCOMPLETE_TOKENS: Readonly<Record<string, ProfileFieldKey>> = {
  'given-name': 'first_name',
  'additional-name': 'middle_name',
  'family-name': 'last_name',
  name: 'full_name',
  email: 'email',
  tel: 'phone',
  'street-address': 'address',
  'address-level2': 'city',
  'address-level1': 'state',
  country: 'country',
  'country-name': 'country',
  'postal-code': 'postal_code',
  organization: 'current_company',
  'organization-title': 'current_title',
};
