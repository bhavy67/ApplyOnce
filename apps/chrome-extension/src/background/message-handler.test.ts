import type { FieldType, FillInstruction, FormField } from '@applyonce/core';
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
import { createServiceWorkerMessageHandler, type FillInTab } from './message-handler';

const ORIGIN = 'chrome-extension://abcdefghijklmnop/';
const EXTENSION_PAGE = { url: `${ORIGIN}popup.html` };
const WEB_PAGE = { url: 'https://jobs.example.com/apply' };

const sampleProfile: Profile = {
  ...createEmptyProfile(),
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '+1 555 010 0199' },
  location: { city: 'Springfield' },
};
const SENSITIVE_VALUES = ['Jane', 'Doe', 'jane.doe@example.com', '555 010 0199', 'Springfield'];

function field(id: string, type: FieldType, signals: FormField['signals']): FormField {
  return { id, type, htmlType: type, required: false, visible: true, disabled: false, signals };
}
const FIELDS = {
  firstName: field('id:first', 'text', { htmlId: 'first', name: 'firstName', label: 'First Name' }),
  email: field('id:email', 'email', { htmlId: 'email', name: 'email', label: 'Email' }),
  phone: field('name:phone', 'tel', { name: 'phone' }),
  postal: field('id:zip', 'text', { htmlId: 'zip', label: 'Postal code' }),
  notes: field('name:notes', 'textarea', { name: 'notes', nearbyText: 'Notes' }),
  relocate: field('name:relocate', 'checkbox', { name: 'relocate', label: 'Email' }),
};

/** Stands in for the content script: records instructions and reports them all filled. */
function recordingFillInTab() {
  const calls: { tabId: number; instructions: FillInstruction[] }[] = [];
  const fillInTab: FillInTab = (tabId, instructions) => {
    calls.push({ tabId, instructions });
    return Promise.resolve(
      instructions.map(({ fieldId }) => ({
        fieldId,
        status: 'filled' as const,
        message: 'Filled.',
      })),
    );
  };
  return { calls, fillInTab };
}

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

async function setup(saved?: Profile, fillInTab: FillInTab = recordingFillInTab().fillInTab) {
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
    fillInTab,
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

    expect(response).toEqual({ ok: true, data: { hasData: true, valueCount: 5 } });
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
    { type: MessageType.FillFields, payload: { instructions: [] } },
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
      fillInTab: recordingFillInTab().fillInTab,
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
    await handle(
      { type: MessageType.MapFields, payload: { fields: [FIELDS.email] } },
      EXTENSION_PAGE,
    );
    await handle(
      {
        type: MessageType.FillPage,
        payload: { tabId: 1, approvals: [{ field: FIELDS.email, profileField: 'email' }] },
      },
      EXTENSION_PAGE,
    );
    await handle({ type: 'unknown' }, WEB_PAGE);

    expect(writes).not.toHaveBeenCalled();
    expect(removals).not.toHaveBeenCalled();
  });
});

