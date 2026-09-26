import type { FieldType, FormField, SavedMapping } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import {
  createAliasMatcher,
  createFieldSignature,
  createMappingKey,
  createMappingKeyParts,
  mapFields,
} from './index';

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
        source: 'automatic',
        mappingKey: 'v1|textarea|q=why do you want to work here|c=|i=',
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

describe('saved (taught) mappings', () => {
  const preferred = () => field('text', { label: 'Preferred Working Location', name: 'q17' });
  const now = '2026-09-26T00:00:00.000Z';
  function savedFor(
    f: FormField,
    profileField: SavedMapping['profileField'],
  ): ReadonlyMap<string, SavedMapping> {
    const parts = createMappingKeyParts(f);
    const key = createMappingKey(f);
    if (!parts || !key) throw new Error('field has no key');
    return new Map([[key, { key, parts, profileField, createdAt: now, updatedAt: now }]]);
  }

  it('teaches an unknown field', () => {
    const f = preferred();
    expect(mapOne(f)?.status).toBe('unknown');
    expect(mapFields([f], matcher, savedFor(f, 'city')).mappings[0]).toMatchObject({
      status: 'taught',
      source: 'taught',
      profileField: 'city',
      confidence: { reasons: ['user-mapping'] },
    });
  });

  it('wins over a deterministic match (re-mapping)', () => {
    const f = field('tel', { label: 'Phone', name: 'phone' });
    expect(mapOne(f)).toMatchObject({ status: 'mapped', profileField: 'phone' });
    const taught = mapFields([f], matcher, savedFor(f, 'phone'));
    expect(taught.mappings[0]).toMatchObject({ status: 'taught', profileField: 'phone' });
  });

  it('does not apply to fields that only share a weak signal', () => {
    const saved = savedFor(preferred(), 'city');
    const other = field('text', { label: 'Current location', name: 'q17' });
    expect(mapFields([other], matcher, saved).mappings[0]?.source).toBe('automatic');
  });

  it('ignores a saved mapping the field cannot hold and falls back to the matcher', () => {
    const f = field('email', { label: 'Email', name: 'email' });
    const key = createMappingKey(f) ?? '';
    const incompatible = new Map([
      [
        key,
        {
          key,
          parts: { fieldType: 'email' as const, question: 'email' },
          profileField: 'willing_to_relocate' as const,
          createdAt: now,
          updatedAt: now,
        },
      ],
    ]);
    expect(mapFields([f], matcher, incompatible).mappings[0]).toMatchObject({
      status: 'mapped',
      source: 'automatic',
      profileField: 'email',
    });
  });

  it('keeps unknown fields unknown when no saved mapping exists', () => {
    const f = preferred();
    expect(mapFields([f], matcher, new Map()).mappings[0]?.status).toBe('unknown');
  });

  it('still reports hidden fields as unsupported, with the taught source', () => {
    const f = { ...preferred(), visible: false };
    expect(mapFields([f], matcher, savedFor(f, 'city')).mappings[0]).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'hidden',
      source: 'taught',
    });
  });
});
