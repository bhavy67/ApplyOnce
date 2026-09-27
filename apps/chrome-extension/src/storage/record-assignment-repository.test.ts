import type { FormField } from '@applyonce/core';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbStore } from './indexeddb-store';
import type { ExtensionStorageSchema } from './profile-repository';
import {
  createRecordAssignmentRepository,
  isSameAssignedField,
  MAX_RECORD_ASSIGNMENTS,
  UnsupportedRecordAssignmentsVersionError,
} from './record-assignment-repository';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAGE = 'https://jobs.example.com/apply';
const degree = (id: string, extra: Partial<FormField> = {}): FormField => ({
  id,
  type: 'text',
  htmlType: 'text',
  required: false,
  visible: true,
  disabled: false,
  repeatedCount: 2,
  signals: { htmlId: id.slice(3), label: 'Degree' },
  ...extra,
});

describe('record assignment repository', () => {
  let store: ReturnType<typeof createIndexedDbStore<ExtensionStorageSchema>>;
  let clock = 0;
  const open = () =>
    createRecordAssignmentRepository(store, () => new Date(Date.UTC(2026, 0, 1) + clock++ * 1000));

  beforeEach(() => {
    store = createIndexedDbStore<ExtensionStorageSchema>({
      databaseName: 'assign',
      factory: new IDBFactory(),
    });
  });

  it('creates, lists, and resolves assignments; stores metadata and targets only', async () => {
    const repository = open();
    const saved = await repository.save({
      page: PAGE,
      field: degree('id:d1'),
      target: `education@${A}.degree`,
    });
    expect(saved).toMatchObject({
      ok: true,
      assignment: {
        page: PAGE,
        fieldId: 'id:d1',
        field: { type: 'text', htmlId: 'd1', label: 'Degree', repeatedCount: 2 },
        target: `education@${A}.degree`,
      },
    });
    expect(await open().list()).toHaveLength(1);
    expect(JSON.stringify(await store.get('recordAssignments'))).not.toMatch(/value|Degree A/);
  });

  it('replaces the assignment of the same field (remapping), keeping createdAt', async () => {
    const repository = open();
    const first = await repository.save({
      page: PAGE,
      field: degree('id:d1'),
      target: `education@${A}.degree`,
    });
    const second = await repository.save({
      page: PAGE,
      field: degree('id:d1'),
      target: `education@${B}.degree`,
    });
    const list = await repository.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.target).toBe(`education@${B}.degree`);
    expect(first.ok && second.ok && list[0]?.createdAt === first.assignment.createdAt).toBe(true);
  });

  it('keeps assignments per page and per field', async () => {
    const repository = open();
    await repository.save({ page: PAGE, field: degree('id:d1'), target: `education@${A}.degree` });
    await repository.save({ page: PAGE, field: degree('id:d2'), target: `education@${B}.degree` });
    await repository.save({
      page: 'https://jobs.example.com/other',
      field: degree('id:d1'),
      target: `education@${B}.degree`,
    });
    expect(await repository.list()).toHaveLength(3);
    expect(await repository.delete(PAGE, 'id:d1')).toBe(true);
    expect(await repository.delete(PAGE, 'id:d1')).toBe(false);
    expect((await repository.list()).map((a) => [a.page, a.fieldId])).toEqual([
      [PAGE, 'id:d2'],
      ['https://jobs.example.com/other', 'id:d1'],
    ]);
    await repository.clear();
    expect(await repository.list()).toEqual([]);
  });

  it.each([
    ['a single (non-repeated) field', { field: degree('id:x', { repeatedCount: undefined }) }],
    [
      'a field in a record section',
      { field: degree('id:x', { record: { collection: 'education', index: 1 } }) },
    ],
    ['a positional target', { target: 'education[1].degree' }],
    ['a scalar target', { target: 'highest_degree' }],
    ['an unknown field', { target: `education@${A}.gpa` }],
    ['a malformed id', { target: 'education@../../x.degree' }],
    ['a type the field cannot hold', { target: `workExperience@${A}.current` }],
    ['a page with a query', { page: `${PAGE}?id=1` }],
    ['a non-web page', { page: 'chrome://settings/' }],
  ])('refuses %s', async (_, override) => {
    const input = {
      page: PAGE,
      field: degree('id:x'),
      target: `education@${A}.degree`,
      ...override,
    };
    expect(await open().save(input)).toEqual({ ok: false, error: 'invalid-assignment' });
    expect(await open().list()).toEqual([]);
  });

  it('bounds how many assignments are kept (oldest dropped)', async () => {
    const repository = open();
    for (let i = 0; i < MAX_RECORD_ASSIGNMENTS + 3; i++) {
      await repository.save({
        page: PAGE,
        field: degree(`id:f${i}`),
        target: `education@${A}.degree`,
      });
    }
    const list = await repository.list();
    expect(list).toHaveLength(MAX_RECORD_ASSIGNMENTS);
    expect(list[0]?.fieldId).toBe('id:f3');
  });

  it('refuses an unknown stored version instead of discarding it', async () => {
    await store.set('recordAssignments', {
      version: 9,
      assignments: [],
    } as unknown as ExtensionStorageSchema['recordAssignments']);
    await expect(open().list()).rejects.toBeInstanceOf(UnsupportedRecordAssignmentsVersionError);
  });

  it('matches the same field only: same type, name/id, label, and repeat count', () => {
    const assigned = { type: 'text' as const, htmlId: 'd1', label: 'Degree', repeatedCount: 2 };
    expect(isSameAssignedField(assigned, degree('id:d1'))).toBe(true);
    expect(isSameAssignedField(assigned, degree('id:d1', { repeatedCount: 3 }))).toBe(false);
    expect(
      isSameAssignedField(
        assigned,
        degree('id:d1', { signals: { htmlId: 'd1', label: 'Degree type' } }),
      ),
    ).toBe(false);
    expect(
      isSameAssignedField(assigned, degree('id:d1', { type: 'select', htmlType: 'select-one' })),
    ).toBe(false);
  });
});