describe('MapFields', () => {
  it('maps fields and reports whether a value exists, without returning values', async () => {
    const { handle } = await setup(sampleProfile);
    const response = await handle(
      {
        type: MessageType.MapFields,
        payload: { fields: [FIELDS.firstName, FIELDS.postal, FIELDS.notes] },
      },
      EXTENSION_PAGE,
    );

    expect(response).toMatchObject({
      ok: true,
      data: {
        mappings: [
          { fieldId: 'id:first', status: 'mapped', profileField: 'first_name', hasValue: true },
          { fieldId: 'id:zip', status: 'mapped', profileField: 'postal_code', hasValue: false },
          { fieldId: 'name:notes', status: 'unknown', hasValue: false },
        ],
      },
    });
    for (const value of SENSITIVE_VALUES) expect(JSON.stringify(response)).not.toContain(value);
  });

  it('is refused for content scripts', async () => {
    const { handle } = await setup(sampleProfile);
    expect(
      await handle({ type: MessageType.MapFields, payload: { fields: [FIELDS.email] } }, WEB_PAGE),
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it.each([
    undefined,
    { fields: 'x' },
    { fields: [{ id: 'f', type: 'password' }] },
    { fields: [{ ...FIELDS.email, signals: { name: 42 } }] },
  ])('rejects malformed payload %j', async (payload) => {
    const { handle } = await setup();
    expect(await handle({ type: MessageType.MapFields, payload }, EXTENSION_PAGE)).toEqual({
      ok: false,
      error: 'malformed-message',
    });
  });
});

describe('FillPage', () => {
  const fillPage = (approvals: { field: FormField; profileField: string }[]) => ({
    type: MessageType.FillPage,
    payload: { tabId: 7, approvals },
  });

  it('sends only the approved field/value pairs to the page', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(sampleProfile, fillInTab);

    const response = await handle(
      fillPage([
        { field: FIELDS.firstName, profileField: 'first_name' },
        { field: FIELDS.email, profileField: 'email' },
      ]),
      EXTENSION_PAGE,
    );

    expect(calls).toEqual([
      {
        tabId: 7,
        instructions: [
          {
            fieldId: 'id:first',
            value: 'Jane',
            expected: { type: 'text', name: 'firstName', htmlId: 'first', label: 'First Name' },
          },
          {
            fieldId: 'id:email',
            value: 'jane.doe@example.com',
            expected: { type: 'email', name: 'email', htmlId: 'email', label: 'Email' },
          },
        ],
      },
    ]);
    // No other profile value (last name, phone, city, the profile object) reaches the page.
    const sent = JSON.stringify(calls);
    for (const value of ['Doe', '555 010 0199', 'Springfield', 'schemaVersion', 'identity']) {
      expect(sent).not.toContain(value);
    }
    expect(response).toEqual({
      ok: true,
      data: {
        results: [
          { fieldId: 'id:first', status: 'filled', message: 'Filled.' },
          { fieldId: 'id:email', status: 'filled', message: 'Filled.' },
        ],
      },
    });
  });

  it('checks every approval and never sends rejected ones to the page', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(sampleProfile, fillInTab);

    const response = await handle(
      fillPage([
        { field: FIELDS.postal, profileField: 'postal_code' }, // no value saved
        { field: FIELDS.notes, profileField: 'address' }, // mapper found no match
        { field: FIELDS.firstName, profileField: 'last_name' }, // not what the mapper matched
        { field: FIELDS.email, profileField: 'favourite_colour' }, // not a profile field
        { field: FIELDS.relocate, profileField: 'email' }, // checkbox cannot hold an email
        { field: FIELDS.phone, profileField: 'phone' }, // review-level match: allowed when approved
      ]),
      EXTENSION_PAGE,
    );

    expect(response.ok && (response.data as { results: { status: string }[] }).results).toEqual([
      expect.objectContaining({ fieldId: 'id:zip', status: 'skipped' }),
      expect.objectContaining({ fieldId: 'name:notes', status: 'failed' }),
      expect.objectContaining({ fieldId: 'id:first', status: 'failed' }),
      expect.objectContaining({
        fieldId: 'id:email',
        status: 'failed',
        message: 'Invalid mapping.',
      }),
      expect.objectContaining({ fieldId: 'name:relocate', status: 'unsupported' }),
      expect.objectContaining({ fieldId: 'name:phone', status: 'filled' }),
    ]);
    expect(calls.flatMap((c) => c.instructions.map((i) => i.fieldId))).toEqual(['name:phone']);
  });

  it('does not contact the page when nothing is fillable', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(createEmptyProfile(), fillInTab);
    await handle(fillPage([{ field: FIELDS.email, profileField: 'email' }]), EXTENSION_PAGE);
    expect(calls).toEqual([]);
  });

  it('reports failures when the page cannot be reached', async () => {
    const { handle } = await setup(sampleProfile, () => Promise.resolve(undefined));
    expect(
      await handle(fillPage([{ field: FIELDS.email, profileField: 'email' }]), EXTENSION_PAGE),
    ).toEqual({
      ok: true,
      data: {
        results: [
          {
            fieldId: 'id:email',
            status: 'failed',
            message: 'The page did not respond. Analyze it again.',
          },
        ],
      },
    });
  });

  it('is refused for content scripts', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(sampleProfile, fillInTab);
    expect(
      await handle(fillPage([{ field: FIELDS.email, profileField: 'email' }]), WEB_PAGE),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(calls).toEqual([]);
  });

  it.each([
    { tabId: 'x', approvals: [] },
    { tabId: 1, approvals: [{ field: {}, profileField: 'email' }] },
    { tabId: 1 },
  ])('rejects malformed payload %j', async (payload) => {
    const { handle } = await setup();
    expect(await handle({ type: MessageType.FillPage, payload }, EXTENSION_PAGE)).toEqual({
      ok: false,
      error: 'malformed-message',
    });
  });
});
