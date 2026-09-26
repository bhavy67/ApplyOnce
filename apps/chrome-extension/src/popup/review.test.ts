import { describe, expect, it } from 'vitest';
import type { ReviewedMapping } from '../messaging/protocol';
import {
  initialSelection,
  isSelectable,
  mappingNote,
  profileFieldDescription,
  summarizeFillResults,
  summarizeReview,
} from './review';

function mapping(
  overrides: Partial<ReviewedMapping> & Pick<ReviewedMapping, 'fieldId'>,
): ReviewedMapping {
  return {
    status: 'mapped',
    profileField: 'email',
    confidence: { score: 90, level: 'high', reasons: ['label'] },
    hasValue: true,
    ...overrides,
  };
}

const readyMapping = mapping({ fieldId: 'ready' });
const unknownMapping: ReviewedMapping = {
  fieldId: 'unknown',
  status: 'unknown',
  confidence: { score: 0, level: 'unknown', reasons: [] },
  hasValue: false,
};
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
];

describe('selection', () => {
  it('pre-selects only high-confidence matches with a value', () => {
    expect([...initialSelection(mappings)]).toEqual(['ready']);
  });

  it('lets review-level matches be selected, but never unknown, unsupported, or valueless ones', () => {
    expect(mappings.map((m) => [m.fieldId, isSelectable(m)])).toEqual([
      ['ready', true],
      ['review', true],
      ['no-value', false],
      ['unknown', false],
      ['hidden', false],
    ]);
  });
});

describe('notes and summaries', () => {
  it('explains each state', () => {
    expect(mappings.map((m) => mappingNote(m, m.fieldId === 'ready'))).toEqual([
      'Ready to fill',
      'Needs review. Select to fill.',
      'No value in your profile.',
      'No safe match. Will not be filled.',
      'Hidden field. Will not be filled.',
    ]);
  });

  it('describes the target profile field with its path', () => {
    expect(profileFieldDescription(readyMapping)).toBe('Email (contact.email)');
    expect(profileFieldDescription(unknownMapping)).toBeUndefined();
  });

  it('summarizes the review and the fill results', () => {
    expect(summarizeReview(mappings, new Set(['ready']))).toEqual({
      ready: 1,
      needsReview: 1,
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
