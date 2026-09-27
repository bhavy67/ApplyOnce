import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  isFieldType,
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
} from './index';

describe('field types', () => {
  it('supports the V1 field types from the spec', () => {
    expect(FIELD_TYPES).toEqual([
      'text',
      'email',
      'tel',
      'number',
      'textarea',
      'select',
      'checkbox',
      'radio',
    ]);
  });

  it('recognizes supported types and rejects deferred ones', () => {
    expect(isFieldType('email')).toBe(true);
    expect(isFieldType('file')).toBe(false);
    expect(isFieldType('date')).toBe(false);
  });
});

describe('profile field definitions', () => {
  const definitions = PROFILE_FIELD_KEYS.map((key) => [key, PROFILE_FIELDS[key]] as const);

  it('defines every key exactly once, with no extra definitions', () => {
    expect(new Set(PROFILE_FIELD_KEYS).size).toBe(PROFILE_FIELD_KEYS.length);
    expect(Object.keys(PROFILE_FIELDS).sort()).toEqual([...PROFILE_FIELD_KEYS].sort());
  });

  it.each(definitions)(
    '%s has a label, a canonical path, a section, and field types',
    (_, field) => {
      expect(field.label.trim()).not.toBe('');
      // "<section>.<property>", or "<collection>[0].<property>" for a primary-record field.
      expect(field.path).toMatch(
        field.record ? /^[A-Za-z]+\[0\]\.[A-Za-z]+$/ : /^[a-z]+\.[A-Za-z]+$/,
      );
      expect(PROFILE_SECTIONS).toContain(field.section);
      expect(field.fieldTypes.length).toBeGreaterThan(0);
      expect(field.fieldTypes.every(isFieldType)).toBe(true);
      expect(field.kind === 'choice').toBe(field.choices !== undefined && field.choices.length > 0);
    },
  );

  it('uses each path and label only once', () => {
    const paths = definitions.map(([, f]) => f.path);
    const labels = definitions.map(([, f]) => f.label);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps the keys that existing saved mappings refer to', () => {
    for (const key of [
      'first_name',
      'email',
      'city',
      'current_title',
      'current_company',
      'experience_years',
      'portfolio_url',
      'willing_to_relocate',
      'requires_sponsorship',
      'institution',
      'field_of_study',
      'highest_degree',
      'graduation_year',
    ]) {
      expect(PROFILE_FIELD_KEYS).toContain(key);
    }
  });
});
