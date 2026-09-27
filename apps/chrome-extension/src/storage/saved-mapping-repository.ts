import {
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
    if (record.version !== SAVED_MAPPINGS_VERSION) {
      throw new UnsupportedSavedMappingsVersionError(record.version);
    }
    return record.mappings;
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
