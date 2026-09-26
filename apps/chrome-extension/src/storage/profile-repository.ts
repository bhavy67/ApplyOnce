import type { LocalStore } from '@applyonce/core';
import { createEmptyProfile, PROFILE_SCHEMA_VERSION, type Profile } from '@applyonce/profile';
import type { SavedMappingsRecord } from './saved-mapping-repository';

/** Everything the extension persists locally, by storage key. */
export interface ExtensionStorageSchema {
  profile: Profile;
  /** Teach Once mappings. Independent of the profile: clearing one never touches the other. */
  savedMappings: SavedMappingsRecord;
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

export function createProfileRepository(
  store: LocalStore<ExtensionStorageSchema>,
): ProfileRepository {
  return {
    async load() {
      const stored = await store.get('profile');
      if (stored === undefined) return createEmptyProfile();
      // When PROFILE_SCHEMA_VERSION is bumped, migrate older versions here. Never
      // silently discard a profile we do not understand.
      if (stored.schemaVersion !== PROFILE_SCHEMA_VERSION) {
        throw new UnsupportedProfileVersionError(stored.schemaVersion);
      }
      return stored;
    },
    save: (profile) => store.set('profile', profile),
    clear: () => store.remove('profile'),
  };
}
