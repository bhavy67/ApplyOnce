/**
 * Local persistence boundary. Implementations come later (chrome.storage / IndexedDB
 * in the extension); nothing here talks to a server.
 *
 * `TSchema` maps each storage key to the type stored under it.
 */
export interface LocalStore<TSchema extends object> {
  get<K extends keyof TSchema & string>(key: K): Promise<TSchema[K] | undefined>;
  set<K extends keyof TSchema & string>(key: K, value: TSchema[K]): Promise<void>;
  remove(key: keyof TSchema & string): Promise<void>;
}
