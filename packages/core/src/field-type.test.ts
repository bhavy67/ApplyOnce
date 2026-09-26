import { describe, expect, it } from 'vitest';
import { FIELD_TYPES, isFieldType, PROFILE_FIELD_KEYS, PROFILE_FIELDS } from './index';

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

describe('profile fields', () => {
  it('defines every profile field key with at least one compatible field type', () => {
    for (const key of PROFILE_FIELD_KEYS) {
      expect(PROFILE_FIELDS[key].fieldTypes.length).toBeGreaterThan(0);
    }
  });
});
