import type { FieldType } from './field-type';

/**
 * Canonical profile fields that form fields can be mapped to.
 *
 * These keys are the mapping vocabulary shared by the mapper, adapters, and saved
 * user mappings. Resolving a key to an actual profile value is added with the fill
 * engine (Phase 2).
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
  'current_company',
  'current_title',
  'experience_years',
  'notice_period',
  'work_authorization',
  'requires_sponsorship',
  'willing_to_relocate',
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

export interface ProfileField {
  label: string;
  /** Form field types that can reasonably hold this value. */
  fieldTypes: readonly FieldType[];
}

export const PROFILE_FIELDS: Readonly<Record<ProfileFieldKey, ProfileField>> = {
  first_name: { label: 'First name', fieldTypes: ['text'] },
  middle_name: { label: 'Middle name', fieldTypes: ['text'] },
  last_name: { label: 'Last name', fieldTypes: ['text'] },
  full_name: { label: 'Full name', fieldTypes: ['text'] },
  email: { label: 'Email', fieldTypes: ['email', 'text'] },
  phone: { label: 'Phone', fieldTypes: ['tel', 'text'] },
  address: { label: 'Address', fieldTypes: ['text', 'textarea'] },
  city: { label: 'City', fieldTypes: ['text', 'select'] },
  state: { label: 'State / province', fieldTypes: ['text', 'select'] },
  country: { label: 'Country', fieldTypes: ['select', 'text'] },
  postal_code: { label: 'Postal code', fieldTypes: ['text', 'number'] },
  linkedin_url: { label: 'LinkedIn', fieldTypes: ['text'] },
  github_url: { label: 'GitHub', fieldTypes: ['text'] },
  portfolio_url: { label: 'Portfolio / website', fieldTypes: ['text'] },
  current_company: { label: 'Current company', fieldTypes: ['text'] },
  current_title: { label: 'Current title', fieldTypes: ['text'] },
  experience_years: { label: 'Years of experience', fieldTypes: ['number', 'text', 'select'] },
  notice_period: { label: 'Notice period', fieldTypes: ['text', 'select'] },
  work_authorization: { label: 'Work authorization', fieldTypes: ['text', 'select', 'radio'] },
  requires_sponsorship: {
    label: 'Requires sponsorship',
    fieldTypes: ['radio', 'select', 'checkbox'],
  },
  willing_to_relocate: {
    label: 'Willing to relocate',
    fieldTypes: ['radio', 'select', 'checkbox'],
  },
};
