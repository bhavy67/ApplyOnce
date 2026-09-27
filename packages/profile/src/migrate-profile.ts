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

type UnknownRecord = Record<string, unknown>;

/**
 * Brings a stored profile to the current schema version. Pure and idempotent:
 * migrating an up-to-date profile returns an equivalent profile. Returns undefined for
 * data it does not understand (unknown or newer version), so callers can refuse it
 * instead of overwriting it.
 *
 * Version 1 → 2: the first education entry, work mode, and employment type become the
 * primary values. Any further entries are kept under `legacy`, never dropped.
 */
export function migrateProfile(stored: unknown): Profile | undefined {
  if (!isRecord(stored)) return undefined;
  if (stored.schemaVersion === PROFILE_SCHEMA_VERSION) return withDefaults(stored);
  if (stored.schemaVersion === 1) return withDefaults(migrateV1ToV2(stored));
  return undefined;
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
    schemaVersion: PROFILE_SCHEMA_VERSION,
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

  const experience = section('experience');
  const documents = section('documents');
  const profile: Profile = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identity: section('identity'),
    contact: section('contact'),
    location: section('location'),
    education: section('education'),
    experience: {
      ...experience,
      workHistory: asArray(experience.workHistory) as Profile['experience']['workHistory'],
    },
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
