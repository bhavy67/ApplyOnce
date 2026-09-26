import type { ConfidenceResult } from './confidence';
import type { ProfileFieldKey } from './profile-field';

/**
 * - mapped: high-confidence match, ready to fill once the user confirms.
 * - review: a plausible match that the user must explicitly approve.
 * - unknown: no safe match. Never filled.
 * - unsupported: recognised, but this field cannot be filled (see `unsupportedReason`).
 */
export type MappingStatus = 'mapped' | 'review' | 'unknown' | 'unsupported';

export type UnsupportedReason = 'incompatible-type' | 'hidden' | 'disabled';

/** The mapping outcome for one form field. */
export interface FieldMapping {
  fieldId: string;
  status: MappingStatus;
  /** The best matching profile field; absent when status is "unknown". */
  profileField?: ProfileFieldKey;
  confidence: ConfidenceResult;
  unsupportedReason?: UnsupportedReason;
}

/** One mapping per field, in the same order as the fields. */
export interface MappingResult {
  mappings: FieldMapping[];
}
