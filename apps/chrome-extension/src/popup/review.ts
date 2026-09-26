import {
  PROFILE_FIELDS,
  type ConfidenceLevel,
  type FillResult,
  type FillStatus,
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

/** Only matched fields with a profile value can be selected; unknown fields never. */
export function isSelectable(mapping: ReviewedMapping): boolean {
  return (
    (mapping.status === 'mapped' || mapping.status === 'review') &&
    mapping.profileField !== undefined &&
    mapping.hasValue
  );
}

/** High-confidence matches start selected; review-level ones need an explicit click. */
export function initialSelection(mappings: readonly ReviewedMapping[]): Set<string> {
  return new Set(
    mappings.filter((m) => m.status === 'mapped' && isSelectable(m)).map((m) => m.fieldId),
  );
}

export function profileFieldDescription(mapping: ReviewedMapping): string | undefined {
  if (!mapping.profileField) return undefined;
  return `${PROFILE_FIELDS[mapping.profileField].label} (${PROFILE_FIELD_PATHS[mapping.profileField]})`;
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
  const matched = mappings.filter((m) => m.status === 'mapped' || m.status === 'review');
  return {
    ready: mappings.filter((m) => selected.has(m.fieldId)).length,
    needsReview: matched.filter(
      (m) => m.status === 'review' && m.hasValue && !selected.has(m.fieldId),
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
