import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbStore } from './indexeddb-store';

interface TestSchema {
  greeting: string;
  settings: { enabled: boolean };
}

function createStore(factory = new IDBFactory()) {
  return createIndexedDbStore<TestSchema>({ databaseName: 'test', factory });
}

describe('IndexedDB store', () => {
  it('returns undefined for a missing key', async () => {
    expect(await createStore().get('greeting')).toBeUndefined();
  });

  it('stores, overwrites, and removes values', async () => {
    const store = createStore();

    await store.set('settings', { enabled: true });
    expect(await store.get('settings')).toEqual({ enabled: true });

    await store.set('settings', { enabled: false });
    expect(await store.get('settings')).toEqual({ enabled: false });

    await store.remove('settings');
    expect(await store.get('settings')).toBeUndefined();
  });

  it('keeps keys independent', async () => {
    const store = createStore();
    await store.set('greeting', 'hello');
    await store.set('settings', { enabled: true });
    await store.remove('settings');

    expect(await store.get('greeting')).toBe('hello');
  });

  it('persists across store instances on the same database', async () => {
    const factory = new IDBFactory();
    await createStore(factory).set('greeting', 'hello');

    expect(await createStore(factory).get('greeting')).toBe('hello');
  });
});
