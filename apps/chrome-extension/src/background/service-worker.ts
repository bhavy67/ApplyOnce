/**
 * Background service worker. MV3 can stop it at any time, so it must not keep state in
 * memory; persistent state goes through a LocalStore implementation.
 *
 * TODO(phase-1): LocalStore implementation for the profile (chrome.storage.local).
 */
export {};
