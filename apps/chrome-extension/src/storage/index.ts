import { createIndexedDbStore } from './indexeddb-store';
import { createProfileRepository, type ExtensionStorageSchema } from './profile-repository';
import { createRecordAssignmentRepository } from './record-assignment-repository';
import { createSavedMappingRepository } from './saved-mapping-repository';

export const DATABASE_NAME = 'applyonce';

const openStore = () =>
  createIndexedDbStore<ExtensionStorageSchema>({ databaseName: DATABASE_NAME });

export function createBrowserProfileRepository() {
  return createProfileRepository(openStore());
}

/** Used by the service worker only, the single writer of saved mappings. */
export function createBrowserSavedMappingRepository() {
  return createSavedMappingRepository(openStore());
}

/** Used by the service worker only, the single writer of record assignments. */
export function createBrowserRecordAssignmentRepository() {
  return createRecordAssignmentRepository(openStore());
}

export { UnsupportedProfileVersionError, type ProfileRepository } from './profile-repository';
export type { RecordAssignmentRepository } from './record-assignment-repository';
export type { SavedMappingRepository } from './saved-mapping-repository';
