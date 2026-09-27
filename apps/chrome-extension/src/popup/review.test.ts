import { PROFILE_FIELD_KEYS, PROFILE_FIELDS, type FieldType } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import type { ReviewedMapping } from '../messaging/protocol';
import {
  canTeach,
  initialSelection,
  isSelectable,
  mappingLine,
  mappingNote,
  mappingSourceLabel,
  profileFieldDescription,
  summarizeFillResults,
  summarizeReview,
  teachActionLabel,
  teachOptions,
} from './review';

function mapping(
  overrides: Partial<ReviewedMapping> & Pick<ReviewedMapping, 'fieldId'>,
): ReviewedMapping {
  return {
    status: 'mapped',
    source: 'automatic',
    profileField: 'email',
    confidence: { score: 90, level: 'high', reasons: ['label'] },
    hasValue: true,
    mappingKey: `v1|text|q=${overrides.fieldId}|c=|i=`,
    ...overrides,
  };
}

const readyMapping = mapping({ fieldId: 'ready' });
const unknownMapping: ReviewedMapping = {
  fieldId: 'unknown',
  status: 'unknown',
  source: 'automatic',
  confidence: { score: 0, level: 'unknown', reasons: [] },
  hasValue: false,
  mappingKey: 'v1|text|q=unknown|c=|i=',
};
const taughtMapping = mapping({
  fieldId: 'taught',
  status: 'taught',
  source: 'taught',
  profileField: 'city',
  confidence: { score: 100, level: 'high', reasons: ['user-mapping'] },
});
const mappings: ReviewedMapping[] = [
  readyMapping,
  mapping({
    fieldId: 'review',
    status: 'review',
    confidence: { score: 50, level: 'confirm', reasons: [] },
  }),
  mapping({ fieldId: 'no-value', hasValue: false }),
  unknownMapping,
  mapping({ fieldId: 'hidden', status: 'unsupported', unsupportedReason: 'hidden' }),
  taughtMapping,
];

describe('selection', () => {
  it('pre-selects only high-confidence automatic matches with a value (never taught ones)', () => {
    expect([...initialSelection(mappings)]).toEqual(['ready']);
  });

  it('lets review-level and taught matches be selected, but never unknown, unsupported, or valueless ones', () => {
    expect(mappings.map((m) => [m.fieldId, isSelectable(m)])).toEqual([
      ['ready', true],
      ['review', true],
      ['no-value', false],
      ['unknown', false],
      ['hidden', false],
      ['taught', true],
    ]);
  });
});

describe('notes, labels, and summaries', () => {
  it('explains each state', () => {
    expect(mappings.map((m) => mappingNote(m, m.fieldId === 'ready'))).toEqual([
      'Ready to fill',
      'Needs review. Select to fill.',
      'No value in your profile.',
      'No safe match. Will not be filled.',
      'Hidden field. Will not be filled.',
      'Taught by you. Select to fill.',
    ]);
  });

  it('distinguishes taught mappings from automatic ones', () => {
    expect(mappingSourceLabel(readyMapping)).toBe('Automatic · High confidence');
    expect(mappingSourceLabel(taughtMapping)).toBe('Taught by you');
    expect(mappingSourceLabel(unknownMapping)).toBeUndefined();
  });

  it('describes the target profile field with its path', () => {
    expect(profileFieldDescription(readyMapping)).toBe('Email (contact.email)');
    expect(profileFieldDescription(taughtMapping)).toBe('City (location.city)');
    expect(profileFieldDescription(unknownMapping)).toBeUndefined();
  });

  it('summarizes the review and the fill results', () => {
    expect(summarizeReview(mappings, new Set(['ready']))).toEqual({
      ready: 1,
      needsReview: 2,
      unknown: 1,
      missingValue: 1,
    });
    expect(
      summarizeFillResults([
        { fieldId: 'a', status: 'filled', message: '' },
        { fieldId: 'b', status: 'skipped', message: '' },
        { fieldId: 'c', status: 'not-found', message: '' },
        { fieldId: 'd', status: 'failed', message: '' },
      ]),
    ).toEqual({ filled: 1, skipped: 1, failed: 2 });
  });
});

