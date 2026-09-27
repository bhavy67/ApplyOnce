import { isRecordId, type ProfileRecordCollection } from '@applyonce/core';

/** Web Crypto, present in every context the profile runs in (extension pages, workers, tests). */
const webCrypto = (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto;

/** A new record's id: a random UUID from a cryptographically strong source. */
export function newRecordId(): string {
  return webCrypto.randomUUID();
}

/**
 * The id given, once, to a record stored without one (profiles from before schema 4): "m-"
 * and 16 hex digits hashed from the collection, its stored position, and its stored content.
 * Deterministic, so every load of the same stored profile (profile page, service worker)
 * gives the record the same id until the profile is saved with it; after that it is read
 * from storage and never computed again. Reordering later does not change it.
 */
export function derivedRecordId(
  collection: ProfileRecordCollection,
  index: number,
  record: Readonly<Record<string, unknown>>,
  attempt = 0,
): string {
  const content = JSON.stringify(
    Object.keys(record)
      .filter((key) => key !== 'id')
      .sort()
      .map((key) => [key, record[key]]),
  );
  const text = `${collection}|${index}|${attempt}|${content}`;
  return `m-${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193)}`;
}

/**
 * Every record with a valid, unique id keeps it; any other record (no id, a malformed id, or
 * a duplicate) gets a derived one. Values are never changed.
 */
export function withRecordIds<T extends Record<string, unknown>>(
  collection: ProfileRecordCollection,
  records: readonly T[],
): (T & { id: string })[] {
  const used = new Set<string>();
  return records.map((record, index) => {
    let id = isRecordId(record.id) && !used.has(record.id) ? record.id : undefined;
    for (let attempt = 0; !id || used.has(id); attempt += 1) {
      id = derivedRecordId(collection, index, record, attempt);
    }
    used.add(id);
    return { ...record, id };
  });
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
