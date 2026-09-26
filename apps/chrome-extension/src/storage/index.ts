import { createIndexedDbStore } from './indexeddb-store';
import { createProfileRepository, type ExtensionStorageSchema } from './profile-repository';

export const DATABASE_NAME = 'applyonce';

export function createBrowserProfileRepository() {
  return createProfileRepository(
    createIndexedDbStore<ExtensionStorageSchema>({ databaseName: DATABASE_NAME }),
  );
}

export { UnsupportedProfileVersionError, type ProfileRepository } from './profile-repository';
