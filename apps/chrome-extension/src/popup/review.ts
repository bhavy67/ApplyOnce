import {
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  PROFILE_RECORD_COLLECTION_DEFINITIONS,
  PROFILE_RECORD_COLLECTIONS,
  PROFILE_SECTIONS,
  recordFieldsOf,
  recordTarget,
  resolveProfileTarget,
  type ConfidenceLevel,
  type FieldType,
  type FillResult,
  type FillStatus,
  type ProfileTarget,
  type UnsupportedReason,
} from '@applyonce/core';
import type { ProfileRecordCounts, ReviewedMapping } from '../messaging/protocol';

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

const UNSUPPORTED_NOTES: Readonly<Record<UnsupportedReason, string>> = {
  'incompatible-type': 'This field cannot hold that value.',
  hidden: 'Hidden field. Will not be filled.',
  disabled: 'Disabled field. Will not be filled.',
  readonly: 'Read-only field. Will not be filled.',
  'checkbox-group': 'One option of a multi-choice group. Will not be filled.',
  'unsupported-control': 'Custom dropdown ApplyOnce cannot operate safely. Will not be filled.',
  'repeated-question':
    'This question repeats on the page (e.g. several records). Will not be filled.',
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
  const target = resolveProfileTarget(mapping.profileField);
  return target && `${target.label} (${target.path})`;
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

export interface TeachOption {
  key: ProfileTarget;
  label: string;
}

export interface TeachOptionGroup {
  label: string;
  options: TeachOption[];
}

/**
 * Profile fields a field of this type can hold, grouped as in the profile editor, from the
 * canonical definitions and the number of records the profile has (never their values).
 * Scalar fields come by section; each existing record is its own group ("Education 2"), and
 * Education 1 (primary) is always offered, as its fields were before records existed. Its
 * fields keep their scalar keys, so mappings taught to them are the same as before.
 */
export function teachOptions(
  fieldType: FieldType,
  records: ProfileRecordCounts,
): TeachOptionGroup[] {
  const groups: TeachOptionGroup[] = [];
  for (const section of PROFILE_SECTIONS) {
    const scalars = PROFILE_FIELD_KEYS.filter(
      (key) =>
        PROFILE_FIELDS[key].section === section &&
        !PROFILE_FIELDS[key].record &&
        PROFILE_FIELDS[key].fieldTypes.includes(fieldType),
    ).map((key) => ({ key, label: PROFILE_FIELDS[key].label }));
    if (scalars.length > 0) groups.push({ label: section, options: scalars });

    for (const collection of PROFILE_RECORD_COLLECTIONS) {
      const definition = PROFILE_RECORD_COLLECTION_DEFINITIONS[collection];
      if (definition.section !== section) continue;
      const count = Math.max(records[collection], collection === 'education' ? 1 : 0);
      for (let index = 0; index < count; index++) {
        const options = recordFieldsOf(collection)
          .filter((field) => field.teachable && field.fieldTypes.includes(fieldType))
          .map((field) => {
            const key = recordTarget(collection, index, field.field);
            return { key, label: resolveProfileTarget(key)?.label ?? field.label };
          });
        const role = index === 0 && definition.firstRecordRole;
        const label = `${definition.itemLabel} ${index + 1}${role ? ` (${role})` : ''}`;
        if (options.length > 0) groups.push({ label, options });
      }
    }
  }
  return groups;
}

export function mappingNote(mapping: ReviewedMapping, selected: boolean): string {
  switch (mapping.status) {
    case 'unknown':
      return 'No safe match. Will not be filled.';
    case 'unsupported':
      return UNSUPPORTED_NOTES[mapping.unsupportedReason ?? 'incompatible-type'];
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
