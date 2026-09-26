import type { FieldType, FormField } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import { createAliasMatcher, createFieldSignature, mapFields, toSignatureKey } from './index';

let nextId = 0;
function field(
  type: FieldType,
  signals: FormField['signals'],
  state: Partial<Pick<FormField, 'visible' | 'disabled'>> = {},
): FormField {
  nextId += 1;
  return {
    id: `field-${nextId}`,
    type,
    htmlType: type,
    required: false,
    visible: true,
    disabled: false,
    signals,
    ...state,
  };
}

const matcher = createAliasMatcher();
const matchOf = (f: FormField) => matcher.match(createFieldSignature(f));
const mapOne = (f: FormField) => mapFields([f], matcher).mappings[0];

describe('exact matches', () => {
  it('maps a clearly labeled field with high confidence and explains why', () => {
    const match = matchOf(field('email', { name: 'email', label: 'Email Address *' }));

    expect(match?.profileField).toBe('email');
    expect(match?.confidence.level).toBe('high');
    expect(match?.confidence.reasons).toEqual(['name', 'label', 'field-type']);
  });

  it.each([
    ['First Name', 'first_name'],
    ['Last name', 'last_name'],
    ['Surname', 'last_name'],
    ['E-mail', 'email'],
    ['Mobile Number', 'phone'],
    ['City / Town', 'city'],
    ['State/Province', 'state'],
    ['ZIP / Postal Code', 'postal_code'],
    ['LinkedIn Profile URL', 'linkedin_url'],
    ['Years of Experience', 'experience_years'],
  ])('exact label %j → %s (high)', (label, profileField) => {
    const type: FieldType = profileField === 'email' ? 'email' : 'text';
    const match = matchOf(field(type, { label }));
    expect(match?.profileField).toBe(profileField);
    expect(match?.confidence.level).toBe('high');
  });

  it('uses aria-label like a label', () => {
    const match = matchOf(field('tel', { ariaLabel: 'Phone number' }));
    expect(match).toMatchObject({ profileField: 'phone', confidence: { level: 'high' } });
  });

  it('uses HTML autocomplete tokens, including section prefixes', () => {
    const match = matchOf(field('text', { autocomplete: 'section-a family-name' }));
    expect(match?.profileField).toBe('last_name');
    expect(match?.confidence).toMatchObject({
      level: 'high',
      reasons: ['autocomplete', 'field-type'],
    });
  });
});

describe('name and id matches', () => {
  it.each(['firstName', 'first_name', 'first-name', 'FIRSTNAME'])(
    'matches identifier style %j, but only at review level on its own',
    (name) => {
      const match = matchOf(field('text', { name }));
      expect(match?.profileField).toBe('first_name');
      expect(match?.confidence.level).toBe('confirm');
    },
  );

  it('matches the last segment of structured names and ids', () => {
    expect(matchOf(field('text', { name: 'job_application[first_name]' }))?.profileField).toBe(
      'first_name',
    );
    expect(matchOf(field('email', { htmlId: 'applicant.email' }))?.profileField).toBe('email');
  });

  it('reaches high confidence when name and placeholder agree', () => {
    const match = matchOf(field('tel', { name: 'phone', placeholder: 'Phone' }));
    expect(match?.confidence.level).toBe('high');
  });
});

describe('weaker signals', () => {
  it('matches a multi-word alias inside a longer label, at review level', () => {
    const match = matchOf(field('text', { label: 'Legal first name (as on passport)' }));
    expect(match?.profileField).toBe('first_name');
    expect(match?.confidence.reasons).toContain('label-contains');
    expect(match?.confidence.level).not.toBe('high');
  });

  it('does not match single-word aliases inside longer labels', () => {
    expect(matchOf(field('text', { label: 'Company name' }))).toBeUndefined();
    expect(matchOf(field('email', { label: 'Referral email for your manager' }))).toBeUndefined();
  });

  it('uses nearby text such as a fieldset legend, at low confidence', () => {
    const match = matchOf(field('checkbox', { label: 'Yes', nearbyText: 'Willing to relocate' }));
    expect(match).toMatchObject({
      profileField: 'willing_to_relocate',
      confidence: { level: 'confirm', reasons: ['nearby-text', 'field-type'] },
    });
  });

  it('maps sponsorship questions on radio groups for review', () => {
    const match = matchOf(
      field('radio', { name: 'q7', label: 'Will you now or in the future require sponsorship?' }),
    );
    expect(match?.profileField).toBe('requires_sponsorship');
    expect(match?.confidence.level).toBe('confirm');
  });

  it('does not match on field type alone', () => {
    expect(matchOf(field('email', { label: 'Referral code' }))).toBeUndefined();
  });
});

describe('conflicting metadata', () => {
  it('lowers confidence when strong signals point to different profile fields', () => {
    const match = matchOf(field('text', { label: 'Phone', name: 'email' }));
    expect(match?.profileField).toBe('phone');
    expect(match?.confidence.reasons).toContain('conflict');
    expect(match?.confidence.level).toBe('review');
  });

  it('does not flag a conflict when all signals agree', () => {
    const match = matchOf(field('tel', { label: 'Mobile', name: 'phone', autocomplete: 'tel' }));
    expect(match?.confidence).toMatchObject({ score: 100, level: 'high' });
    expect(match?.confidence.reasons).not.toContain('conflict');
  });
});

describe('mapFields', () => {
  it('returns one mapping per field with a status', () => {
    const email = field('email', { name: 'email', label: 'Email' });
    const phone = field('tel', { name: 'phone' });
    const custom = field('textarea', { label: 'Why do you want to work here?' });

    expect(mapFields([email, phone, custom], matcher).mappings).toEqual([
      expect.objectContaining({ fieldId: email.id, status: 'mapped', profileField: 'email' }),
      expect.objectContaining({ fieldId: phone.id, status: 'review', profileField: 'phone' }),
      {
        fieldId: custom.id,
        status: 'unknown',
        confidence: { score: 0, level: 'unknown', reasons: [] },
      },
    ]);
  });

  it('marks a match the field cannot hold as unsupported', () => {
    expect(mapOne(field('checkbox', { label: 'Email' }))).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'incompatible-type',
      profileField: 'email',
    });
  });

  it.each([
    [{ visible: false }, 'hidden'],
    [{ disabled: true }, 'disabled'],
  ] as const)('marks %j fields as unsupported (%s)', (state, reason) => {
    expect(mapOne(field('text', { label: 'City' }, state))).toMatchObject({
      status: 'unsupported',
      unsupportedReason: reason,
    });
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
