import { PROFILE_FIELD_KEYS, PROFILE_FIELDS } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import type { ReviewedMapping } from '../messaging/protocol';
import {
  canTeach,
  initialSelection,
  isSelectable,
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

  it('builds the selector from the canonical profile field definitions for this field type', () => {
    const textOptions = teachOptions('text').map((o) => o.key);
    expect(textOptions).toEqual(
      PROFILE_FIELD_KEYS.filter((k) => PROFILE_FIELDS[k].fieldTypes.includes('text')),
    );
    expect(textOptions).toContain('city');
    expect(teachOptions('checkbox').map((o) => o.key)).toEqual([
      'requires_sponsorship',
      'willing_to_relocate',
    ]);
    expect(teachOptions('text').find((o) => o.key === 'postal_code')?.label).toBe('Postal code');
  });
});
