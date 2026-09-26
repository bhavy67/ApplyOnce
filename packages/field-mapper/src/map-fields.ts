import type { FieldMapping, FormField, MappingResult } from '@applyonce/core';
import { createFieldSignature } from './field-signature';
import type { FieldMatcher } from './matcher';

/**
 * Map each field with the given matcher. Fields that cannot be matched, or only with
 * "unknown" confidence, are reported as unmapped so they stay untouched.
 */
export function mapFields(fields: readonly FormField[], matcher: FieldMatcher): MappingResult {
  const mappings: FieldMapping[] = [];
  const unmappedFieldIds: string[] = [];

  for (const field of fields) {
    const match = matcher.match(createFieldSignature(field));
    if (!match || match.confidence.level === 'unknown') {
      unmappedFieldIds.push(field.id);
      continue;
    }
    mappings.push({ fieldId: field.id, ...match });
  }

  return { mappings, unmappedFieldIds };
}
