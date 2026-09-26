/**
 * Background service worker. MV3 can stop it at any time, so it must not keep state in
 * memory. Persistent state lives in IndexedDB (see src/storage).
 *
 * TODO(phase-2): give content scripts access to the profile through messaging; they run
 * in the page's origin and cannot read the extension's IndexedDB directly.
 */
export {};
