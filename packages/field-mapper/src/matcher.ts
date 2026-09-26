import type { ConfidenceResult, ProfileFieldKey } from '@applyonce/core';
import type { FieldSignature } from './field-signature';

export interface FieldMatch {
  profileField: ProfileFieldKey;
  confidence: ConfidenceResult;
}

/**
 * One strategy for recognizing a field. Future strategies (site rules, user-taught
 * mappings, and much later an optional AI fallback) implement the same interface.
 */
export interface FieldMatcher {
  match(signature: FieldSignature): FieldMatch | undefined;
}
