/**
 * The personal profile: stable information reused across forms.
 *
 * This is a deliberately small starting shape (spec §13). Add properties only when a
 * real form needs them. Everything is optional because the profile is filled in
 * gradually and a missing value must never be guessed.
 */

import type { EMPLOYMENT_TYPE_CHOICES, WORK_MODE_CHOICES } from '@applyonce/core';

/**
 * Bump when the persisted shape changes, and add a step to migrate-profile.ts.
 *
 * - 1: initial profile (Phase 1).
 * - 2: single primary education record, single work mode and employment type, website.
 * - 3: repeatable records: education list (the first entry is the primary record), work
 *   experience list (moved from `experience.workHistory`), certifications list.
 */
export const PROFILE_SCHEMA_VERSION = 3;

export interface Profile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  identity: Identity;
  contact: Contact;
  location: Location;
  /**
   * Education records, most relevant first. The first entry is the primary (highest)
   * record: the institution, field_of_study, highest_degree, and graduation_year fields read
   * and write it.
   */
  education: EducationEntry[];
  /** Current employment, as single values. Independent of `workExperience`. */
  experience: Experience;
  /** Employment history, in the order the user keeps it. Never derived from `experience`. */
  workExperience: WorkExperienceEntry[];
  certifications: CertificationEntry[];
  links: Links;
  preferences: Preferences;
  authorization: Authorization;
  documents: Documents;
  customAnswers: CustomAnswer[];
  /**
   * Data from an older profile version that the current model cannot represent (e.g. a
   * second education entry). Kept so migration never destroys data; not used for filling.
   */
  legacy?: LegacyProfileData;
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
  startYear?: number;
  graduationYear?: number;
}

/** Earlier name of an education entry (kept for `legacy`). */
export type Education = EducationEntry;

export interface Experience {
  currentCompany?: string;
  currentTitle?: string;
  totalExperienceYears?: number;
  /** Free text as users answer it on forms, e.g. "30 days" or "Immediately". */
  noticePeriod?: string;
}

export interface WorkExperienceEntry {
  company?: string;
  title?: string;
  location?: string;
  /** "YYYY-MM" (or "YYYY-MM-DD"), kept as text. */
  startDate?: string;
  /** "YYYY-MM" (or "YYYY-MM-DD"). Left blank for a current role. */
  endDate?: string;
  current?: boolean;
  description?: string;
}

export interface CertificationEntry {
  name?: string;
  issuer?: string;
  issueYear?: number;
  credentialUrl?: string;
}

export interface Links {
  linkedin?: string;
  github?: string;
  portfolio?: string;
  website?: string;
}

export type WorkMode = (typeof WORK_MODE_CHOICES)[number]['value'];
export type EmploymentType = (typeof EMPLOYMENT_TYPE_CHOICES)[number]['value'];

export interface Preferences {
  workMode?: WorkMode;
  employmentType?: EmploymentType;
  openToRelocation?: boolean;
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

/** Values from older versions that did not fit the current model, preserved verbatim. */
export interface LegacyProfileData {
  /**
   * Education entries after the first (version 1 allowed a list). Since version 3 these are
   * education records again; they stay here only if there was no primary record to follow.
   */
  education?: Education[];
  /** Work modes after the first (version 1 allowed several). */
  workModes?: string[];
  /** Employment types after the first (version 1 allowed several). */
  employmentTypes?: string[];
}
