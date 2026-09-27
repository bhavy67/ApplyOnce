import { createEmptyProfile } from './create-empty-profile';
import { normalizeChoice } from './choices';
import {
  PROFILE_SCHEMA_VERSION,
  type Education,
  type EmploymentType,
  type LegacyProfileData,
  type Profile,
  type WorkMode,
} from './profile';
import { isBlankRecord } from './profile-values';
import { withRecordIds } from './record-ids';

type UnknownRecord = Record<string, unknown>;

/**
 * Brings a stored profile to the current schema version. Pure and idempotent:
 * migrating an up-to-date profile returns an equivalent profile. Returns undefined for
 * data it does not understand (unknown or newer version), so callers can refuse it
 * instead of overwriting it.
 *
 * Version 1 → 2: the first education entry, work mode, and employment type become the
 * primary values. Any further entries are kept under `legacy`, never dropped.
 *
 * Version 2 → 3 (see migrateV2ToV3): the primary education record becomes education[0],
 * work history moves to `workExperience`, and certifications start empty.
 *
 * Version 3 → 4: every record gets a stable id (withRecordIds): records stored without one
 * get a derived id, identical on every load until the profile is saved with it. Values are
 * unchanged. Loading still never writes.
 */
export function migrateProfile(stored: unknown): Profile | undefined {
  if (!isRecord(stored)) return undefined;
  if (stored.schemaVersion === PROFILE_SCHEMA_VERSION) return withDefaults(stored);
  if (stored.schemaVersion === 3) return withDefaults(stored);
  if (stored.schemaVersion === 2) return withDefaults(migrateV2ToV3(stored));
  if (stored.schemaVersion === 1) return withDefaults(migrateV2ToV3(migrateV1ToV2(stored)));
  return undefined;
}

/**
 * - The primary education record becomes education[0], unless it is blank (no empty record
 *   is created). Education entries kept under `legacy` since version 1 follow it as
 *   education[1…], in their original order; without a primary record they stay in
 *   `legacy`, so a historical entry is never promoted to primary.
 * - `experience.workHistory` entries (never editable before) become `workExperience`,
 *   unchanged; blank ones are dropped. Current employment (current company, title, years)
 *   stays as it is: no work experience entry is created from it, and no dates are invented.
 * - `certifications` starts empty.
 */
function migrateV2ToV3(v2: UnknownRecord): UnknownRecord {
  const primary = isRecord(v2.education) ? v2.education : {};
  const legacy: UnknownRecord = isRecord(v2.legacy) ? { ...v2.legacy } : {};
  const education: UnknownRecord[] = [];
  if (!isBlankRecord(primary)) {
    education.push(primary);
    const earlier = asArray(legacy.education).filter(
      (entry): entry is UnknownRecord => isRecord(entry) && !isBlankRecord(entry),
    );
    education.push(...earlier);
    delete legacy.education;
  }
  const { workHistory, ...currentEmployment } = isRecord(v2.experience) ? v2.experience : {};
  const workExperience = asArray(workHistory).filter(
    (entry): entry is UnknownRecord => isRecord(entry) && !isBlankRecord(entry),
  );

  const migrated: UnknownRecord = {
    ...v2,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    education,
    experience: currentEmployment,
    workExperience,
    certifications: [],
  };
  delete migrated.legacy;
  if (Object.keys(legacy).length > 0) migrated.legacy = legacy;
  return migrated;
}

function migrateV1ToV2(v1: UnknownRecord): UnknownRecord {
  const educationList = asArray(v1.education).filter(
    (entry): entry is Education => isRecord(entry) && Object.keys(entry).length > 0,
  );
  const preferences = isRecord(v1.preferences) ? v1.preferences : {};
  const workModes = asArray(preferences.workModes).filter((m) => typeof m === 'string');
  const employmentTypes = asArray(preferences.employmentTypes).filter((t) => typeof t === 'string');

  const [primaryEducation, ...otherEducation] = educationList;
  const [workMode, ...otherWorkModes] = workModes;
  const [employmentType, ...otherEmploymentTypes] = employmentTypes;

  const legacy: LegacyProfileData = {
    ...(otherEducation.length > 0 ? { education: otherEducation } : {}),
    ...(otherWorkModes.length > 0 ? { workModes: otherWorkModes } : {}),
    ...(otherEmploymentTypes.length > 0 ? { employmentTypes: otherEmploymentTypes } : {}),
  };

  const otherPreferences = Object.fromEntries(
    Object.entries(preferences).filter(([key]) => key !== 'workModes' && key !== 'employmentTypes'),
  );
  const normalizedWorkMode = normalizeChoice('work_mode', workMode) as WorkMode | undefined;
  const normalizedEmploymentType = normalizeChoice('employment_type', employmentType) as
    EmploymentType | undefined;

  return {
    ...v1,
    schemaVersion: 2,
    education: primaryEducation ?? {},
    preferences: {
      ...otherPreferences,
      ...(normalizedWorkMode ? { workMode: normalizedWorkMode } : {}),
      ...(normalizedEmploymentType ? { employmentType: normalizedEmploymentType } : {}),
    },
    ...(Object.keys(legacy).length > 0 ? { legacy } : {}),
  };
}

/** Fills in missing sections with safe empty defaults; existing values are untouched. */
function withDefaults(stored: UnknownRecord): Profile {
  const empty = createEmptyProfile();
  const section = <K extends keyof Profile>(key: K): Profile[K] => {
    const fallback: unknown = empty[key];
    const value: unknown = stored[key];
    if (isRecord(fallback) && isRecord(value))
      return { ...fallback, ...value } as unknown as Profile[K];
    if (Array.isArray(fallback) && Array.isArray(value)) return value as Profile[K];
    return fallback as Profile[K];
  };

  const records = <K extends 'education' | 'workExperience' | 'certifications'>(key: K) =>
    withRecordIds(key, asArray(stored[key]).filter(isRecord)) as unknown as Profile[K];
  const documents = section('documents');
  const profile: Profile = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identity: section('identity'),
    contact: section('contact'),
    location: section('location'),
    education: records('education'),
    experience: section('experience'),
    workExperience: records('workExperience'),
    certifications: records('certifications'),
    links: section('links'),
    preferences: section('preferences'),
    authorization: section('authorization'),
    documents: {
      resumes: asArray(documents.resumes) as Profile['documents']['resumes'],
      coverLetters: asArray(documents.coverLetters) as Profile['documents']['coverLetters'],
    },
    customAnswers: section('customAnswers'),
  };
  if (isRecord(stored.legacy)) profile.legacy = stored.legacy as LegacyProfileData;
  return profile;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
