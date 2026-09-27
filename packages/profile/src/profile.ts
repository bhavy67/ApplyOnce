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
 */
export const PROFILE_SCHEMA_VERSION = 2;

export interface Profile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  identity: Identity;
  contact: Contact;
  location: Location;
  /** The primary (highest) education record. Multiple records are not supported yet. */
  education: Education;
  experience: Experience;
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

export interface Education {
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
  /** Education entries after the first (version 1 allowed a list). */
  education?: Education[];
  /** Work modes after the first (version 1 allowed several). */
  workModes?: string[];
  /** Employment types after the first (version 1 allowed several). */
  employmentTypes?: string[];
}
