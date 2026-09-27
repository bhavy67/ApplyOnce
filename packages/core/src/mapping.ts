import type { ConfidenceResult } from './confidence';
import type { FieldType } from './field-type';
import type { ProfileFieldKey } from './profile-field';

/**
 * - mapped: high-confidence automatic match, ready to fill once the user confirms.
 * - review: a plausible automatic match that the user must explicitly approve.
 * - taught: the user taught this mapping (a saved mapping). Still needs explicit approval.
 * - unknown: no safe match. Never filled.
 * - unsupported: recognised, but this field cannot be filled (see `unsupportedReason`).
 */
export type MappingStatus = 'mapped' | 'review' | 'taught' | 'unknown' | 'unsupported';

export type UnsupportedReason =
  | 'incompatible-type'
  | 'hidden'
  | 'disabled'
  | 'readonly'
  /** A checkbox in a multi-option group (see FormField.groupSize). */
  | 'checkbox-group'
  /** A custom dropdown without the ARIA relationships needed to operate it safely. */
  | 'unsupported-control'
  /** The same question appears several times (repeated record sections). */
  | 'repeated-question';

/** Where a mapping came from: the deterministic matcher, or a mapping the user taught. */
export type MappingSource = 'automatic' | 'taught';

/** The mapping outcome for one form field. */
export interface FieldMapping {
  fieldId: string;
  status: MappingStatus;
  source: MappingSource;
  /** The best matching profile field; absent when status is "unknown". */
  profileField?: ProfileFieldKey;
  confidence: ConfidenceResult;
  unsupportedReason?: UnsupportedReason;
  /** Stable key used to save a taught mapping; absent when the field cannot be taught. */
  mappingKey?: string;
}

/** One mapping per field, in the same order as the fields. */
export interface MappingResult {
  mappings: FieldMapping[];
}

/**
 * The normalized field characteristics a saved mapping is keyed on. Only field metadata
 * (never values) and at most one of `question` or `identifier`.
 */
export interface MappingKeyParts {
  fieldType: FieldType;
  /** The field's question: label, aria-label, placeholder, or nearby text, in that order. */
  question?: string;
  /** The enclosing fieldset legend, when the question is the field's own label. */
  context?: string;
  /** Normalized name (or id). Used only when the field has no question text at all. */
  identifier?: string;
}

/** A mapping the user taught: "fields like this one map to that profile field". */
export interface SavedMapping {
  key: string;
  parts: MappingKeyParts;
  profileField: ProfileFieldKey;
  /** Hostname where the mapping was taught, for display only. Not part of the key. */
  site?: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}
