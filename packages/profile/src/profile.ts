/**
 * The personal profile: stable information reused across forms.
 *
 * This is a deliberately small starting shape (spec §13). Add properties only when a
 * real form needs them. Everything is optional because the profile is filled in
 * gradually and a missing value must never be guessed.
 */

/** Bump when the persisted shape changes so stored profiles can be migrated. */
export const PROFILE_SCHEMA_VERSION = 1;

export interface Profile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  identity: Identity;
  contact: Contact;
  location: Location;
  education: EducationEntry[];
  experience: Experience;
  links: Links;
  preferences: Preferences;
  authorization: Authorization;
  documents: Documents;
  customAnswers: CustomAnswer[];
}

export interface Identity {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  /** Explicit override; otherwise derived from first/middle/last when needed. */
  fullName?: string;
}

export interface Contact {
  email?: string;
  phone?: string;
  alternatePhone?: string;
}

export interface Location {
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

export interface EducationEntry {
  institution?: string;
  degree?: string;
  fieldOfStudy?: string;
  graduationYear?: number;
}

export interface Experience {
  currentCompany?: string;
  currentTitle?: string;
  totalExperienceYears?: number;
  /** Free text as users answer it on forms, e.g. "30 days" or "Immediately". */
  noticePeriod?: string;
  workHistory: WorkHistoryEntry[];
}

export interface WorkHistoryEntry {
  company?: string;
  title?: string;
  /** ISO 8601 date (YYYY-MM or YYYY-MM-DD). */
  startDate?: string;
  /** ISO 8601 date. Omitted for the current role. */
  endDate?: string;
  description?: string;
}

export interface Links {
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'internship'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export interface Preferences {
  workModes?: WorkMode[];
  openToRelocation?: boolean;
  employmentTypes?: EmploymentType[];
}

export interface Authorization {
  /** Free text as users answer it on forms, e.g. "Authorized to work in India". */
  workAuthorization?: string;
  requiresSponsorship?: boolean;
}

/**
 * Metadata only. File contents are never stored in the profile, and uploads always
 * stay a user decision (spec §15, §22).
 */
export interface DocumentReference {
  id: string;
  label: string;
  fileName: string;
}

export interface Documents {
  resumes: DocumentReference[];
  coverLetters: DocumentReference[];
}

/**
 * A reusable answer to a custom question.
 *
 * `companyScope` separates application-specific answers from general ones (spec §21):
 * a scoped answer must never be reused for a different company.
 */
export interface CustomAnswer {
  id: string;
  question: string;
  answer: string;
  companyScope?: string;
}
