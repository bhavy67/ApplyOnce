import type { LocalStore } from '@applyonce/core';

/** IndexedDB schema version (object stores), independent of the profile schema version. */
const DATABASE_VERSION = 1;
const OBJECT_STORE = 'records';

export interface IndexedDbStoreOptions {
  databaseName: string;
  /** Defaults to the browser's `indexedDB`. Tests pass an isolated factory. */
  factory?: IDBFactory;
}

/**
 * `LocalStore` backed by IndexedDB, in the extension's own origin. Data stays in this
 * browser profile and is removed when the extension is uninstalled.
 */
export function createIndexedDbStore<TSchema extends object>({
  databaseName,
  factory = indexedDB,
}: IndexedDbStoreOptions): LocalStore<TSchema> {
  let database: Promise<IDBDatabase> | undefined;

  async function run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    database ??= openDatabase(factory, databaseName);
    const transaction = (await database).transaction(OBJECT_STORE, mode);
    const request = operation(transaction.objectStore(OBJECT_STORE));
    // Resolve on transaction completion so writes are committed before we report success.
    return new Promise<T>((resolve, reject) => {
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB error'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  return {
    get: (key) => run('readonly', (store) => store.get(key)),
    set: async (key, value) => {
      await run('readwrite', (store) => store.put(value, key));
    },
    remove: (key) => run('readwrite', (store) => store.delete(key)),
  };
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      // Future object-store changes go here, keyed on the old version.
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Let a newer version of the extension upgrade the database.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by an open tab'));
  });
}
