import { createEmptyProfile, type Profile } from '@applyonce/profile';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MessageType } from '../messaging/protocol';
import { createIndexedDbStore } from '../storage/indexeddb-store';
import {
  createProfileRepository,
  type ExtensionStorageSchema,
  type ProfileRepository,
} from '../storage/profile-repository';
import { createServiceWorkerMessageHandler } from './message-handler';

const ORIGIN = 'chrome-extension://abcdefghijklmnop/';
const EXTENSION_PAGE = { url: `${ORIGIN}popup.html` };
const WEB_PAGE = { url: 'https://jobs.example.com/apply' };

const sampleProfile: Profile = {
  ...createEmptyProfile(),
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '+1 555 010 0199' },
};
const SENSITIVE_VALUES = ['Jane', 'Doe', 'jane.doe@example.com', '555 010 0199'];

let consoleSpies: MockInstance[];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  // Whatever happened in the test, no profile value may have reached the console.
  const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
  for (const value of SENSITIVE_VALUES) expect(logged).not.toContain(value);
  vi.restoreAllMocks();
});

async function setup(saved?: Profile) {
  const store = createIndexedDbStore<ExtensionStorageSchema>({
    databaseName: 'service-worker-test',
    factory: new IDBFactory(),
  });
  if (saved) await store.set('profile', saved);
  const writes = vi.spyOn(store, 'set');
  const removals = vi.spyOn(store, 'remove');
  const handle = createServiceWorkerMessageHandler({
    repository: createProfileRepository(store),
    extensionOrigin: ORIGIN,
  });
  return { handle, writes, removals };
}

describe('GetProfile', () => {
  it('returns the saved profile to extension pages', async () => {
    const { handle } = await setup(sampleProfile);
    expect(await handle({ type: MessageType.GetProfile }, EXTENSION_PAGE)).toEqual({
      ok: true,
      data: sampleProfile,
    });
  });

  it('returns an empty profile when nothing is saved', async () => {
    const { handle } = await setup();
    expect(await handle({ type: MessageType.GetProfile }, EXTENSION_PAGE)).toEqual({
      ok: true,
      data: createEmptyProfile(),
    });
  });

  it.each([WEB_PAGE, {}])('refuses senders that are not extension pages (%j)', async (sender) => {
    const { handle } = await setup(sampleProfile);
    expect(await handle({ type: MessageType.GetProfile }, sender)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});

describe('GetProfileStatus', () => {
  it('reports that a profile exists without returning any values', async () => {
    const { handle } = await setup(sampleProfile);
    const response = await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE);

    expect(response).toEqual({ ok: true, data: { hasData: true, valueCount: 4 } });
    for (const value of SENSITIVE_VALUES) expect(JSON.stringify(response)).not.toContain(value);
  });

  it('reports an empty profile when nothing is saved', async () => {
    const { handle } = await setup();
    expect(await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE)).toEqual({
      ok: true,
      data: { hasData: false, valueCount: 0 },
    });
  });
});

describe('invalid messages', () => {
  it.each([
    { type: 'applyonce/delete-everything' },
    // Known type, but handled by the content script, not the service worker.
    { type: MessageType.ScanPage },
  ])('rejects unknown message %j', async (message) => {
    const { handle } = await setup();
    expect(await handle(message, EXTENSION_PAGE)).toEqual({ ok: false, error: 'unknown-message' });
  });

  it.each([undefined, null, 'applyonce/get-profile', 42, [], {}, { type: 5 }])(
    'rejects malformed message %j without throwing',
    async (message) => {
      const { handle } = await setup();
      expect(await handle(message, EXTENSION_PAGE)).toEqual({
        ok: false,
        error: 'malformed-message',
      });
    },
  );
});

describe('failures and side effects', () => {
  it('reports profile-unavailable and logs no values when the repository fails', async () => {
    const failingRepository: ProfileRepository = {
      // An error message that happens to contain data must still not be logged.
      load: () => Promise.reject(new Error(`bad record for ${sampleProfile.contact.email}`)),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const handle = createServiceWorkerMessageHandler({
      repository: failingRepository,
      extensionOrigin: ORIGIN,
    });

    expect(await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE)).toEqual({
      ok: false,
      error: 'profile-unavailable',
    });
    expect(console.error).toHaveBeenCalledWith(
      'ApplyOnce: service worker applyonce/get-profile-status failed (Error)',
    );
  });

  it('reports profile-unavailable for a profile with an unsupported version', async () => {
    const { handle } = await setup({ ...sampleProfile, schemaVersion: 99 } as unknown as Profile);
    expect(await handle({ type: MessageType.GetProfile }, EXTENSION_PAGE)).toEqual({
      ok: false,
      error: 'profile-unavailable',
    });
  });

  it('never writes to storage, so no second copy of the profile is created', async () => {
    const { handle, writes, removals } = await setup(sampleProfile);
    await handle({ type: MessageType.GetProfile }, EXTENSION_PAGE);
    await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE);
    await handle({ type: 'unknown' }, WEB_PAGE);

    expect(writes).not.toHaveBeenCalled();
    expect(removals).not.toHaveBeenCalled();
  });
});
