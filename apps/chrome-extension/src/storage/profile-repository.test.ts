import { createEmptyProfile, type Profile } from '@applyonce/profile';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbStore } from './indexeddb-store';
import {
  createProfileRepository,
  UnsupportedProfileVersionError,
  type ExtensionStorageSchema,
} from './profile-repository';

const sampleProfile: Profile = {
  ...createEmptyProfile(),
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane@example.com' },
  education: [{ institution: 'Example University', graduationYear: 2019 }],
};

describe('profile repository', () => {
  let factory: IDBFactory;
  const open = () =>
    createProfileRepository(
      createIndexedDbStore<ExtensionStorageSchema>({ databaseName: 'applyonce-test', factory }),
    );

  beforeEach(() => {
    factory = new IDBFactory();
  });

  it('loads an empty profile when nothing is saved', async () => {
    expect(await open().load()).toEqual(createEmptyProfile());
  });

  it('saves and loads a profile, including after reopening', async () => {
    await open().save(sampleProfile);

    expect(await open().load()).toEqual(sampleProfile);
  });

  it('overwrites the saved profile', async () => {
    const repository = open();
    await repository.save(sampleProfile);
    await repository.save({ ...sampleProfile, contact: { email: 'jane.doe@example.org' } });

    expect((await repository.load()).contact).toEqual({ email: 'jane.doe@example.org' });
  });

  it('clears the saved profile', async () => {
    const repository = open();
    await repository.save(sampleProfile);
    await repository.clear();

    expect(await repository.load()).toEqual(createEmptyProfile());
  });

  it('refuses a profile with an unknown schema version instead of discarding it', async () => {
    const store = createIndexedDbStore<ExtensionStorageSchema>({
      databaseName: 'applyonce-test',
      factory,
    });
    // Simulates data written by a future version of the extension.
    await store.set('profile', { ...sampleProfile, schemaVersion: 2 } as unknown as Profile);

    await expect(createProfileRepository(store).load()).rejects.toBeInstanceOf(
      UnsupportedProfileVersionError,
    );
  });
});
