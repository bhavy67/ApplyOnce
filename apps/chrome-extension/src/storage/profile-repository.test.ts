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
  education: { institution: 'Example University', graduationYear: 2019 },
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
    await store.set('profile', { ...sampleProfile, schemaVersion: 99 } as unknown as Profile);

    await expect(createProfileRepository(store).load()).rejects.toBeInstanceOf(
      UnsupportedProfileVersionError,
    );
  });
});

describe('profile repository: upgrading a version 1 (Phase 1–4) profile', () => {
  const phase4Profile = {
    schemaVersion: 1,
    identity: { firstName: 'Jane', lastName: 'Doe' },
    contact: { email: 'jane.doe@example.com' },
    location: { city: 'Springfield' },
    education: [
      { institution: 'Example University', degree: 'MSc' },
      { institution: 'First College', degree: 'BSc' },
    ],
    experience: { currentCompany: 'Example Co', workHistory: [] },
    links: { linkedin: 'https://www.linkedin.com/in/jane-doe-example' },
    preferences: {
      workModes: ['hybrid'],
      employmentTypes: ['contract', 'full-time'],
      openToRelocation: true,
    },
    authorization: {},
    documents: { resumes: [], coverLetters: [] },
    customAnswers: [],
  };

  it('loads, migrates, saves as version 2, and loads again with every value kept', async () => {
    const store = createIndexedDbStore<ExtensionStorageSchema>({
      databaseName: 'upgrade-test',
      factory: new IDBFactory(),
    });
    await store.set('profile', phase4Profile as unknown as Profile);
    await store.set('savedMappings', {
      version: 1,
      mappings: [
        {
          key: 'v1|text|q=preferred working location|c=|i=',
          parts: { fieldType: 'text', question: 'preferred working location' },
          profileField: 'city',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    const repository = createProfileRepository(store);

    const loaded = await repository.load();
    expect(loaded).toMatchObject({
      schemaVersion: 2,
      identity: { firstName: 'Jane', lastName: 'Doe' },
      education: { institution: 'Example University', degree: 'MSc' },
      preferences: { workMode: 'hybrid', employmentType: 'contract', openToRelocation: true },
      legacy: {
        education: [{ institution: 'First College', degree: 'BSc' }],
        employmentTypes: ['full-time'],
      },
    });
    // Loading alone never writes.
    expect(await store.get('profile')).toEqual(phase4Profile);

    await repository.save(loaded);
    expect((await store.get('profile'))?.schemaVersion).toBe(2);
    expect(await repository.load()).toEqual(loaded);
    // Saved mappings are a separate record and are untouched by the upgrade.
    expect((await store.get('savedMappings'))?.mappings).toHaveLength(1);
  });
});
