import {
  PROFILE_FIELDS,
  type ConfidenceResult,
  type FieldMapping,
  type FormField,
  type MappingResult,
  type ProfileFieldKey,
  type SavedMapping,
  type UnsupportedReason,
} from '@applyonce/core';
import { createFieldSignature } from './field-signature';
import { mappingKeyCandidates } from './mapping-key';
import type { FieldMatcher } from './matcher';

/** Saved mappings by key. */
export type SavedMappingLookup = ReadonlyMap<string, SavedMapping>;

const TAUGHT_CONFIDENCE: ConfidenceResult = {
  score: 100,
  level: 'high',
  reasons: ['user-mapping'],
};

/**
 * One mapping per field, in field order. Precedence:
 *
 * 1. A saved mapping with this field's exact key, if its profile field suits the field
 *    type → taught. A saved mapping that does not fit is ignored.
 * 2. The deterministic matcher: high confidence → mapped; lower → review.
 * 3. Otherwise → unknown (never filled).
 *
 * A match the field cannot currently be filled with (hidden, disabled, read-only, a
 * multi-option checkbox group, or the wrong kind of field) is reported as unsupported,
 * whatever its source.
 */
export function mapFields(
  fields: readonly FormField[],
  matcher: FieldMatcher,
  savedMappings: SavedMappingLookup = new Map(),
): MappingResult {
  return { mappings: fields.map((field) => mapField(field, matcher, savedMappings)) };
}

function mapField(
  field: FormField,
  matcher: FieldMatcher,
  savedMappings: SavedMappingLookup,
): FieldMapping {
  const [mappingKey, ...legacyKeys] = mappingKeyCandidates(field);
  const base = { fieldId: field.id, ...(mappingKey ? { mappingKey } : {}) };

  const saved = [mappingKey, ...legacyKeys]
    .map((key) => (key ? savedMappings.get(key) : undefined))
    .find((mapping) => mapping !== undefined);
  if (saved && isUsableSavedMapping(saved, field)) {
    return withStatus(
      {
        ...base,
        source: 'taught',
        profileField: saved.profileField,
        confidence: TAUGHT_CONFIDENCE,
      },
      field,
      'taught',
    );
  }

  const match = matcher.match(createFieldSignature(field));
  if (!match || match.confidence.level === 'unknown') {
    return {
      ...base,
      status: 'unknown',
      source: 'automatic',
      confidence: match?.confidence ?? { score: 0, level: 'unknown', reasons: [] },
    };
  }
  return withStatus(
    {
      ...base,
      source: 'automatic',
      profileField: match.profileField,
      confidence: match.confidence,
    },
    field,
    match.confidence.level === 'high' ? 'mapped' : 'review',
  );
}

/** Saved data is re-validated on every use: same field type, and a type that can hold it. */
function isUsableSavedMapping(saved: SavedMapping, field: FormField): boolean {
  const definition = Object.hasOwn(PROFILE_FIELDS, saved.profileField)
    ? PROFILE_FIELDS[saved.profileField]
    : undefined;
  return (
    saved.parts.fieldType === field.type && definition?.fieldTypes.includes(field.type) === true
  );
}

function withStatus(
  mapping: Omit<FieldMapping, 'status'> & { profileField: ProfileFieldKey },
  field: FormField,
  status: 'mapped' | 'review' | 'taught',
): FieldMapping {
  const unsupportedReason = findUnsupportedReason(field, mapping.profileField);
  return unsupportedReason
    ? { ...mapping, status: 'unsupported', unsupportedReason }
    : { ...mapping, status };
}

function findUnsupportedReason(
  field: FormField,
  profileField: ProfileFieldKey,
): UnsupportedReason | undefined {
  if (!PROFILE_FIELDS[profileField].fieldTypes.includes(field.type)) return 'incompatible-type';
  if (field.type === 'checkbox' && (field.groupSize ?? 1) > 1) return 'checkbox-group';
  if (!field.visible) return 'hidden';
  if (field.disabled) return 'disabled';
  if (field.readOnly) return 'readonly';
  return undefined;
}
