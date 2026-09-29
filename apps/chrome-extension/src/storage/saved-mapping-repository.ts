import {
  isFieldType,
  isRecordIdTarget,
  resolveProfileTarget,
  type LocalStore,
  type MappingKeyParts,
  type SavedMapping,
} from '@applyonce/core';
import { mappingKeyFromParts } from '@applyonce/field-mapper';
import type { ExtensionStorageSchema } from './profile-repository';

/** Bump when the stored shape changes; unknown versions are refused, never discarded. */
export const SAVED_MAPPINGS_VERSION = 1;

/** All saved mappings, stored as one record (a few hundred entries at most). */
export interface SavedMappingsRecord {
  version: typeof SAVED_MAPPINGS_VERSION;
  mappings: SavedMapping[];
}

export interface SaveMappingInput {
  parts: MappingKeyParts;
  /**
   * A canonical profile field key or record field (e.g. "education[1].institution");
   * validated, and stored in canonical form, before anything is stored.
   */
  profileField: string;
  site?: string;
}

export type SaveMappingError = 'invalid-profile-field' | 'incompatible-field-type';

export type SaveMappingResult =
  { ok: true; mapping: SavedMapping } | { ok: false; error: SaveMappingError };

export interface SavedMappingRepository {
  /** Newest first. */
  list(): Promise<SavedMapping[]>;
  get(key: string): Promise<SavedMapping | undefined>;
  /** Creates or replaces the mapping for these key parts (one mapping per key). */
  save(input: SaveMappingInput): Promise<SaveMappingResult>;
  /** Resolves to whether a mapping was removed. */
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
}

/** Stored saved mappings of a known version whose content is malformed; refused, never repaired. */
export class CorruptedSavedMappingsError extends Error {
  constructor() {
    super('Saved mappings are corrupted');
    this.name = 'CorruptedSavedMappingsError';
  }
}

const isText = (value: unknown, max = 10_000) => typeof value === 'string' && value.length <= max;
const isOptionalText = (value: unknown) => value === undefined || isText(value);

/**
 * One stored mapping exactly as this repository writes it: only known keys, key parts of a
 * real field type, a key that matches its parts, a short target that is never a record id,
 * and timestamps. Anything else means the store was changed outside ApplyOnce.
 */
export function isStoredSavedMapping(value: unknown): value is SavedMapping {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const keys = ['key', 'parts', 'profileField', 'site', 'createdAt', 'updatedAt'];
  if (!Object.keys(entry).every((k) => keys.includes(k))) return false;
  const parts = entry.parts as Record<string, unknown> | null;
  if (typeof parts !== 'object' || parts === null || Array.isArray(parts)) return false;
  if (
    !Object.keys(parts).every((k) => ['fieldType', 'question', 'context', 'identifier'].includes(k))
  )
    return false;
  return (
    typeof parts.fieldType === 'string' &&
    isFieldType(parts.fieldType) &&
    isOptionalText(parts.question) &&
    isOptionalText(parts.context) &&
    isOptionalText(parts.identifier) &&
    entry.key === mappingKeyFromParts(parts as unknown as MappingKeyParts) &&
    // A target this version does not know (e.g. after a downgrade) is kept and listed, so it
    // can be deleted; it is never used for filling (only canonical targets resolve).
    isText(entry.profileField, 200) &&
    !isRecordIdTarget(entry.profileField) &&
    (entry.site === undefined ||
      (isText(entry.site, 253) && /^[a-z0-9.-]+$/i.test(entry.site as string))) &&
    isText(entry.createdAt, 64) &&
    isText(entry.updatedAt, 64)
  );
}

export class UnsupportedSavedMappingsVersionError extends Error {
  constructor(readonly storedVersion: unknown) {
    super(`Saved mappings have unsupported version ${String(storedVersion)}`);
    this.name = 'UnsupportedSavedMappingsVersionError';
  }
}

/**
 * Saved (taught) mappings over the extension's LocalStore. Stores only key parts
 * (normalized field metadata), a profile field key, an optional hostname, and timestamps:
 * never form values or profile values.
 *
 * Writes are serialized, so concurrent saves or deletes never lose each other.
 */
export function createSavedMappingRepository(
  store: LocalStore<ExtensionStorageSchema>,
  now: () => Date = () => new Date(),
): SavedMappingRepository {
  let writes: Promise<unknown> = Promise.resolve();

  async function read(): Promise<SavedMapping[]> {
    const record = await store.get('savedMappings');
    if (record === undefined) return [];
    if ((record as { version?: unknown } | null)?.version !== SAVED_MAPPINGS_VERSION) {
      throw new UnsupportedSavedMappingsVersionError(
        (record as { version?: unknown } | null)?.version,
      );
    }
    // Every entry is checked; one malformed entry refuses the whole record (fail closed:
    // nothing is guessed, dropped, or overwritten by the next write).
    const { mappings } = record as { mappings: unknown };
    if (
      !Array.isArray(mappings) ||
      !mappings.every(isStoredSavedMapping) ||
      new Set(mappings.map((m) => m.key)).size !== mappings.length
    ) {
      throw new CorruptedSavedMappingsError();
    }
    return mappings;
  }

  function write(mappings: SavedMapping[]) {
    return store.set('savedMappings', { version: SAVED_MAPPINGS_VERSION, mappings });
  }

  /** Runs read-modify-write operations one at a time. */
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = writes.then(operation);
    writes = result.catch(() => undefined);
    return result;
  }

  return {
    async list() {
      const mappings = await read();
      return [...mappings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async get(key) {
      return (await read()).find((mapping) => mapping.key === key);
    },

    save({ parts, profileField, site }) {
      const target = resolveProfileTarget(profileField);
      if (!target) {
        return Promise.resolve({ ok: false, error: 'invalid-profile-field' });
      }
      if (!target.fieldTypes.includes(parts.fieldType)) {
        return Promise.resolve({ ok: false, error: 'incompatible-field-type' });
      }
      return serialized(async () => {
        const key = mappingKeyFromParts(parts);
        const mappings = await read();
        const existing = mappings.find((mapping) => mapping.key === key);
        const timestamp = now().toISOString();
        const mapping: SavedMapping = {
          key,
          parts: pickKeyParts(parts),
          profileField: target.target,
          ...(site ? { site } : {}),
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        await write([...mappings.filter((m) => m.key !== key), mapping]);
        return { ok: true as const, mapping };
      });
    },

    delete(key) {
      return serialized(async () => {
        const mappings = await read();
        const remaining = mappings.filter((mapping) => mapping.key !== key);
        if (remaining.length === mappings.length) return false;
        await write(remaining);
        return true;
      });
    },

    clear() {
      return serialized(() => store.remove('savedMappings'));
    },
  };
}

/** Copies only the known key-part fields, so nothing else can be persisted by accident. */
function pickKeyParts({
  fieldType,
  question,
  context,
  identifier,
}: MappingKeyParts): MappingKeyParts {
  return {
    fieldType,
    ...(question ? { question } : {}),
    ...(context ? { context } : {}),
    ...(identifier ? { identifier } : {}),
  };
}
