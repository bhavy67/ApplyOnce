export { CONFLICT_MIN_SCORE, createAliasMatcher, SIGNAL_WEIGHTS } from './alias-matcher';
export { AUTOCOMPLETE_TOKENS, DEFAULT_ALIASES, WEAK_ALIASES } from './aliases';
export { createFieldSignature, type FieldSignature } from './field-signature';
export { fieldStateReason, mapFields, type SavedMappingLookup } from './map-fields';
export {
  applyRecordAssignments,
  isAssignableField,
  type RecordAssignmentLookup,
} from './record-assignments';
export {
  createMappingKey,
  createMappingKeyParts,
  mappingKeyCandidates,
  mappingKeyFromParts,
} from './mapping-key';
export type { FieldMatch, FieldMatcher } from './matcher';
export {
  classifySectionHeading,
  matchRecordField,
  RECORD_FIELD_ALIASES,
  RECORD_SECTION_HEADINGS,
} from './record-sections';
export { compactText, normalizeQuestion, normalizeText, stripRequiredMarkers } from './normalize';
