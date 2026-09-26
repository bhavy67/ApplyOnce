import type { FieldType, FormField } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import { createMappingKey, createMappingKeyParts } from './index';

function field(type: FieldType, signals: FormField['signals']): FormField {
  return {
    id: 'f',
    type,
    htmlType: type,
    required: false,
    visible: true,
    disabled: false,
    signals,
  };
}

describe('createMappingKey', () => {
  it('produces the same key for identical metadata', () => {
    const a = field('text', { label: 'Preferred Working Location', name: 'q1' });
    const b = field('text', { label: 'Preferred Working Location', name: 'q1' });
    expect(createMappingKey(a)).toBe(createMappingKey(b));
  });

  it('normalizes formatting, and ignores site-specific names when there is a question', () => {
    const a = field('text', { label: 'Preferred Working Location *', name: 'job[q_17]' });
    const b = field('text', { label: '  preferred working location:', htmlId: 'loc-pref' });
    expect(createMappingKey(a)).toBe('v1|text|q=preferred working location|c=|i=');
    expect(createMappingKey(b)).toBe(createMappingKey(a));
  });

  it.each([
    [{ label: 'Preferred work location' }, { label: 'Current location' }],
    [{ label: 'Location' }, { label: 'Preferred location' }],
    [
      { label: 'Phone', nearbyText: 'Emergency contact' },
      { label: 'Phone', nearbyText: 'Your details' },
    ],
    [
      { label: 'Yes', nearbyText: 'Willing to relocate?' },
      { label: 'Yes', nearbyText: 'Over 18?' },
    ],
    [{ name: 'city' }, { label: 'city' }],
  ])('keeps meaningfully different fields apart: %j vs %j', (a, b) => {
    expect(createMappingKey(field('text', a))).not.toBe(createMappingKey(field('text', b)));
  });

  it('includes the field type', () => {
    const signals = { label: 'Country' };
    expect(createMappingKey(field('text', signals))).not.toBe(
      createMappingKey(field('select', signals)),
    );
  });

  it('uses aria-label, placeholder, then nearby text as the question', () => {
    expect(
      createMappingKeyParts(field('text', { ariaLabel: 'Start date', placeholder: 'x' })),
    ).toEqual({
      fieldType: 'text',
      question: 'start date',
    });
    expect(createMappingKeyParts(field('text', { placeholder: 'Your city' }))?.question).toBe(
      'your city',
    );
    expect(createMappingKeyParts(field('textarea', { nearbyText: 'Notes' }))).toEqual({
      fieldType: 'textarea',
      question: 'notes',
    });
  });

  it('falls back to the name or id only when there is no question text', () => {
    expect(createMappingKeyParts(field('text', { name: 'preferredLocation' }))).toEqual({
      fieldType: 'text',
      identifier: 'preferredlocation',
    });
    expect(createMappingKey(field('text', { htmlId: 'q-12' }))).toBe('v1|text|q=|c=|i=q 12');
  });

  it.each([{}, { name: '***' }, { label: '   ', placeholder: '' }, { autocomplete: 'email' }])(
    'returns undefined when there is nothing stable to key on (%j)',
    (signals) => {
      expect(createMappingKey(field('text', signals))).toBeUndefined();
    },
  );
});
