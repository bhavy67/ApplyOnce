import type { FieldType } from './field-type';

/**
 * Canonical profile field definitions: the single source of truth for the profile editor,
 * validation, value lookup, the mapper, the Teach Once selector, and saved-mapping
 * validation. Keys are stable identifiers (saved mappings refer to them); never rename one.
 *
 * Two kinds of definitions live here, and nowhere else:
 * - scalar fields (`PROFILE_FIELDS`, keyed by `ProfileFieldKey`), one value each;
 * - repeatable record fields (`PROFILE_RECORD_FIELDS`), one value per record of a
 *   collection (education, work experience, certifications).
 *
 * The primary education fields (`institution`, `field_of_study`, `highest_degree`,
 * `graduation_year`) are not separate values: they are derived from the education record
 * fields and read and write `education[0]`, the primary record.
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
  /** A month as text, "YYYY-MM" (or "YYYY-MM-DD"). Never parsed further. */
  | 'month'
  | 'boolean'
  /** One of `choices`. */
  | 'choice';

/** Profile editor sections, in display order. */
export const PROFILE_SECTIONS = [
  'Personal information',
  'Location',
  'Professional',
  'Employment',
  'Work experience',
  'Job preferences',
  'Education',
  'Certifications',
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
  /**
   * Where the value lives in the profile: "<section>.<property>", or
   * "<collection>[0].<property>" for a field of the primary record.
   */
  path: string;
  section: ProfileSection;
  kind: ProfileValueKind;
  /** Form field types that can reasonably hold this value. */
  fieldTypes: readonly FieldType[];
  /** Allowed values, for kind "choice". */
  choices?: readonly ProfileChoice[];
  /** Set when the value is a field of the collection's first (primary) record. */
  record?: { collection: ProfileRecordCollection; field: string };
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
const YEAR: readonly FieldType[] = ['number', 'text', 'select'];

// ---------------------------------------------------------------------------------------
// Repeatable records
// ---------------------------------------------------------------------------------------

export const PROFILE_RECORD_COLLECTIONS = [
  'education',
  'workExperience',
  'certifications',
] as const;

export type ProfileRecordCollection = (typeof PROFILE_RECORD_COLLECTIONS)[number];

/**
 * Most records one collection can hold. Generous for a real history, but bounds storage and
 * the Teach Once selector; also the bound on record indexes in mapping targets.
 */
export const MAX_PROFILE_RECORDS = 20;

export interface ProfileRecordCollectionDefinition {
  /** Collection heading, e.g. "Work experience". */
  label: string;
  /** One record, numbered in the UI: "Work experience 2". */
  itemLabel: string;
  section: ProfileSection;
  /** Role of the first record, shown next to it, e.g. "primary". */
  firstRecordRole?: string;
  /**
   * Record fields that describe a record in the extension UI (e.g. "University A · Master's")
   * when the user picks a record. Chosen to identify a record without sensitive details.
   */
  summaryFields: readonly string[];
}

export const PROFILE_RECORD_COLLECTION_DEFINITIONS: Readonly<
  Record<ProfileRecordCollection, ProfileRecordCollectionDefinition>
> = {
  education: {
    label: 'Education',
    itemLabel: 'Education',
    section: 'Education',
    firstRecordRole: 'primary',
    summaryFields: ['institution', 'degree'],
  },
  workExperience: {
    label: 'Work experience',
    itemLabel: 'Work experience',
    section: 'Work experience',
    summaryFields: ['company', 'title'],
  },
  certifications: {
    label: 'Certifications',
    itemLabel: 'Certification',
    section: 'Certifications',
    summaryFields: ['name', 'issuer'],
  },
};

/** One field of every record in a collection. */
export interface ProfileRecordField {
  collection: ProfileRecordCollection;
  /** Property name inside a record. */
  field: string;
  label: string;
  kind: ProfileValueKind;
  fieldTypes: readonly FieldType[];
  /** Whether Teach Once may target this field of a specific record. */
  teachable: boolean;
  /** The scalar key that is this field of the first (primary) record, if any. */
  primaryKey?: ProfileFieldKey;
}

/** Every record field, in editor order within each collection. */
export const PROFILE_RECORD_FIELDS: readonly ProfileRecordField[] = [
  {
    collection: 'education',
    field: 'institution',
    label: 'Institution',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
    teachable: true,
    primaryKey: 'institution',
  },
  {
    collection: 'education',
    field: 'degree',
    label: 'Degree',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
    teachable: true,
    primaryKey: 'highest_degree',
  },
  {
    collection: 'education',
    field: 'fieldOfStudy',
    label: 'Field of study',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
    teachable: true,
    primaryKey: 'field_of_study',
  },
  {
    collection: 'education',
    field: 'startYear',
    label: 'Start year',
    kind: 'year',
    fieldTypes: YEAR,
    teachable: true,
  },
  {
    collection: 'education',
    field: 'graduationYear',
    label: 'Graduation year',
    kind: 'year',
    fieldTypes: YEAR,
    teachable: true,
    primaryKey: 'graduation_year',
  },

  {
    collection: 'workExperience',
    field: 'company',
    label: 'Company',
    kind: 'text',
    fieldTypes: TEXT,
    teachable: true,
  },
  {
    collection: 'workExperience',
    field: 'title',
    label: 'Job title',
    kind: 'text',
    fieldTypes: TEXT,
    teachable: true,
  },
  {
    collection: 'workExperience',
    field: 'location',
    label: 'Location',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
    teachable: true,
  },
  {
    collection: 'workExperience',
    field: 'startDate',
    label: 'Start (YYYY-MM)',
    kind: 'month',
    fieldTypes: TEXT,
    teachable: true,
  },
  {
    collection: 'workExperience',
    field: 'endDate',
    label: 'End (YYYY-MM)',
    kind: 'month',
    fieldTypes: TEXT,
    teachable: true,
  },
  {
    collection: 'workExperience',
    field: 'current',
    label: 'I currently work here',
    kind: 'boolean',
    fieldTypes: YES_NO,
    teachable: true,
  },
  {
    collection: 'workExperience',
    field: 'description',
    label: 'Description',
    kind: 'text',
    fieldTypes: ['textarea', 'text'],
    teachable: true,
  },

  {
    collection: 'certifications',
    field: 'name',
    label: 'Name',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
    teachable: true,
  },
  {
    collection: 'certifications',
    field: 'issuer',
    label: 'Issuer',
    kind: 'text',
    fieldTypes: TEXT_OR_SELECT,
    teachable: true,
  },
  {
    collection: 'certifications',
    field: 'issueYear',
    label: 'Issue year',
    kind: 'year',
    fieldTypes: YEAR,
    teachable: true,
  },
  {
    collection: 'certifications',
    field: 'credentialUrl',
    label: 'Credential URL',
    kind: 'url',
    fieldTypes: TEXT,
    teachable: true,
  },
];

export function recordFieldsOf(collection: ProfileRecordCollection): ProfileRecordField[] {
  return PROFILE_RECORD_FIELDS.filter((definition) => definition.collection === collection);
}

export function findRecordField(
  collection: ProfileRecordCollection,
  field: string,
): ProfileRecordField | undefined {
  return PROFILE_RECORD_FIELDS.find((d) => d.collection === collection && d.field === field);
}

/** A scalar field that is a field of the collection's primary record (derived, not copied). */
function primaryRecordField(
  collection: ProfileRecordCollection,
  field: string,
  label: string,
): ProfileField {
  const definition = findRecordField(collection, field);
  if (!definition) throw new Error(`Unknown record field ${collection}.${field}`);
  const { section } = PROFILE_RECORD_COLLECTION_DEFINITIONS[collection];
  return {
    label,
    path: `${collection}[0].${field}`,
    section,
    kind: definition.kind,
    fieldTypes: definition.fieldTypes,
    record: { collection, field },
  };
}

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

  highest_degree: primaryRecordField('education', 'degree', 'Highest degree'),
  field_of_study: primaryRecordField('education', 'fieldOfStudy', 'Field of study'),
  institution: primaryRecordField('education', 'institution', 'Institution'),
  graduation_year: primaryRecordField('education', 'graduationYear', 'Graduation year'),

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

export function isProfileFieldKey(value: unknown): value is ProfileFieldKey {
  return typeof value === 'string' && (PROFILE_FIELD_KEYS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------
// Mapping targets
// ---------------------------------------------------------------------------------------

/** A field of one specific record, e.g. "education[1].institution". */
export type ProfileRecordTarget = `${ProfileRecordCollection}[${number}].${string}`;

/**
 * What a mapping points to: a scalar key (automatic mappings and older saved mappings), or
 * a field of one specific record (taught mappings only). Stored in saved mappings.
 */
export type ProfileTarget = ProfileFieldKey | ProfileRecordTarget | ProfileRecordIdTarget;

/** Everything needed to show, validate, and read a target. */
export interface ProfileTargetDefinition {
  /** Canonical spelling: a primary-record field is always its scalar key. */
  target: ProfileTarget;
  /** Human-readable, e.g. "Institution" or "Education 2 → Institution". */
  label: string;
  path: string;
  kind: ProfileValueKind;
  fieldTypes: readonly FieldType[];
  choices?: readonly ProfileChoice[];
  /**
   * The record field this target reads: by position (`index`, Phase 10/11 targets) or by
   * stable record id (`recordId`, explicit record assignments). Exactly one of them is set.
   */
  record?: {
    collection: ProfileRecordCollection;
    field: string;
    index?: number;
    recordId?: string;
  };
}

/**
 * Stable record ids: random UUIDs for new records, or "m-" + 16 hex digits for records that
 * existed before ids (see migrate-profile.ts). Nothing else is accepted as a record id.
 */
const RECORD_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|m-[0-9a-f]{16})$/;

export function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID.test(value);
}

/** A field of one record identified by its stable id, e.g. "education@<id>.degree". */
export type ProfileRecordIdTarget = `${ProfileRecordCollection}@${string}.${string}`;

const RECORD_ID_TARGET = /^(education|workExperience|certifications)@([^.]+)\.([A-Za-z]+)$/;

/** Only explicit record assignments use id targets; mapping never produces them. */
export function recordIdTarget(
  collection: ProfileRecordCollection,
  recordId: string,
  field: string,
): ProfileRecordIdTarget {
  return `${collection}@${recordId}.${field}`;
}

export function isRecordIdTarget(value: unknown): value is ProfileRecordIdTarget {
  return typeof value === 'string' && RECORD_ID_TARGET.test(value) && isProfileTarget(value);
}

const RECORD_TARGET = /^(education|workExperience|certifications)\[(0|[1-9][0-9]?)\]\.([A-Za-z]+)$/;

export function recordTarget(
  collection: ProfileRecordCollection,
  index: number,
  field: string,
): ProfileTarget {
  const primaryKey = index === 0 ? findRecordField(collection, field)?.primaryKey : undefined;
  return primaryKey ?? (`${collection}[${index}].${field}` as ProfileRecordTarget);
}

/**
 * Resolves a scalar key or a record reference against the canonical definitions only.
 * Anything else (unknown keys, other paths, out-of-range indexes, "__proto__", …) is
 * undefined: targets are never interpreted as arbitrary object paths.
 */
export function resolveProfileTarget(value: unknown): ProfileTargetDefinition | undefined {
  if (isProfileFieldKey(value)) {
    const { label, path, kind, fieldTypes, choices, record } = PROFILE_FIELDS[value];
    return {
      target: value,
      label,
      path,
      kind,
      fieldTypes,
      ...(choices ? { choices } : {}),
      ...(record ? { record: { ...record, index: 0 } } : {}),
    };
  }
  if (typeof value !== 'string') return undefined;
  const byId = RECORD_ID_TARGET.exec(value);
  if (byId) {
    const collection = byId[1] as ProfileRecordCollection;
    const definition = findRecordField(collection, byId[3] ?? '');
    if (!definition || !isRecordId(byId[2])) return undefined;
    return {
      target: value as ProfileRecordIdTarget,
      // The record's current position is not known here; the UI labels it from the profile.
      label: `${PROFILE_RECORD_COLLECTION_DEFINITIONS[collection].itemLabel} → ${definition.label}`,
      path: value,
      kind: definition.kind,
      fieldTypes: definition.fieldTypes,
      record: { collection, field: definition.field, recordId: byId[2] },
    };
  }
  const match = RECORD_TARGET.exec(value);
  if (!match) return undefined;
  const collection = match[1] as ProfileRecordCollection;
  const index = Number(match[2]);
  const definition = findRecordField(collection, match[3] ?? '');
  if (!definition || index >= MAX_PROFILE_RECORDS) return undefined;
  const target = recordTarget(collection, index, definition.field);
  if (target !== value) return resolveProfileTarget(target);
  const { itemLabel } = PROFILE_RECORD_COLLECTION_DEFINITIONS[collection];
  return {
    target,
    label: `${itemLabel} ${index + 1} → ${definition.label}`,
    path: value,
    kind: definition.kind,
    fieldTypes: definition.fieldTypes,
    record: { collection, index, field: definition.field },
  };
}

export function isProfileTarget(value: unknown): value is ProfileTarget {
  return resolveProfileTarget(value) !== undefined;
}