describe('teaching', () => {
  it('offers Teach for unknown and review fields, Change for mapped and taught ones', () => {
    expect(mappings.filter(canTeach).map((m) => [m.fieldId, teachActionLabel(m)])).toEqual([
      ['ready', 'Change'],
      ['review', 'Teach'],
      ['no-value', 'Change'],
      ['unknown', 'Teach'],
      ['taught', 'Change'],
    ]);
  });

  it('cannot teach hidden fields or fields without a stable key', () => {
    expect(
      canTeach(mapping({ fieldId: 'hidden', status: 'unsupported', unsupportedReason: 'hidden' })),
    ).toBe(false);
    expect(canTeach({ ...unknownMapping, mappingKey: undefined })).toBe(false);
    expect(
      canTeach(
        mapping({
          fieldId: 'wrong-type',
          status: 'unsupported',
          unsupportedReason: 'incompatible-type',
        }),
      ),
    ).toBe(true);
  });

  const NONE = { education: 0, workExperience: 0, certifications: 0 };
  const keys = (type: FieldType, records = NONE) =>
    teachOptions(type, records).flatMap((group) => group.options.map((o) => o.key));
  const option = (type: FieldType, key: string, records = NONE) =>
    teachOptions(type, records)
      .flatMap((group) => group.options.map((o) => ({ ...o, group: group.label })))
      .find((o) => o.key === key);

  it('offers the Phase 5 fields through the same definitions', () => {
    expect(keys('text')).toEqual(
      expect.arrayContaining([
        'website_url',
        'current_title',
        'highest_degree',
        'field_of_study',
        'institution',
        'graduation_year',
        'work_mode',
        'employment_type',
      ]),
    );
    expect(keys('select')).toEqual(
      expect.arrayContaining(['work_mode', 'employment_type', 'highest_degree', 'graduation_year']),
    );
    expect(keys('number')).toEqual([
      'postal_code',
      'experience_years',
      'education[0].startYear',
      'graduation_year',
    ]);
    expect(option('select', 'employment_type')?.label).toBe('Employment type');
  });

  it('builds the selector from the canonical profile field definitions for this field type', () => {
    const scalars = keys('text').filter((k) => !k.includes('['));
    expect([...scalars].sort()).toEqual(
      PROFILE_FIELD_KEYS.filter((k) => PROFILE_FIELDS[k].fieldTypes.includes('text')).sort(),
    );
    expect(scalars).toContain('city');
    expect(keys('checkbox')).toEqual(['willing_to_relocate', 'requires_sponsorship']);
    expect(option('text', 'postal_code')).toMatchObject({
      label: 'Postal code',
      group: 'Location',
    });
  });

  it('Phase 10: offers a group per existing record, with readable labels', () => {
    const records = { education: 2, workExperience: 2, certifications: 1 };
    const groups = teachOptions('text', records).map((g) => g.label);
    expect(groups).toEqual([
      'Personal information',
      'Location',
      'Professional',
      'Employment',
      'Work experience 1',
      'Work experience 2',
      'Job preferences',
      'Education 1 (primary)',
      'Education 2',
      'Certification 1',
      'Authorization',
    ]);
    expect(option('text', 'institution', records)).toMatchObject({
      label: 'Institution',
      group: 'Education 1 (primary)',
    });
    expect(option('text', 'education[1].institution', records)).toMatchObject({
      label: 'Education 2 → Institution',
      group: 'Education 2',
    });
    expect(option('text', 'workExperience[1].company', records)?.label).toBe(
      'Work experience 2 → Company',
    );
    expect(option('text', 'certifications[0].name', records)?.label).toBe('Certification 1 → Name');
    // Sections in editor order: Work experience comes before Job preferences.
    expect(keys('checkbox', records)).toEqual([
      'workExperience[0].current',
      'workExperience[1].current',
      'willing_to_relocate',
      'requires_sponsorship',
    ]);
    expect(keys('textarea', records)).toEqual([
      'address',
      'workExperience[0].description',
      'workExperience[1].description',
    ]);
  });

  it('Phase 10: offers only records the profile has, but always the primary education', () => {
    expect(teachOptions('text', NONE).map((g) => g.label)).toContain('Education 1 (primary)');
    expect(
      keys('text').some((k) => k.startsWith('workExperience') || k.startsWith('certifications')),
    ).toBe(false);
    expect(keys('text').filter((k) => k.startsWith('education['))).toEqual([
      'education[0].startYear',
    ]);
    expect(keys('text', { ...NONE, education: 3 })).toContain('education[2].institution');
    expect(keys('text', { ...NONE, education: 3 })).not.toContain('education[3].institution');
  });

  it('Phase 10: describes record targets by label and path', () => {
    expect(
      profileFieldDescription(mapping({ fieldId: 'x', profileField: 'education[1].institution' })),
    ).toBe('Education 2 → Institution (education[1].institution)');
    expect(profileFieldDescription(mapping({ fieldId: 'y', profileField: 'institution' }))).toBe(
      'Institution (education[0].institution)',
    );
  });
});

