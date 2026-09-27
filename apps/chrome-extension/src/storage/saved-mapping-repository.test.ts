import type { MappingKeyParts } from '@applyonce/core';
import { mappingKeyFromParts } from '@applyonce/field-mapper';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbStore } from './indexeddb-store';
import type { ExtensionStorageSchema } from './profile-repository';
import {
  createSavedMappingRepository,
  UnsupportedSavedMappingsVersionError,
} from './saved-mapping-repository';

const location: MappingKeyParts = { fieldType: 'text', question: 'preferred working location' };
const sponsorship: MappingKeyParts = { fieldType: 'radio', question: 'visa status' };

describe('saved mapping repository', () => {
  let store: ReturnType<typeof createIndexedDbStore<ExtensionStorageSchema>>;
  let clock: number;
  const open = () =>
    createSavedMappingRepository(store, () => new Date(Date.UTC(2026, 8, 26, 12, 0, clock++)));

  beforeEach(() => {
    store = createIndexedDbStore<ExtensionStorageSchema>({
      databaseName: 'mappings-test',
      factory: new IDBFactory(),
    });
    clock = 0;
  });

  it('saves and retrieves a mapping by its key', async () => {
    const repository = open();
    const result = await repository.save({
      parts: location,
      profileField: 'city',
      site: 'jobs.example.com',
    });

    expect(result).toEqual({
      ok: true,
      mapping: {
        key: 'v1|text|q=preferred working location|c=|i=',
        parts: location,
        profileField: 'city',
        site: 'jobs.example.com',
        createdAt: '2026-09-26T12:00:00.000Z',
        updatedAt: '2026-09-26T12:00:00.000Z',
      },
    });
    expect(await repository.get(mappingKeyFromParts(location))).toMatchObject({
      profileField: 'city',
    });
    expect(await repository.get('v1|text|q=unknown|c=|i=')).toBeUndefined();
  });

  it('updates an existing mapping in place, keeping its creation time (no duplicates)', async () => {
    const repository = open();
    await repository.save({ parts: location, profileField: 'city' });
    await repository.save({ parts: location, profileField: 'state' });

    const mappings = await repository.list();
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      profileField: 'state',
      createdAt: '2026-09-26T12:00:00.000Z',
      updatedAt: '2026-09-26T12:00:01.000Z',
    });
  });

  it('lists newest first and persists across repository instances', async () => {
    await open().save({ parts: location, profileField: 'city' });
    await open().save({ parts: sponsorship, profileField: 'requires_sponsorship' });

    expect((await open().list()).map((m) => m.profileField)).toEqual([
      'requires_sponsorship',
      'city',
    ]);
  });

  it('deletes one mapping and reports whether it existed', async () => {
    const repository = open();
    await repository.save({ parts: location, profileField: 'city' });
    await repository.save({ parts: sponsorship, profileField: 'requires_sponsorship' });

    expect(await repository.delete(mappingKeyFromParts(location))).toBe(true);
    expect(await repository.delete(mappingKeyFromParts(location))).toBe(false);
    expect((await repository.list()).map((m) => m.profileField)).toEqual(['requires_sponsorship']);
  });

  it('clears all mappings without touching the profile', async () => {
    await store.set('profile', {
      schemaVersion: 1,
    } as unknown as ExtensionStorageSchema['profile']);
    const repository = open();
    await repository.save({ parts: location, profileField: 'city' });
    await repository.clear();

    expect(await repository.list()).toEqual([]);
    expect(await store.get('profile')).toEqual({ schemaVersion: 1 });
  });

  it.each(['location.city', 'firstName', '__proto__', 'favourite_colour', ''])(
    'rejects invalid profile field %j and stores nothing',
    async (profileField) => {
      const repository = open();
      expect(await repository.save({ parts: location, profileField })).toEqual({
        ok: false,
        error: 'invalid-profile-field',
      });
      expect(await store.get('savedMappings')).toBeUndefined();
    },
  );

  it('rejects a profile field the field type cannot hold', async () => {
    expect(await open().save({ parts: sponsorship, profileField: 'email' })).toEqual({
      ok: false,
      error: 'incompatible-field-type',
    });
  });

  it('keeps concurrent writes (serialized)', async () => {
    const repository = open();
    await Promise.all([
      repository.save({ parts: location, profileField: 'city' }),
      repository.save({ parts: sponsorship, profileField: 'requires_sponsorship' }),
      repository.save({
        parts: { fieldType: 'text', question: 'home town' },
        profileField: 'city',
      }),
    ]);
    expect(await repository.list()).toHaveLength(3);
  });

  it('stores only key parts, the profile field key, site, and timestamps', async () => {
    const extra = { ...location, value: 'Springfield', html: '<input>' } as MappingKeyParts;
    await open().save({ parts: extra, profileField: 'city', site: 'jobs.example.com' });

    const record = await store.get('savedMappings');
    expect(Object.keys(record?.mappings[0] ?? {}).sort()).toEqual([
      'createdAt',
      'key',
      'parts',
      'profileField',
      'site',
      'updatedAt',
    ]);
    expect(JSON.stringify(record)).not.toMatch(/Springfield|<input>/);
  });

  it('refuses stored data with an unknown version instead of discarding it', async () => {
    await store.set('savedMappings', {
      version: 9,
      mappings: [],
    } as unknown as ExtensionStorageSchema['savedMappings']);
    await expect(open().list()).rejects.toBeInstanceOf(UnsupportedSavedMappingsVersionError);
  });
});
