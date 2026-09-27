import {
  findRecordField,
  MAX_PROFILE_RECORDS,
  resolveProfileTarget,
  type FillValue,
  type ProfileRecordCollection,
  type ProfileTarget,
} from '@applyonce/core';
import type { Profile } from './profile';

/** A value as stored in the profile (what the editor shows), before fill normalization. */
export type StoredProfileValue = string | number | boolean;

/**
 * The value to fill for a profile target (a scalar key such as "city", or one record's
 * field such as "education[1].institution"), or undefined when the profile has none: blank
 * text, a record that does not exist, or a target that is not canonical. Paths come only
 * from the canonical definitions, never from the caller.
 *
 * `full_name` falls back to first, middle, and last name when no explicit full name is set.
 */
export function getProfileValue(profile: Profile, target: string): FillValue | undefined {
  const definition = resolveProfileTarget(target);
  if (!definition) return undefined;
  const value = readProfilePath(profile, definition.path);
  if (value !== undefined || definition.target !== 'full_name') return value;

  const { firstName, middleName, lastName } = profile.identity;
  const parts = [firstName, middleName, lastName].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Reads a canonical path such as "location.city" or "education[1].institution". Only own
 * properties and in-range list indexes are followed, and only scalar values are returned,
 * so paths like "__proto__" or ones ending at an object or list yield undefined.
 */
export function readProfilePath(profile: Profile, path: string): FillValue | undefined {
  const value = readRaw(profile, path);
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return undefined;
}

/** The stored value exactly as entered (no trimming), for the profile editor. */
export function readStoredValue(
  profile: Profile,
  target: ProfileTarget,
): StoredProfileValue | undefined {
  const definition = resolveProfileTarget(target);
  if (!definition) return undefined;
  const value = readRaw(profile, definition.path);
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

/**
 * A copy of the profile with one canonical target set (undefined removes it). Only
 * canonical targets are accepted, so arbitrary paths can never be written. A primary
 * education field writes education[0], creating that record if there is none yet.
 */
export function updateProfileValue(
  profile: Profile,
  target: ProfileTarget,
  value: StoredProfileValue | undefined,
): Profile {
  const definition = resolveProfileTarget(target);
  if (!definition) throw new Error('Unknown profile field');
  if (definition.record) {
    const { collection, index, field } = definition.record;
    return updateRecordValue(profile, collection, index, field, value);
  }
  const [section, property] = splitPath(definition.path);
  const current = profile[section] as unknown as Record<string, unknown>;
  const others = Object.entries(current).filter(([name]) => name !== property);
  const next = Object.fromEntries(value === undefined ? others : [...others, [property, value]]);
  return { ...profile, [section]: next };
}

// ---------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------

type RecordList = Record<string, unknown>[];

function recordsOf(profile: Profile, collection: ProfileRecordCollection): RecordList {
  return profile[collection] as unknown as RecordList;
}

function withRecords(
  profile: Profile,
  collection: ProfileRecordCollection,
  records: RecordList,
): Profile {
  return { ...profile, [collection]: records };
}

export function recordCount(profile: Profile, collection: ProfileRecordCollection): number {
  return recordsOf(profile, collection).length;
}

/** Whether a collection can take another record (see MAX_PROFILE_RECORDS). */
export function canAddRecord(profile: Profile, collection: ProfileRecordCollection): boolean {
  return recordCount(profile, collection) < MAX_PROFILE_RECORDS;
}

/** Appends an empty record for editing. Blank records are dropped when the profile is saved. */
export function addRecord(profile: Profile, collection: ProfileRecordCollection): Profile {
  if (!canAddRecord(profile, collection)) return profile;
  return withRecords(profile, collection, [...recordsOf(profile, collection), {}]);
}

export function removeRecord(
  profile: Profile,
  collection: ProfileRecordCollection,
  index: number,
): Profile {
  const records = recordsOf(profile, collection);
  if (!Number.isInteger(index) || index < 0 || index >= records.length) return profile;
  return withRecords(
    profile,
    collection,
    records.filter((_, i) => i !== index),
  );
}

/** Swaps a record with its neighbour (offset -1 = up, 1 = down); out of range is a no-op. */
export function moveRecord(
  profile: Profile,
  collection: ProfileRecordCollection,
  index: number,
  offset: -1 | 1,
): Profile {
  const records = [...recordsOf(profile, collection)];
  const other = index + offset;
  const [a, b] = [records[index], records[other]];
  if (a === undefined || b === undefined) return profile;
  records[index] = b;
  records[other] = a;
  return withRecords(profile, collection, records);
}

/**
 * Sets (or with undefined, removes) one field of one record. Only defined record fields are
 * accepted. Writing to the index just past the end creates that record; further out is an
 * error.
 */
export function updateRecordValue(
  profile: Profile,
  collection: ProfileRecordCollection,
  index: number,
  field: string,
  value: StoredProfileValue | undefined,
): Profile {
  if (!findRecordField(collection, field)) throw new Error('Unknown record field');
  const records = recordsOf(profile, collection);
  if (!Number.isInteger(index) || index < 0 || index > records.length) {
    throw new Error('Record index out of range');
  }
  if (index === records.length) {
    if (value === undefined) return profile;
    if (!canAddRecord(profile, collection)) throw new Error('Too many records');
  }
  const current = records[index] ?? {};
  const others = Object.entries(current).filter(([name]) => name !== field);
  const next = Object.fromEntries(value === undefined ? others : [...others, [field, value]]);
  const updated = [...records];
  updated[index] = next;
  return withRecords(profile, collection, updated);
}

/** A record with no entered value (blank text counts as none). */
export function isBlankRecord(record: object): boolean {
  return Object.values(record).every(
    (value) => value === undefined || (typeof value === 'string' && value.trim() === ''),
  );
}

// ---------------------------------------------------------------------------------------

type ProfileSectionKey = keyof Omit<Profile, 'schemaVersion'>;

function splitPath(path: string): [ProfileSectionKey, string] {
  const [section, property, ...rest] = path.split('.');
  if (!section || !property || rest.length > 0) throw new Error('Invalid canonical path');
  return [section as ProfileSectionKey, property];
}

const SEGMENT = /^([A-Za-z]+)(?:\[(\d+)\])?$/;

function readRaw(profile: Profile, path: string): unknown {
  let current: unknown = profile;
  for (const segment of path.split('.')) {
    const match = SEGMENT.exec(segment);
    if (!match?.[1]) return undefined;
    current = ownProperty(current, match[1]);
    if (match[2] !== undefined) {
      const index = Number(match[2]);
      if (!Array.isArray(current) || index >= current.length) return undefined;
      current = current[index];
    }
  }
  return current;
}

function ownProperty(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.hasOwn(value, name) ? (value as Record<string, unknown>)[name] : undefined;
}
