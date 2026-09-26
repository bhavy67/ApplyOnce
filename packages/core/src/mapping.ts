import type { ConfidenceResult } from './confidence';
import type { ProfileFieldKey } from './profile-field';

/** A proposed link between one form field and one profile field. */
export interface FieldMapping {
  fieldId: string;
  profileField: ProfileFieldKey;
  confidence: ConfidenceResult;
}

/**
 * Outcome of mapping a page's fields. Unmapped fields are listed explicitly because
 * they must stay untouched and be offered for manual mapping (spec §5, §20).
 */
export interface MappingResult {
  mappings: FieldMapping[];
  unmappedFieldIds: string[];
}
