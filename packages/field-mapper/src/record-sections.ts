import type { FormField, ProfileRecordCollection } from '@applyonce/core';
import { createFieldSignature } from './field-signature';
import { normalizeQuestion, normalizeText } from './normalize';

/**
 * Headings that name one record of a repeated application section ("Education 2", "Work
 * Experience 1", "Certification"), compared whole after normalization and after removing a
 * trailing record number. Exact phrases only: a heading that merely contains one of these
 * words ("Education preferences") is not a record heading.
 */
export const RECORD_SECTION_HEADINGS: Readonly<Record<ProfileRecordCollection, readonly string[]>> =
  {
    education: [
      'education',
      'education history',
      'educational background',
      'academic history',
      'academic background',
    ],
    workExperience: [
      'work experience',
      'work history',
      'employment',
      'employment history',
      'professional experience',
      'experience',
      'previous employment',
    ],
    certifications: [
      'certification',
      'certifications',
      'certificate',
      'certificates',
      'license',
      'licenses',
      'license or certification',
      'licenses and certifications',
      'licenses certifications',
    ],
  };

/**
 * Field questions inside a record section, per record field. Compared by exact equality with
 * the field's normalized question (label, else aria-label, else placeholder); no containment,
 * so "Company" matches but "Company website" does not.
 */
export const RECORD_FIELD_ALIASES: Readonly<
  Record<ProfileRecordCollection, Readonly<Record<string, readonly string[]>>>
> = {
  education: {
    institution: [
      'institution',
      'institution name',
      'school',
      'school name',
      'school or university',
      'college or university',
      'university or college',
      'university',
      'university name',
      'college',
      'college name',
    ],
    degree: ['degree', 'degree type', 'degree earned', 'qualification'],
    fieldOfStudy: [
      'field of study',
      'major',
      'area of study',
      'course of study',
      'discipline',
      'specialization',
      'specialisation',
    ],
    startYear: ['start year', 'year started', 'from year'],
    graduationYear: [
      'graduation year',
      'year of graduation',
      'year graduated',
      'end year',
      'to year',
      'completion year',
    ],
  },
  workExperience: {
    company: [
      'company',
      'company name',
      'employer',
      'employer name',
      'organization',
      'organisation',
    ],
    title: ['job title', 'title', 'position', 'position title', 'role'],
    location: ['location', 'work location', 'job location'],
    startDate: ['start date', 'from', 'date started', 'start month'],
    endDate: ['end date', 'to', 'date ended', 'end month'],
    current: [
      'i currently work here',
      'currently work here',
      'current role',
      'current job',
      'current position',
    ],
    description: [
      'description',
      'role description',
      'job description',
      'responsibilities',
      'role description and responsibilities',
    ],
  },
  certifications: {
    name: [
      'name',
      'certification',
      'certification name',
      'certificate',
      'certificate name',
      'license name',
    ],
    issuer: ['issuer', 'issued by', 'issuing organization', 'issuing organisation', 'issuing body'],
    issueYear: ['issue year', 'year issued', 'year obtained', 'year awarded'],
    credentialUrl: ['credential url', 'credential link', 'verification url', 'certificate url'],
  },
};

const TRAILING_NUMBER = /^(.*?)\s*(?:no\s*)?(\d{1,3})$/;

/**
 * The record collection a section heading names, and the record number it states, if any:
 * "Work Experience 2" → workExperience, 2; "Certifications" → certifications, no number.
 * Undefined for any other heading.
 */
export function classifySectionHeading(
  heading: string,
): { collection: ProfileRecordCollection; number?: number } | undefined {
  const text = normalizeText(heading.replace(/\((?:optional|required)\)/gi, ''));
  const match = TRAILING_NUMBER.exec(text);
  const base = match?.[1] ?? text;
  const number = match?.[2] === undefined ? undefined : Number(match[2]);
  for (const [collection, headings] of Object.entries(RECORD_SECTION_HEADINGS)) {
    if (headings.includes(base)) {
      return { collection: collection as ProfileRecordCollection, ...(number ? { number } : {}) };
    }
  }
  return undefined;
}

/** The record field a field in a record section asks for, by its own question only. */
export function matchRecordField(
  field: FormField,
  collection: ProfileRecordCollection,
): string | undefined {
  const signature = createFieldSignature(field, normalizeQuestion);
  const question = signature.label ?? signature.ariaLabel ?? signature.placeholder;
  if (!question) return undefined;
  const aliases = RECORD_FIELD_ALIASES[collection];
  return Object.keys(aliases).find((name) => aliases[name]?.includes(question));
}
