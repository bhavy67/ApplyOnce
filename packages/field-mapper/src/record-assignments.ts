import type {
  ConfidenceResult,
  FieldMapping,
  FormField,
  ProfileRecordIdTarget,
} from '@applyonce/core';
import { fieldStateReason } from './map-fields';

/**
 * The user's record assignment for a field, as looked up by the caller: an id target, or
 * "unavailable" when the assigned record no longer exists. Undefined when there is none.
 */
export type RecordAssignmentLookup = (
  field: FormField,
) => ProfileRecordIdTarget | 'unavailable' | undefined;

const ASSIGNED_CONFIDENCE: ConfidenceResult = {
  score: 100,
  level: 'high',
  reasons: ['user-assignment'],
};

/**
 * Whether a field can take an explicit record assignment: a question asked more than once
 * without record context, which the mapper left unsupported. Nothing else can.
 */
export function isAssignableField(field: FormField, mapping: FieldMapping): boolean {
  return (
    !field.record &&
    (field.repeatedCount ?? 1) > 1 &&
    mapping.status === 'unsupported' &&
    mapping.unsupportedReason === 'repeated-question'
  );
}

/**
 * Applies explicit record assignments on top of deterministic mapping (`mapFields`), which
 * never chooses a record for a repeated field. Only assignable fields change:
 *
 * - assigned to an existing record → status "assigned" (source "assigned"): fillable only
 *   after the user selects it, like every taught or review mapping;
 * - assigned to a deleted record → unsupported, "assignment-unavailable": never filled and
 *   never redirected to another record;
 * - the field's state still applies (type compatibility, hidden, disabled, read-only).
 */
export function applyRecordAssignments(
  fields: readonly FormField[],
  mappings: readonly FieldMapping[],
  lookup: RecordAssignmentLookup,
): FieldMapping[] {
  return mappings.map((mapping, index) => {
    const field = fields[index];
    if (!field || !isAssignableField(field, mapping)) return mapping;
    const assigned = lookup(field);
    if (!assigned) return mapping;
    if (assigned === 'unavailable') {
      return { ...mapping, source: 'assigned', unsupportedReason: 'assignment-unavailable' };
    }
    const base = {
      fieldId: mapping.fieldId,
      source: 'assigned' as const,
      profileField: assigned,
      confidence: ASSIGNED_CONFIDENCE,
    };
    const unsupportedReason = fieldStateReason(field, assigned);
    return unsupportedReason
      ? { ...base, status: 'unsupported' as const, unsupportedReason }
      : { ...base, status: 'assigned' as const };
  });
}
