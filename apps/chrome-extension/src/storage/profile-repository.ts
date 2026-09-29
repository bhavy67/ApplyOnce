import type { LocalStore } from '@applyonce/core';
import { createEmptyProfile, migrateProfile, type Profile } from '@applyonce/profile';
import type { RecordAssignmentsRecord } from './record-assignment-repository';
import type { SavedMappingsRecord } from './saved-mapping-repository';

/** Everything the extension persists locally, by storage key. */
export interface ExtensionStorageSchema {
  profile: Profile;
  /** Teach Once mappings. Independent of the profile: clearing one never touches the other. */
  savedMappings: SavedMappingsRecord;
  /** Explicit record assignments for repeated fields. Separate from both records above. */
  recordAssignments: RecordAssignmentsRecord;
}

export interface ProfileRepository {
  /** The saved profile, or an empty profile when nothing has been saved yet. */
  load(): Promise<Profile>;
  save(profile: Profile): Promise<void>;
  clear(): Promise<void>;
}

export class UnsupportedProfileVersionError extends Error {
  constructor(readonly storedVersion: unknown) {
    super(`Saved profile has unsupported schema version ${String(storedVersion)}`);
    this.name = 'UnsupportedProfileVersionError';
  }
}

/** A stored profile of a known version whose content is malformed; refused, never repaired. */
export class CorruptedProfileError extends Error {
  constructor() {
    super('Saved profile is corrupted');
    this.name = 'CorruptedProfileError';
  }
}

const KNOWN_VERSIONS: readonly unknown[] = [1, 2, 3, 4];

export function createProfileRepository(
  store: LocalStore<ExtensionStorageSchema>,
): ProfileRepository {
  return {
    async load() {
      const stored: unknown = await store.get('profile');
      if (stored === undefined) return createEmptyProfile();
      // Older versions are migrated in memory; the migrated profile is written on the next
      // save. Data we do not understand is refused, never silently discarded.
      const profile = migrateProfile(stored);
      if (!profile) {
        const version =
          typeof stored === 'object' && stored !== null && 'schemaVersion' in stored
            ? stored.schemaVersion
            : undefined;
        // Data of a known version that cannot be read is corrupted: refused as a whole.
        if (KNOWN_VERSIONS.includes(version)) throw new CorruptedProfileError();
        throw new UnsupportedProfileVersionError(version);
      }
      return profile;
    },
    save: (profile) => store.set('profile', profile),
    clear: () => store.remove('profile'),
  };
}
