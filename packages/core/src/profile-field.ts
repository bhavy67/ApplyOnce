import type { FieldType } from './field-type';

/**
 * Canonical profile field definitions: the single source of truth for the profile editor,
 * validation, value lookup, the mapper, the Teach Once selector, and saved-mapping
 * validation. Keys are stable identifiers (saved mappings refer to them); never rename one.
 */
export const PROFILE_FIELD_KEYS = [
  'first_name',
  'middle_name',
  'last_name',
  'full_name',
  'email',
  'phone',
  'address',
  'city',
  'state',
  'country',
  'postal_code',
  'linkedin_url',
  'github_url',
  'portfolio_url',
  'website_url',
  'current_company',
  'current_title',
  'experience_years',
  'notice_period',
  'work_mode',
  'employment_type',
  'willing_to_relocate',
  'highest_degree',
  'field_of_study',
  'institution',
  'graduation_year',
  'work_authorization',
  'requires_sponsorship',
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

/** How a value is edited, validated, and normalized. All values are single scalars. */
export type ProfileValueKind =
  | 'text'
  | 'email'
  | 'phone'
  | 'url'
  /** Non-negative number of years, decimals allowed. */
  | 'years'
  /** A calendar year. */
  | 'year'
  | 'boolean'
  /** One of `choices`. */
  | 'choice';

/** Profile editor sections, in display order. */
export const PROFILE_SECTIONS = [
  'Personal information',
  'Location',
  'Professional',
  'Employment',
  'Job preferences',
  'Education',
  'Authorization',
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export interface ProfileChoice {
  /** Canonical stored value. */
  value: string;
  label: string;
}

export interface ProfileField {
  label: string;
  /** Where the value lives in the profile: always "<section>.<property>". */
  path: string;
  section: ProfileSection;
  kind: ProfileValueKind;
  /** Form field types that can reasonably hold this value. */
  fieldTypes: readonly FieldType[];
  /** Allowed values, for kind "choice". */
  choices?: readonly ProfileChoice[];
}

export const WORK_MODE_CHOICES = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
] as const satisfies readonly ProfileChoice[];

export const EMPLOYMENT_TYPE_CHOICES = [
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
  { value: 'temporary', label: 'Temporary' },
] as const satisfies readonly ProfileChoice[];

const TEXT: readonly FieldType[] = ['text'];
const TEXT_OR_SELECT: readonly FieldType[] = ['text', 'select'];
const YES_NO: readonly FieldType[] = ['radio', 'select', 'checkbox'];
const CHOICE: readonly FieldType[] = ['select', 'radio', 'text'];

export const PROFILE_FIELDS: Readonly<Record<ProfileFieldKey, ProfileField>> = {
  first_name: {
    label: 'First name',
    path: 'identity.firstName',
    section: 'Personal information',
    kind: 'text',
    fieldTypes: TEXT,
  },
  middle_name: {
    label: 'Middle name',
    path: 'identity.middleName',
    section: 'Personal information',
    kind: 'text',
    fieldTypes: TEXT,
  },
  last_name: {
    label: 'Last name',
    path: 'identity.lastName',
    section: 'Personal information',
    kind: 'text',
    fieldTypes: TEXT,
  },
  full_name: {
    label: 'Full name',
    path: 'identity.fullName',
    section: 'Personal information',
    kind: 'text',
    fieldTypes: TEXT,
  },
  email: {
    label: 'Email',
    path: 'contact.email',
    section: 'Personal information',
    kind: 'email',
    fieldTypes: ['email', 'text'],
  },
  phone: {
    label: 'Phone',
    path: 'contact.phone',
    section: 'Personal information',
    kind: 'phone',
    fieldTypes: ['tel', 'text'],
  },

  address: {
    label: 'Address',
    path: 'location.address',
    section: 'Location',
    kind: 'text',
    fieldTypes: ['text', 'textarea'],
  },
  city: {
    label: 'City',
    path: 'location.city',
    section: 'Location',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
  },
  state: {
    label: 'State / province',
    path: 'location.state',
    section: 'Location',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
  },
  country: {
    label: 'Country',
    path: 'location.country',
    section: 'Location',
    kind: 'text',
    fieldTypes: ['select', 'text'],
  },
  postal_code: {
    label: 'Postal code',
    path: 'location.postalCode',
    section: 'Location',
    kind: 'text',
    fieldTypes: ['text', 'number'],
  },

  linkedin_url: {
    label: 'LinkedIn',
    path: 'links.linkedin',
    section: 'Professional',
    kind: 'url',
    fieldTypes: TEXT,
  },
  github_url: {
    label: 'GitHub',
    path: 'links.github',
    section: 'Professional',
    kind: 'url',
    fieldTypes: TEXT,
  },
  portfolio_url: {
    label: 'Portfolio',
    path: 'links.portfolio',
    section: 'Professional',
    kind: 'url',
    fieldTypes: TEXT,
  },
  website_url: {
    label: 'Website',
    path: 'links.website',
    section: 'Professional',
    kind: 'url',
    fieldTypes: TEXT,
  },

  current_title: {
    label: 'Current job title',
    path: 'experience.currentTitle',
    section: 'Employment',
    kind: 'text',
    fieldTypes: TEXT,
  },
  current_company: {
    label: 'Current company',
    path: 'experience.currentCompany',
    section: 'Employment',
    kind: 'text',
    fieldTypes: TEXT,
  },
  experience_years: {
    label: 'Years of experience',
    path: 'experience.totalExperienceYears',
    section: 'Employment',
    kind: 'years',
    fieldTypes: ['number', 'text', 'select'],
  },
  notice_period: {
    label: 'Notice period',
    path: 'experience.noticePeriod',
    section: 'Employment',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
  },

  work_mode: {
    label: 'Work mode',
    path: 'preferences.workMode',
    section: 'Job preferences',
    kind: 'choice',
    fieldTypes: CHOICE,
    choices: WORK_MODE_CHOICES,
  },
  employment_type: {
    label: 'Employment type',
    path: 'preferences.employmentType',
    section: 'Job preferences',
    kind: 'choice',
    fieldTypes: CHOICE,
    choices: EMPLOYMENT_TYPE_CHOICES,
  },
  willing_to_relocate: {
    label: 'Willing to relocate',
    path: 'preferences.openToRelocation',
    section: 'Job preferences',
    kind: 'boolean',
    fieldTypes: YES_NO,
  },

  highest_degree: {
    label: 'Highest degree',
    path: 'education.degree',
    section: 'Education',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
  },
  field_of_study: {
    label: 'Field of study',
    path: 'education.fieldOfStudy',
    section: 'Education',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
  },
  institution: {
    label: 'Institution',
    path: 'education.institution',
    section: 'Education',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
  },
  graduation_year: {
    label: 'Graduation year',
    path: 'education.graduationYear',
    section: 'Education',
    kind: 'year',
    fieldTypes: ['number', 'text', 'select'],
  },

  work_authorization: {
    label: 'Work authorization',
    path: 'authorization.workAuthorization',
    section: 'Authorization',
    kind: 'text',
    fieldTypes: ['text', 'select', 'radio'],
  },
  requires_sponsorship: {
    label: 'Requires visa sponsorship',
    path: 'authorization.requiresSponsorship',
    section: 'Authorization',
    kind: 'boolean',
    fieldTypes: YES_NO,
  },
};
