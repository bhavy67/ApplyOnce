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
  github_url: ['github', 'github profile', 'github url', 'github profile url'],
  portfolio_url: [
    'portfolio',
    'portfolio url',
    'portfolio website',
    'portfolio link',
    'online portfolio',
  ],
  website_url: ['website', 'personal website', 'website url', 'personal site', 'personal web site'],
  current_company: [
    'current company',
    'current employer',
    'employer',
    'current company name',
    'current organization',
    'current organisation',
    'employer name',
  ],
  current_title: [
    'job title',
    'current job title',
    'current title',
    'current role',
    'current position',
    'current designation',
    'designation',
  ],
  experience_years: [
    'years of experience',
    'total experience',
    'experience in years',
    'total years of experience',
    'total years of professional experience',
    'years of professional experience',
    'years of relevant experience',
    'work experience years',
  ],
  notice_period: ['notice period', 'notice period in days'],
  work_mode: [
    'work mode',
    'preferred work mode',
    'work arrangement',
    'preferred work arrangement',
    'workplace type',
    'work location type',
    'remote hybrid on site',
    'remote hybrid onsite',
    'remote or on site',
  ],
  employment_type: [
    'employment type',
    'type of employment',
    'job type',
    'preferred job type',
    'full time part time contract',
    'full time part time',
    'full time or part time',
  ],
  willing_to_relocate: ['relocate', 'relocation', 'willing to relocate', 'open to relocation'],
  highest_degree: [
    'degree',
    'highest degree',
    'highest education',
    'highest education level',
    'highest level of education',
    'education level',
    'level of education',
    'highest qualification',
    'degree level',
  ],
  field_of_study: [
    'field of study',
    'major',
    'area of study',
    'course of study',
    'discipline',
    'specialization',
    'specialisation',
  ],
  institution: [
    'university',
    'college',
    'school',
    'institution',
    'university name',
    'college name',
    'school name',
    'institution name',
    'name of institution',
    'educational institution',
    'college university',
    'university college',
  ],
  graduation_year: [
    'graduation year',
    'year of graduation',
    'grad year',
    'passing year',
    'year of passing',
    'expected graduation year',
  ],
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
};

/**
 * Ambiguous words that point at a profile field but could also mean something else, e.g.
 * "Company" (current or target company?) or "Experience" (years or a description?). An
 * exact label match on one of these is worth less than a real alias, so on its own it
 * only ever reaches review, never high confidence.
 */
export const WEAK_ALIASES: Readonly<Partial<Record<ProfileFieldKey, readonly string[]>>> = {
  current_company: ['company', 'company name', 'organization', 'organisation'],
  current_title: ['title', 'position', 'role'],
  experience_years: ['experience'],
  highest_degree: ['education', 'qualification'],
  graduation_year: ['graduation', 'graduation date'],
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