describe('Phase 6 unsupported notes', () => {
  it.each([
    ['readonly', 'Read-only field. Will not be filled.'],
    ['checkbox-group', 'One option of a multi-choice group. Will not be filled.'],
  ] as const)('%s', (unsupportedReason, note) => {
    const m = mapping({ fieldId: 'x', status: 'unsupported', unsupportedReason });
    expect(mappingNote(m, false)).toBe(note);
    expect(isSelectable(m)).toBe(false);
    expect(canTeach(m)).toBe(false);
  });
});

describe('Phase 7 unsupported custom control', () => {
  it('explains it and never allows selecting or teaching it', () => {
    const m = mapping({
      fieldId: 'x',
      status: 'unsupported',
      unsupportedReason: 'unsupported-control',
    });
    expect(mappingNote(m, false)).toBe(
      'Custom dropdown ApplyOnce cannot operate safely. Will not be filled.',
    );
    expect(isSelectable(m)).toBe(false);
    expect(canTeach(m)).toBe(false);
  });
});

describe('Phase 8 repeated questions', () => {
  it('explains a repeated question and never allows selecting or teaching it', () => {
    const m = mapping({
      fieldId: 'x',
      status: 'unsupported',
      unsupportedReason: 'repeated-question',
    });
    expect(mappingNote(m, false)).toBe(
      "Asked more than once, and ApplyOnce can't tell which profile record each one is for. Will not be filled.",
    );
    expect(isSelectable(m)).toBe(false);
    expect(canTeach(m)).toBe(false);
  });
});

describe('Phase 12: mapping line', () => {
  it('names a repeated question without record context instead of "No match"', () => {
    const repeated = mapping({
      fieldId: 'r',
      status: 'unsupported',
      unsupportedReason: 'repeated-question',
      profileField: undefined,
      confidence: { score: 0, level: 'unknown', reasons: [] },
      hasValue: false,
    });
    expect(mappingLine(repeated, {})).toBe('Repeated question · no record context');
    // An unknown question inside a recognized record block keeps "No match".
    expect(mappingLine(repeated, { record: { collection: 'education', index: 1 } })).toBe(
      'No match · Automatic · Unknown',
    );
  });

  it('keeps the usual line for other mappings', () => {
    expect(mappingLine(readyMapping, {})).toBe(
      '→ Email (contact.email) · Automatic · High confidence',
    );
    expect(mappingLine(unknownMapping, {})).toBe('No match');
  });
});
