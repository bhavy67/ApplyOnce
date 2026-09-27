import {
  resolveProfileTarget,
  type ConfidenceResult,
  type FieldMapping,
  type FormField,
  type MappingResult,
  type ProfileTarget,
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
  const target = saved && usableSavedTarget(saved, field);
  if (target) {
    return withStatus(
      {
        ...base,
        source: 'taught',
        profileField: target,
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

/**
 * Saved data is re-validated on every use: a canonical target (scalar key or record
 * field), the same field type, and a type that can hold it. Returns the canonical target.
 */
function usableSavedTarget(saved: SavedMapping, field: FormField): ProfileTarget | undefined {
  const definition = resolveProfileTarget(saved.profileField);
  const usable =
    saved.parts.fieldType === field.type && definition?.fieldTypes.includes(field.type) === true;
  return usable ? definition.target : undefined;
}

function withStatus(
  mapping: Omit<FieldMapping, 'status'> & { profileField: ProfileTarget },
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
  profileField: ProfileTarget,
): UnsupportedReason | undefined {
  if (!resolveProfileTarget(profileField)?.fieldTypes.includes(field.type)) {
    return 'incompatible-type';
  }
  if (field.type === 'checkbox' && (field.groupSize ?? 1) > 1) return 'checkbox-group';
  if (field.custom && !field.custom.supported) return 'unsupported-control';
  if ((field.repeatedCount ?? 1) > 1) return 'repeated-question';
  if (!field.visible) return 'hidden';
  if (field.disabled) return 'disabled';
  if (field.readOnly) return 'readonly';
  return undefined;
}
