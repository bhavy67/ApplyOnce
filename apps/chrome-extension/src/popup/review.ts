import {
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  type ConfidenceLevel,
  type FieldType,
  type FillResult,
  type FillStatus,
  type ProfileFieldKey,
} from '@applyonce/core';
import { PROFILE_FIELD_PATHS } from '@applyonce/profile';
import type { ReviewedMapping } from '../messaging/protocol';

export const CONFIDENCE_LABELS: Readonly<Record<ConfidenceLevel, string>> = {
  high: 'High confidence',
  review: 'Medium confidence',
  confirm: 'Low confidence',
  unknown: 'Unknown',
};

export const FILL_STATUS_LABELS: Readonly<Record<FillStatus, string>> = {
  filled: 'Filled',
  skipped: 'Skipped',
  failed: 'Failed',
  'not-found': 'Not found',
  unsupported: 'Not supported',
};

const FILLABLE_STATUSES: ReadonlySet<string> = new Set(['mapped', 'review', 'taught']);

/** Only matched or taught fields with a profile value can be selected; unknown fields never. */
export function isSelectable(mapping: ReviewedMapping): boolean {
  return (
    FILLABLE_STATUSES.has(mapping.status) && mapping.profileField !== undefined && mapping.hasValue
  );
}

/**
 * High-confidence automatic matches start selected. Review-level and taught mappings need
 * an explicit click: teaching a mapping never means filling it.
 */
export function initialSelection(mappings: readonly ReviewedMapping[]): Set<string> {
  return new Set(
    mappings.filter((m) => m.status === 'mapped' && isSelectable(m)).map((m) => m.fieldId),
  );
}

export function profileFieldDescription(mapping: ReviewedMapping): string | undefined {
  if (!mapping.profileField) return undefined;
  return `${PROFILE_FIELDS[mapping.profileField].label} (${PROFILE_FIELD_PATHS[mapping.profileField]})`;
}

/** Distinguishes what the user taught from what was inferred automatically. */
export function mappingSourceLabel(mapping: ReviewedMapping): string | undefined {
  if (mapping.source === 'taught') return 'Taught by you';
  if (mapping.status === 'unknown') return undefined;
  return `Automatic · ${CONFIDENCE_LABELS[mapping.confidence.level]}`;
}

/** Teach/Change is offered when the field has a stable key and is not hidden or disabled. */
export function canTeach(mapping: ReviewedMapping): boolean {
  if (!mapping.mappingKey) return false;
  return !(mapping.status === 'unsupported' && mapping.unsupportedReason !== 'incompatible-type');
}

export function teachActionLabel(mapping: ReviewedMapping): 'Teach' | 'Change' {
  return mapping.status === 'mapped' || mapping.status === 'taught' ? 'Change' : 'Teach';
}

/** Profile fields a field of this type can hold, from the canonical field definitions. */
export function teachOptions(fieldType: FieldType): { key: ProfileFieldKey; label: string }[] {
  return PROFILE_FIELD_KEYS.filter((key) => PROFILE_FIELDS[key].fieldTypes.includes(fieldType)).map(
    (key) => ({ key, label: PROFILE_FIELDS[key].label }),
  );
}

export function mappingNote(mapping: ReviewedMapping, selected: boolean): string {
  switch (mapping.status) {
    case 'unknown':
      return 'No safe match. Will not be filled.';
    case 'unsupported':
      return mapping.unsupportedReason === 'hidden'
        ? 'Hidden field. Will not be filled.'
        : mapping.unsupportedReason === 'disabled'
          ? 'Disabled field. Will not be filled.'
          : 'This field cannot hold that value.';
    default:
      if (!mapping.hasValue) return 'No value in your profile.';
      if (selected) return 'Ready to fill';
      if (mapping.status === 'taught') return 'Taught by you. Select to fill.';
      return mapping.status === 'review' ? 'Needs review. Select to fill.' : 'Not selected';
  }
}

export interface ReviewSummary {
  ready: number;
  needsReview: number;
  unknown: number;
  missingValue: number;
}

export function summarizeReview(
  mappings: readonly ReviewedMapping[],
  selected: ReadonlySet<string>,
): ReviewSummary {
  const matched = mappings.filter((m) => FILLABLE_STATUSES.has(m.status));
  return {
    ready: mappings.filter((m) => selected.has(m.fieldId)).length,
    needsReview: matched.filter(
      (m) => m.status !== 'mapped' && m.hasValue && !selected.has(m.fieldId),
    ).length,
    unknown: mappings.filter((m) => m.status === 'unknown').length,
    missingValue: matched.filter((m) => !m.hasValue).length,
  };
}

export interface FillSummary {
  filled: number;
  skipped: number;
  failed: number;
}

export function summarizeFillResults(results: readonly FillResult[]): FillSummary {
  return {
    filled: results.filter((r) => r.status === 'filled').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => !['filled', 'skipped'].includes(r.status)).length,
  };
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
