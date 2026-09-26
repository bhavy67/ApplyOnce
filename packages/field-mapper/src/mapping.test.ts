import type { FieldType, FormField } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import { createAliasMatcher, createFieldSignature, mapFields, toSignatureKey } from './index';

let nextId = 0;
function field(type: FieldType, signals: FormField['signals']): FormField {
  nextId += 1;
  return {
    id: `field-${nextId}`,
    type,
    htmlType: type,
    required: false,
    visible: true,
    disabled: false,
    signals,
  };
}

const matcher = createAliasMatcher();
const matchOf = (f: FormField) => matcher.match(createFieldSignature(f));

describe('alias matcher', () => {
  it('maps a well-labelled email field with high confidence and explains why', () => {
    const match = matchOf(field('email', { name: 'email', label: 'Email Address *' }));

    expect(match?.profileField).toBe('email');
    expect(match?.confidence.level).toBe('high');
    expect(match?.confidence.reasons).toEqual(['name', 'label', 'field-type']);
  });

  it('matches identifier styles such as camelCase names', () => {
    expect(matchOf(field('text', { name: 'firstName' }))?.profileField).toBe('first_name');
  });

  it('uses HTML autocomplete tokens', () => {
    const match = matchOf(field('text', { autocomplete: 'section-a family-name' }));
    expect(match?.profileField).toBe('last_name');
    expect(match?.confidence.reasons).toContain('autocomplete');
  });

  it('does not match on field type alone', () => {
    expect(matchOf(field('email', { label: 'Referral code' }))).toBeUndefined();
  });
});

describe('mapFields', () => {
  it('separates mapped fields from fields that must stay untouched', () => {
    const email = field('email', { name: 'email', label: 'Email' });
    const phone = field('tel', { label: 'Phone Number' });
    const custom = field('textarea', { label: 'Why do you want to work here?' });

    const result = mapFields([email, phone, custom], matcher);

    expect(result.mappings.map((m) => [m.fieldId, m.profileField])).toEqual([
      [email.id, 'email'],
      [phone.id, 'phone'],
    ]);
    expect(result.unmappedFieldIds).toEqual([custom.id]);
  });
});

describe('toSignatureKey', () => {
  it('produces the same key for the same field with different formatting', () => {
    const a = createFieldSignature(
      field('text', { label: 'Notice Period*', name: 'notice_period' }),
    );
    const b = createFieldSignature(
      field('text', { label: ' notice period ', name: 'notice period' }),
    );
    expect(toSignatureKey(a)).toBe(toSignatureKey(b));
  });
});
