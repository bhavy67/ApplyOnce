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
  // As scanned since Phase 14: a unique semantic identity per field.
  identity: {
    key: `fp-${[...id]
      .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
      .toString(16)
      .padStart(16, '0')}`,
    unique: true,
  },
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
    expect(await repository.deleteForField(PAGE, degree('id:d1'))).toBe(true);
    expect(await repository.deleteForField(PAGE, degree('id:d1'))).toBe(false);
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

describe('record assignment repository: Phase 14 identities', () => {
  let store: ReturnType<typeof createIndexedDbStore<ExtensionStorageSchema>>;
  const open = () => createRecordAssignmentRepository(store);
  beforeEach(() => {
    store = createIndexedDbStore<ExtensionStorageSchema>({
      databaseName: 'assign14',
      factory: new IDBFactory(),
    });
  });

  it('saves the field identity and writes version 2', async () => {
    const saved = await open().save({
      page: PAGE,
      field: degree('id:d1'),
      target: `education@${A}.degree`,
    });
    expect(saved.ok && saved.assignment.identityKey).toMatch(/^fp-[0-9a-f]{16}$/);
    expect((await store.get('recordAssignments'))?.version).toBe(2);
  });

  it('refuses to save a field without a unique identity', async () => {
    const identical = degree('id:d1', { identity: { key: 'fp-0000000000000001', unique: false } });
    const noIdentity = { ...degree('id:d2'), identity: undefined };
    expect(
      await open().save({ page: PAGE, field: identical, target: `education@${A}.degree` }),
    ).toEqual({ ok: false, error: 'invalid-assignment' });
    expect(
      await open().save({ page: PAGE, field: noIdentity, target: `education@${A}.degree` }),
    ).toEqual({ ok: false, error: 'invalid-assignment' });
  });

  it('reads version 1 entries unchanged (non-destructive migration) and keeps them on write', async () => {
    const legacy = {
      page: PAGE,
      fieldId: 'id:old',
      field: { type: 'text' as const, htmlId: 'old', label: 'Degree', repeatedCount: 2 },
      target: `education@${A}.degree` as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.set('recordAssignments', { version: 1, assignments: [legacy] });
    expect(await open().list()).toEqual([legacy]);
    await open().save({ page: PAGE, field: degree('id:d1'), target: `education@${B}.degree` });
    const stored = await store.get('recordAssignments');
    expect(stored?.version).toBe(2);
    expect(stored?.assignments[0]).toEqual(legacy);
  });

  it('reassigning a field replaces its version 1 entry and any entry with the same identity', async () => {
    const legacy = {
      page: PAGE,
      fieldId: 'id:d1',
      field: { type: 'text' as const, htmlId: 'd1', label: 'Degree', repeatedCount: 2 },
      target: `education@${A}.degree` as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.set('recordAssignments', { version: 1, assignments: [legacy] });
    await open().save({ page: PAGE, field: degree('id:d1'), target: `education@${B}.degree` });
    // Same identity, now under another field id (e.g. after a reorder): still one entry.
    await open().save({
      page: PAGE,
      field: { ...degree('id:d1'), id: 'id:moved' },
      target: `education@${A}.degree`,
    });
    const list = await open().list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ fieldId: 'id:moved', target: `education@${A}.degree` });
  });

  it('removes exactly one entry by its handle, and deletes a field’s entries by identity', async () => {
    await open().save({ page: PAGE, field: degree('id:d1'), target: `education@${A}.degree` });
    await open().save({ page: PAGE, field: degree('id:d2'), target: `education@${B}.degree` });
    const [first] = await open().list();
    if (!first) throw new Error('none');
    expect(
      await open().remove({
        page: first.page,
        fieldId: first.fieldId,
        identityKey: first.identityKey,
      }),
    ).toBe(true);
    expect(
      await open().remove({
        page: first.page,
        fieldId: first.fieldId,
        identityKey: first.identityKey,
      }),
    ).toBe(false);
    expect((await open().list()).map((a) => a.fieldId)).toEqual(['id:d2']);
    expect(await open().deleteForField(PAGE, { ...degree('id:d2'), id: 'id:other' })).toBe(true);
    expect(await open().list()).toEqual([]);
  });

  it('refuses an unknown newer version', async () => {
    await store.set('recordAssignments', {
      version: 3,
      assignments: [],
    } as unknown as ExtensionStorageSchema['recordAssignments']);
    await expect(open().list()).rejects.toBeInstanceOf(UnsupportedRecordAssignmentsVersionError);
  });
});
