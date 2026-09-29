export * from './profile';
export { normalizeChoice } from './choices';
export { countProfileValues } from './count-profile-values';
export { createEmptyProfile } from './create-empty-profile';
export { migrateProfile } from './migrate-profile';
/** Kept here for callers from before the definitions moved to core. */
export { isProfileFieldKey } from '@applyonce/core';
export {
  addRecord,
  canAddRecord,
  getProfileValue,
  isBlankRecord,
  moveRecord,
  readStoredValue,
  recordChoices,
  recordCount,
  recordIndexById,
  removeRecord,
  updateProfileValue,
  updateRecordValue,
  type RecordChoice,
  type StoredProfileValue,
} from './profile-values';
export { derivedRecordId, newRecordId, withRecordIds } from './record-ids';
export { sanitizeProfile } from './sanitize-profile';
export {
  MAX_EXPERIENCE_YEARS,
  MIN_GRADUATION_YEAR,
  validateProfile,
  type ProfileFieldErrors,
  type ProfileValidationResult,
} from './validate-profile';
