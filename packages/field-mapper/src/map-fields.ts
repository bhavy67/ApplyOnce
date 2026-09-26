import {
  PROFILE_FIELDS,
  type FieldMapping,
  type FormField,
  type MappingResult,
  type UnsupportedReason,
} from '@applyonce/core';
import { createFieldSignature } from './field-signature';
import type { FieldMatcher } from './matcher';

/**
 * One mapping per field, in field order:
 *
 * - no match, or "unknown" confidence → unknown (never filled)
 * - matched, but the field is hidden, disabled, or cannot hold that kind of value
 *   → unsupported
 * - high confidence → mapped; anything lower → review (needs explicit approval)
 */
export function mapFields(fields: readonly FormField[], matcher: FieldMatcher): MappingResult {
  return { mappings: fields.map((field) => mapField(field, matcher)) };
}

function mapField(field: FormField, matcher: FieldMatcher): FieldMapping {
  const match = matcher.match(createFieldSignature(field));
  if (!match || match.confidence.level === 'unknown') {
    return {
      fieldId: field.id,
      status: 'unknown',
      confidence: match?.confidence ?? { score: 0, level: 'unknown', reasons: [] },
    };
  }

  const mapping = {
    fieldId: field.id,
    profileField: match.profileField,
    confidence: match.confidence,
  };
  const unsupportedReason = findUnsupportedReason(field, match.profileField);
  if (unsupportedReason) return { ...mapping, status: 'unsupported', unsupportedReason };
  return { ...mapping, status: match.confidence.level === 'high' ? 'mapped' : 'review' };
}

function findUnsupportedReason(
  field: FormField,
  profileField: keyof typeof PROFILE_FIELDS,
): UnsupportedReason | undefined {
  if (!PROFILE_FIELDS[profileField].fieldTypes.includes(field.type)) return 'incompatible-type';
  if (!field.visible) return 'hidden';
  if (field.disabled) return 'disabled';
  return undefined;
}
