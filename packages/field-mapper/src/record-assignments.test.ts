import type { FieldType, FormField, ProfileRecordIdTarget, SavedMapping } from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import { applyRecordAssignments, createAliasMatcher, isAssignableField, mapFields } from './index';

const matcher = createAliasMatcher();
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const field = (
  id: string,
  label: string,
  extra: Partial<FormField> = {},
  type: FieldType = 'text',
): FormField => ({
  id,
  type,
  htmlType: type,
  required: false,
  visible: true,
  disabled: false,
  signals: { label },
  ...extra,
});
const repeated = (id: string, label = 'Degree', extra: Partial<FormField> = {}) =>
  field(id, label, { repeatedCount: 2, ...extra });
const target = (f = 'degree', collection = 'education'): ProfileRecordIdTarget =>
  `${collection}@${A}.${f}` as ProfileRecordIdTarget;

function apply(fields: FormField[], lookup: Parameters<typeof applyRecordAssignments>[2]) {
  return applyRecordAssignments(fields, mapFields(fields, matcher).mappings, lookup);
}

describe('record assignments on top of deterministic mapping', () => {
  it('only a repeated question without record context is assignable', () => {
    const cases: [FormField, boolean][] = [
      [repeated('a'), true],
      [field('b', 'Degree'), false],
      [field('c', 'Degree', { record: { collection: 'education', index: 1 } }), false],
      [
        field('d', 'Degree', { record: { collection: 'education', index: 1 }, repeatedCount: 2 }),
        false,
      ],
    ];
    for (const [f, expected] of cases) {
      const [mapping] = mapFields([f], matcher).mappings;
      expect(mapping && isAssignableField(f, mapping)).toBe(expected);
    }
  });

  it('without an assignment, a repeated field stays unsupported', () => {
    expect(apply([repeated('a')], () => undefined)[0]).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'repeated-question',
    });
  });

  it('an assignment makes it "assigned" (not mapped): it still needs explicit selection', () => {
    expect(apply([repeated('a')], () => target())[0]).toEqual({
      fieldId: 'a',
      status: 'assigned',
      source: 'assigned',
      profileField: target(),
      confidence: { score: 100, level: 'high', reasons: ['user-assignment'] },
    });
  });

  it('an assignment to a deleted record is unavailable, never another record', () => {
    const [mapping] = apply([repeated('a')], () => 'unavailable');
    expect(mapping).toMatchObject({
      status: 'unsupported',
      source: 'assigned',
      unsupportedReason: 'assignment-unavailable',
    });
    expect(mapping?.profileField).toBeUndefined();
  });

  it('keeps the field-state checks: incompatible type, hidden, disabled', () => {
    expect(
      apply([repeated('a', 'Degree', { type: 'checkbox', htmlType: 'checkbox' })], () =>
        target(),
      )[0],
    ).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'incompatible-type',
    });
    expect(apply([repeated('a', 'Degree', { visible: false })], () => target())[0]).toMatchObject({
      unsupportedReason: 'hidden',
    });
    expect(apply([repeated('a', 'Degree', { disabled: true })], () => target())[0]).toMatchObject({
      unsupportedReason: 'disabled',
    });
  });

  it('never touches other fields, even if the lookup returns a target for them', () => {
    const fields = [
      field('single', 'Degree'),
      field('rec', 'Degree', { record: { collection: 'education', index: 1 } }),
    ];
    const plain = mapFields(fields, matcher).mappings;
    expect(apply(fields, () => target())).toEqual(plain);
  });

  it('a record id target is never usable as a Teach Once (saved) mapping', () => {
    const single = field('s', 'Preferred campus');
    const key = 'v1|text|q=preferred campus|c=|i=';
    const saved = new Map<string, SavedMapping>([
      [
        key,
        {
          key,
          parts: { fieldType: 'text', question: 'preferred campus' },
          profileField: target('institution'),
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
    ]);
    expect(mapFields([single], matcher, saved).mappings[0]?.source).toBe('automatic');
  });
});
