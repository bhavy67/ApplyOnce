import type { FieldType, FillInstruction, FormField } from '@applyonce/core';
import { createEmptyProfile, type Profile } from '@applyonce/profile';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MessageType, type AssignmentView, type ReviewedMapping } from '../messaging/protocol';
import { createIndexedDbStore } from '../storage/indexeddb-store';
import {
  createProfileRepository,
  type ExtensionStorageSchema,
  type ProfileRepository,
} from '../storage/profile-repository';
import { createRecordAssignmentRepository } from '../storage/record-assignment-repository';
import { createSavedMappingRepository } from '../storage/saved-mapping-repository';
import { createServiceWorkerMessageHandler, type FillInTab, type ScanTab } from './message-handler';

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

/**
 * Stands in for the re-scan before filling: by default the page still shows exactly the
 * approved fields; a test can pass its own scan to change the page between Analyze and Fill.
 */
async function setup(
  saved?: Profile,
  fillInTab: FillInTab = recordingFillInTab().fillInTab,
  scanTab?: ScanTab,
) {
  let approvedFields: FormField[] = [];
  const store = createIndexedDbStore<ExtensionStorageSchema>({
    databaseName: 'service-worker-test',
    factory: new IDBFactory(),
  });
  if (saved) await store.set('profile', saved);
  const writes = vi.spyOn(store, 'set');
  const removals = vi.spyOn(store, 'remove');
  const handler = createServiceWorkerMessageHandler({
    repository: createProfileRepository(store),
    mappings: createSavedMappingRepository(store),
    assignments: createRecordAssignmentRepository(store),
    extensionOrigin: ORIGIN,
    fillInTab,
    scanTab: scanTab ?? (() => Promise.resolve(approvedFields)),
  });
  const handle = (message: unknown, sender: { url?: string }) => {
    const payload = (message as { payload?: { approvals?: { field: FormField }[] } } | null)
      ?.payload;
    if (Array.isArray(payload?.approvals)) approvedFields = payload.approvals.map((a) => a.field);
    return handler(message, sender);
  };
  return { handle, writes, removals, store };
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
    const response = await handle({ type: MessageType.GetProfileStatus }, EXTENSION_PAGE);

    expect(response).toEqual({ ok: true, data: { hasData: true, valueCount: 5 } });
    for (const value of SENSITIVE_VALUES) expect(JSON.stringify(response)).not.toContain(value);
  });

  it('reports an empty profile when nothing is saved', async () => {
    const { handle } = await setup();
    expect(await handle({ type: MessageType.GetProfileStatus }, EXTENSION_PAGE)).toEqual({
      ok: true,
      data: { hasData: false, valueCount: 0 },
    });
  });

  it('Phase 17: is refused to content scripts (web page senders), like every other message', async () => {
    const { handle } = await setup(sampleProfile);
    expect(await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE)).toEqual({
      ok: false,
      error: 'forbidden',
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
      mappings: createSavedMappingRepository(
        createIndexedDbStore<ExtensionStorageSchema>({
          databaseName: 'x',
          factory: new IDBFactory(),
        }),
      ),
      assignments: createRecordAssignmentRepository(
        createIndexedDbStore<ExtensionStorageSchema>({
          databaseName: 'x',
          factory: new IDBFactory(),
        }),
      ),
      extensionOrigin: ORIGIN,
      fillInTab: recordingFillInTab().fillInTab,
      scanTab: () => Promise.resolve([]),
    });

    expect(await handle({ type: MessageType.GetProfileStatus }, EXTENSION_PAGE)).toEqual({
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
        { field: FIELDS.relocate, profileField: 'email' }, // checkbox cannot hold an email
        { field: FIELDS.phone, profileField: 'phone' }, // review-level match: allowed when approved
      ]),
      EXTENSION_PAGE,
    );

    expect(response.ok && (response.data as { results: { status: string }[] }).results).toEqual([
      expect.objectContaining({ fieldId: 'id:zip', status: 'skipped' }),
      expect.objectContaining({ fieldId: 'name:notes', status: 'failed' }),
      expect.objectContaining({ fieldId: 'id:first', status: 'failed' }),
      expect.objectContaining({ fieldId: 'name:relocate', status: 'unsupported' }),
      expect.objectContaining({ fieldId: 'name:phone', status: 'filled' }),
    ]);
    expect(calls.flatMap((c) => c.instructions.map((i) => i.fieldId))).toEqual(['name:phone']);
  });

  it('Phase 17: an approval naming a non-canonical profile target is refused as malformed', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(sampleProfile, fillInTab);
    for (const profileField of [
      'favourite_colour',
      '__proto__',
      'identity.firstName',
      'constructor',
    ]) {
      expect(
        await handle(fillPage([{ field: FIELDS.email, profileField }]), EXTENSION_PAGE),
      ).toEqual({ ok: false, error: 'malformed-message' });
    }
    expect(calls).toEqual([]);
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

describe('Teach Once: SaveMapping, ListMappings, DeleteMapping, ClearMappings', () => {
  const preferred = field('id:pref', 'text', {
    htmlId: 'pref',
    name: 'q17',
    label: 'Preferred Working Location',
  });
  const save = (target: FormField, profileField: string, site?: string) => ({
    type: MessageType.SaveMapping,
    payload: { field: target, profileField, ...(site ? { site } : {}) },
  });
  const mapOne = async (handle: Awaited<ReturnType<typeof setup>>['handle'], target: FormField) => {
    const response = await handle(
      { type: MessageType.MapFields, payload: { fields: [target] } },
      EXTENSION_PAGE,
    );
    return response.ok ? (response.data as { mappings: ReviewedMapping[] }).mappings[0] : undefined;
  };
  const fillOne = (target: FormField, profileField: string) => ({
    type: MessageType.FillPage,
    payload: { tabId: 7, approvals: [{ field: target, profileField }] },
  });

  it('teaches an unknown field; the current result updates and nothing is filled', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(sampleProfile, fillInTab);
    expect(await mapOne(handle, preferred)).toMatchObject({
      status: 'unknown',
      source: 'automatic',
    });

    const response = await handle(save(preferred, 'city', 'jobs.example.com'), EXTENSION_PAGE);

    expect(response).toEqual({
      ok: true,
      data: {
        mapping: expect.objectContaining({
          fieldId: 'id:pref',
          status: 'taught',
          source: 'taught',
          profileField: 'city',
          hasValue: true,
        }),
      },
    });
    expect(calls).toEqual([]);
    expect(await mapOne(handle, preferred)).toMatchObject({
      status: 'taught',
      profileField: 'city',
    });
  });

  it('teaches a review-level field', async () => {
    const { handle } = await setup(sampleProfile);
    expect((await mapOne(handle, FIELDS.phone))?.status).toBe('review');
    await handle(save(FIELDS.phone, 'phone'), EXTENSION_PAGE);
    expect(await mapOne(handle, FIELDS.phone)).toMatchObject({
      status: 'taught',
      profileField: 'phone',
    });
  });

  it('applies a taught mapping to the same question on another site, but not to different questions', async () => {
    const { handle } = await setup(sampleProfile);
    await handle(save(preferred, 'city'), EXTENSION_PAGE);
    const elsewhere = field('name:location', 'text', {
      name: 'location',
      label: 'Preferred working location:',
    });
    const different = field('id:cur', 'text', { htmlId: 'cur', label: 'Current location' });

    expect((await mapOne(handle, elsewhere))?.status).toBe('taught');
    expect((await mapOne(handle, different))?.status).toBe('unknown');
  });

  it('fills a taught field only after explicit approval, with only its value', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(sampleProfile, fillInTab);
    await handle(save(preferred, 'city'), EXTENSION_PAGE);

    expect(await handle(fillOne(preferred, 'city'), EXTENSION_PAGE)).toMatchObject({
      ok: true,
      data: { results: [{ fieldId: 'id:pref', status: 'filled' }] },
    });
    expect(calls.map((c) => c.instructions.map((i) => i.value))).toEqual([['Springfield']]);
  });

  it('re-mapping replaces the previous target, which is then refused', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(sampleProfile, fillInTab);
    await handle(save(preferred, 'city'), EXTENSION_PAGE);
    await handle(save(preferred, 'full_name'), EXTENSION_PAGE);

    const listed = await handle({ type: MessageType.ListMappings }, EXTENSION_PAGE);
    expect(listed).toMatchObject({ ok: true, data: { mappings: [{ profileField: 'full_name' }] } });
    expect(await mapOne(handle, preferred)).toMatchObject({
      status: 'taught',
      profileField: 'full_name',
    });

    const stale = await handle(fillOne(preferred, 'city'), EXTENSION_PAGE);
    expect(stale).toMatchObject({ data: { results: [{ status: 'failed' }] } });
    await handle(fillOne(preferred, 'full_name'), EXTENSION_PAGE);
    expect(calls.map((c) => c.instructions.map((i) => i.value))).toEqual([['Jane Doe']]);
  });

  it('after deletion the mapping is no longer used and deterministic mapping resumes', async () => {
    const { handle } = await setup(sampleProfile);
    await handle(save(FIELDS.email, 'email'), EXTENSION_PAGE);
    const taught = await mapOne(handle, FIELDS.email);
    expect(taught).toMatchObject({ status: 'taught' });

    const deleted = await handle(
      { type: MessageType.DeleteMapping, payload: { key: taught?.mappingKey } },
      EXTENSION_PAGE,
    );
    expect(deleted).toEqual({ ok: true, data: { deleted: true } });
    expect(await mapOne(handle, FIELDS.email)).toMatchObject({
      status: 'mapped',
      source: 'automatic',
    });
    // A taught approval made before deletion is no longer honoured for unknown fields.
    await handle(save(preferred, 'city'), EXTENSION_PAGE);
    await handle({ type: MessageType.ClearMappings }, EXTENSION_PAGE);
    expect(await handle(fillOne(preferred, 'city'), EXTENSION_PAGE)).toMatchObject({
      data: { results: [{ status: 'failed' }] },
    });
  });

  it('does not delete or change profile values', async () => {
    const { handle, store } = await setup(sampleProfile);
    await handle(save(preferred, 'city'), EXTENSION_PAGE);
    await handle({ type: MessageType.ClearMappings }, EXTENSION_PAGE);
    expect(await store.get('profile')).toEqual(sampleProfile);
  });

  it.each([
    // Phase 17: a non-canonical target is refused at the message boundary.
    ['favourite_colour', preferred, 'malformed-message'],
    ['location.city', preferred, 'malformed-message'],
    // Canonical targets that do not fit the field are refused by the service worker.
    ['email', field('name:r', 'radio', { name: 'r', label: 'Contact me?' }), 'invalid-mapping'],
    ['city', field('index:3', 'text', {}), 'invalid-mapping'],
  ] as const)(
    'rejects invalid target %j and stores nothing',
    async (profileField, target, error) => {
      const { handle, store } = await setup(sampleProfile);
      expect(await handle(save(target, profileField), EXTENSION_PAGE)).toEqual({
        ok: false,
        error,
      });
      expect(await store.get('savedMappings')).toBeUndefined();
    },
  );

  it('stores no profile values in the saved mapping', async () => {
    const { handle, store } = await setup(sampleProfile);
    await handle(save(preferred, 'city', 'jobs.example.com'), EXTENSION_PAGE);
    const stored = JSON.stringify(await store.get('savedMappings'));
    for (const value of SENSITIVE_VALUES) expect(stored).not.toContain(value);
  });

  it.each([
    [MessageType.SaveMapping, { field: preferred, profileField: 'city' }],
    [MessageType.ListMappings, undefined],
    [MessageType.DeleteMapping, { key: 'v1|text|q=x|c=|i=' }],
    [MessageType.ClearMappings, undefined],
  ])('refuses %s from content scripts', async (type, payload) => {
    const { handle, store } = await setup(sampleProfile);
    const message = payload === undefined ? { type } : { type, payload };
    expect(await handle(message, WEB_PAGE)).toEqual({ ok: false, error: 'forbidden' });
    expect(await store.get('savedMappings')).toBeUndefined();
  });

  it.each([
    [MessageType.SaveMapping, { field: {}, profileField: 'city' }],
    [MessageType.SaveMapping, { field: preferred, profileField: 7 }],
    [MessageType.SaveMapping, { field: preferred, profileField: 'city', site: 'https://x.com/a' }],
    [MessageType.DeleteMapping, { key: 42 }],
    [MessageType.DeleteMapping, { key: 'not-a-key' }],
    [MessageType.DeleteMapping, undefined],
  ])('rejects malformed %s payload %j', async (type, payload) => {
    const { handle } = await setup();
    expect(await handle({ type, payload }, EXTENSION_PAGE)).toEqual({
      ok: false,
      error: 'malformed-message',
    });
  });

  it('keeps working without taught mappings when saved mappings cannot be read', async () => {
    const { handle, store } = await setup(sampleProfile);
    await store.set('savedMappings', {
      version: 99,
      mappings: [],
    } as unknown as ExtensionStorageSchema['savedMappings']);
    expect(await mapOne(handle, FIELDS.email)).toMatchObject({ status: 'mapped' });
    expect(await handle({ type: MessageType.ListMappings }, EXTENSION_PAGE)).toEqual({
      ok: false,
      error: 'mappings-unavailable',
    });
  });
});

describe('Phase 5 fields through the service worker', () => {
  const phase5Profile: Profile = {
    ...sampleProfile,
    links: { github: 'https://github.com/jane-doe-example', website: 'https://jane.example.com' },
    experience: {
      currentTitle: 'Staff Engineer',
      currentCompany: 'Example Co',
      totalExperienceYears: 7,
    },
    preferences: { workMode: 'hybrid', employmentType: 'full-time', openToRelocation: true },
    education: [
      {
        degree: 'MSc',
        fieldOfStudy: 'Physics',
        institution: 'Example University',
        graduationYear: 2019,
      },
    ],
  };
  const NEW_VALUES = [
    'github.com/jane-doe-example',
    'jane.example.com',
    'Staff Engineer',
    'Example Co',
    'Physics',
    'Example University',
  ];
  const preferredType = field('id:ptype', 'select', {
    htmlId: 'ptype',
    label: 'What kind of role are you looking for?',
  });

  it('teaches a new profile field, then fills only its canonical value after approval', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(phase5Profile, fillInTab);
    const before = await handle(
      { type: MessageType.MapFields, payload: { fields: [preferredType] } },
      EXTENSION_PAGE,
    );
    expect(before).toMatchObject({ data: { mappings: [{ status: 'unknown' }] } });

    const taught = await handle(
      {
        type: MessageType.SaveMapping,
        payload: { field: preferredType, profileField: 'employment_type' },
      },
      EXTENSION_PAGE,
    );
    expect(taught).toMatchObject({
      data: { mapping: { status: 'taught', profileField: 'employment_type', hasValue: true } },
    });
    expect(calls).toEqual([]);

    await handle(
      {
        type: MessageType.FillPage,
        payload: {
          tabId: 7,
          approvals: [{ field: preferredType, profileField: 'employment_type' }],
        },
      },
      EXTENSION_PAGE,
    );
    expect(calls.map((c) => c.instructions.map((i) => i.value))).toEqual([['full-time']]);
  });

  it('refuses a stored mapping to a profile field this version does not have, but still lists it', async () => {
    const { handle, store } = await setup(phase5Profile);
    await store.set('savedMappings', {
      version: 1,
      mappings: [
        {
          key: 'v1|text|q=employer|c=|i=',
          parts: { fieldType: 'text', question: 'employer' },
          profileField: 'favourite_colour' as 'city',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    const employer = field('id:emp', 'text', { htmlId: 'emp', label: 'Employer' });

    expect(
      await handle(
        { type: MessageType.MapFields, payload: { fields: [employer] } },
        EXTENSION_PAGE,
      ),
    ).toMatchObject({
      data: {
        mappings: [{ status: 'mapped', source: 'automatic', profileField: 'current_company' }],
      },
    });
    expect(await handle({ type: MessageType.ListMappings }, EXTENSION_PAGE)).toMatchObject({
      data: { mappings: [{ profileField: 'favourite_colour' }] },
    });
  });

  it('does not leak new profile values through status, mapping, or logs', async () => {
    const { handle } = await setup(phase5Profile);
    const status = await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE);
    const fields = [
      field('id:t', 'text', { htmlId: 't', label: 'Job Title' }),
      field('id:w', 'text', { htmlId: 'w', label: 'Website' }),
      field('id:u', 'text', { htmlId: 'u', label: 'University' }),
    ];
    const mapped = await handle(
      { type: MessageType.MapFields, payload: { fields } },
      EXTENSION_PAGE,
    );
    const text = JSON.stringify([status, mapped]);
    for (const value of NEW_VALUES) expect(text).not.toContain(value);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('GetRuntimeInfo', () => {
  it('returns only the build id, to extension pages', async () => {
    const { handle } = await setup(sampleProfile);
    expect(await handle({ type: MessageType.GetRuntimeInfo }, EXTENSION_PAGE)).toEqual({
      ok: true,
      data: { buildId: 'development' },
    });
  });

  it('is refused for content scripts', async () => {
    const { handle } = await setup(sampleProfile);
    expect(await handle({ type: MessageType.GetRuntimeInfo }, WEB_PAGE)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});

describe('Phase 10: repeatable records through the service worker', () => {
  const recordsProfile: Profile = {
    ...sampleProfile,
    experience: { currentCompany: 'Current Co', currentTitle: 'Staff Engineer' },
    education: [
      { institution: 'University of Example', fieldOfStudy: 'Physics', graduationYear: 2021 },
      { institution: 'Sample College', graduationYear: 2016 },
    ],
    workExperience: [
      { company: 'Current Co', title: 'Staff Engineer', current: true },
      { company: 'Previous Employer Ltd', title: 'Engineer', endDate: '2020-12' },
    ],
    certifications: [
      { name: 'Example Certified', credentialUrl: 'https://cert.example.com/secret-id' },
    ],
  };
  const RECORD_VALUES = [
    'University of Example',
    'Sample College',
    'Previous Employer Ltd',
    'Example Certified',
    'cert.example.com',
  ];
  const previousUniversity = field('id:pu', 'text', {
    htmlId: 'pu',
    label: 'Previous university',
  });
  const previousEmployer = field('id:pe', 'text', { htmlId: 'pe', label: 'Previous employer' });
  const university = field('id:u', 'text', { htmlId: 'u', label: 'University' });

  async function teach(
    handle: Awaited<ReturnType<typeof setup>>['handle'],
    f: FormField,
    target: string,
  ) {
    return handle(
      { type: MessageType.SaveMapping, payload: { field: f, profileField: target } },
      EXTENSION_PAGE,
    );
  }
  async function fillOne(
    handle: Awaited<ReturnType<typeof setup>>['handle'],
    f: FormField,
    profileField: string,
  ) {
    return handle(
      {
        type: MessageType.FillPage,
        payload: { tabId: 3, approvals: [{ field: f, profileField }] },
      },
      EXTENSION_PAGE,
    );
  }

  it('reports record counts (never values) with the mappings, only to extension pages', async () => {
    const { handle } = await setup(recordsProfile);
    const mapped = await handle(
      { type: MessageType.MapFields, payload: { fields: [university] } },
      EXTENSION_PAGE,
    );
    expect(mapped).toMatchObject({
      ok: true,
      data: {
        mappings: [{ status: 'mapped', profileField: 'institution', hasValue: true }],
        records: { education: 2, workExperience: 2, certifications: 1 },
      },
    });
    for (const value of RECORD_VALUES) expect(JSON.stringify(mapped)).not.toContain(value);
    expect(
      await handle({ type: MessageType.MapFields, payload: { fields: [university] } }, WEB_PAGE),
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('automatic mapping fills the primary education record only', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(recordsProfile, fillInTab);
    await fillOne(handle, university, 'institution');
    expect(calls.map((c) => c.instructions.map((i) => i.value))).toEqual([
      ['University of Example'],
    ]);
  });

  it('teaches "Previous university" → Education 2 → Institution; fills only after approval', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(recordsProfile, fillInTab);
    expect(await teach(handle, previousUniversity, 'education[1].institution')).toMatchObject({
      ok: true,
      data: {
        mapping: {
          status: 'taught',
          source: 'taught',
          profileField: 'education[1].institution',
          hasValue: true,
        },
      },
    });
    expect(calls).toEqual([]);
    await fillOne(handle, previousUniversity, 'education[1].institution');
    expect(calls.map((c) => c.instructions)).toEqual([
      [
        {
          fieldId: 'id:pu',
          value: 'Sample College',
          expected: { type: 'text', htmlId: 'pu', label: 'Previous university' },
        },
      ],
    ]);
  });

  it('teaches "Previous employer" → Work experience 2 → Company', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(recordsProfile, fillInTab);
    await teach(handle, previousEmployer, 'workExperience[1].company');
    await fillOne(handle, previousEmployer, 'workExperience[1].company');
    expect(calls.map((c) => c.instructions.map((i) => i.value))).toEqual([
      ['Previous Employer Ltd'],
    ]);
  });

  it('stores a primary-record target under its scalar key', async () => {
    const { handle } = await setup(recordsProfile);
    await teach(handle, previousUniversity, 'education[0].institution');
    expect(await handle({ type: MessageType.ListMappings }, EXTENSION_PAGE)).toMatchObject({
      data: { mappings: [{ profileField: 'institution' }] },
    });
  });

  it.each(['education[1].gpa', 'education.institution', 'education[20].institution', 'legacy'])(
    'refuses to save the invalid target %j',
    async (target) => {
      const { handle } = await setup(recordsProfile);
      // Phase 17: a non-canonical target is refused at the message boundary.
      expect(await teach(handle, previousUniversity, target)).toEqual({
        ok: false,
        error: 'malformed-message',
      });
    },
  );

  it('refuses an approval that does not match the taught record', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(recordsProfile, fillInTab);
    await teach(handle, previousUniversity, 'education[1].institution');
    const result = await fillOne(handle, previousUniversity, 'certifications[0].name');
    expect(result).toMatchObject({ data: { results: [{ status: 'failed' }] } });
    expect(calls).toEqual([]);
  });

  it('skips a taught record that does not exist (or was removed) instead of guessing', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle, store } = await setup(recordsProfile, fillInTab);
    await teach(handle, previousUniversity, 'education[1].institution');
    await store.set('profile', {
      ...recordsProfile,
      education: recordsProfile.education.slice(0, 1),
    });
    const mapped = await handle(
      { type: MessageType.MapFields, payload: { fields: [previousUniversity] } },
      EXTENSION_PAGE,
    );
    expect(mapped).toMatchObject({
      data: { mappings: [{ status: 'taught', hasValue: false }], records: { education: 1 } },
    });
    expect(await fillOne(handle, previousUniversity, 'education[1].institution')).toMatchObject({
      data: { results: [{ status: 'skipped' }] },
    });
    expect(calls).toEqual([]);
  });

  it('deleting a mapping never changes the profile records', async () => {
    const { handle, store } = await setup(recordsProfile);
    await teach(handle, previousUniversity, 'education[1].institution');
    const listed = await handle({ type: MessageType.ListMappings }, EXTENSION_PAGE);
    const key = (listed as { data: { mappings: { key: string }[] } }).data.mappings[0]?.key ?? '';
    await handle({ type: MessageType.DeleteMapping, payload: { key } }, EXTENSION_PAGE);
    await handle({ type: MessageType.ClearMappings }, EXTENSION_PAGE);
    expect(await store.get('profile')).toEqual(recordsProfile);
  });

  it('never sends record values to web pages', async () => {
    const { handle } = await setup(recordsProfile);
    expect(await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    const status = await handle({ type: MessageType.GetProfileStatus }, EXTENSION_PAGE);
    expect(status).toMatchObject({ ok: true, data: { hasData: true } });
    expect(Object.keys((status as { data: object }).data).sort()).toEqual([
      'hasData',
      'valueCount',
    ]);
    for (const value of RECORD_VALUES) expect(JSON.stringify(status)).not.toContain(value);
    expect(await handle({ type: MessageType.GetProfile }, WEB_PAGE)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});

describe('Phase 11: repeated application sections', () => {
  const profile: Profile = {
    ...sampleProfile,
    experience: { currentCompany: 'Current Co', currentTitle: 'Staff Engineer' },
    education: [
      { institution: 'University A', degree: 'BSc', fieldOfStudy: 'Physics', graduationYear: 2014 },
      { institution: 'University B', fieldOfStudy: 'Computer Science' },
    ],
    workExperience: [
      { company: 'Company A', title: 'Title A', current: true },
      {
        company: 'Company B',
        title: 'Title B',
        location: 'Remote',
        startDate: '2018-01',
        endDate: '2020-12',
        description: 'Built things.',
      },
    ],
    certifications: [
      {
        name: 'Certification A',
        issuer: 'Issuer A',
        issueYear: 2020,
        credentialUrl: 'https://cert.example.com/a',
      },
    ],
  };
  const inRecord = (
    id: string,
    label: string,
    collection: 'education' | 'workExperience' | 'certifications',
    index: number,
    type: FieldType = 'text',
  ): FormField => ({
    ...field(id, type, { htmlId: id.slice(3), label }),
    record: { collection, index },
  });
  const FIELDS3 = {
    inst1: inRecord('id:i1', 'Institution', 'education', 0),
    inst2: inRecord('id:i2', 'Institution', 'education', 1),
    deg2: inRecord('id:d2', 'Degree', 'education', 1),
    fos2: inRecord('id:f2', 'Field of Study', 'education', 1),
    grad2: inRecord('id:g2', 'Graduation Year', 'education', 1, 'number'),
    inst3: inRecord('id:i3', 'Institution', 'education', 2),
    comp2: inRecord('id:c2', 'Company', 'workExperience', 1),
    cur1: inRecord('id:cur1', 'I currently work here', 'workExperience', 0, 'checkbox'),
    certUrl1: inRecord('id:u1', 'Credential URL', 'certifications', 0),
  };

  async function map(handle: Awaited<ReturnType<typeof setup>>['handle'], fields: FormField[]) {
    const response = await handle(
      { type: MessageType.MapFields, payload: { fields } },
      EXTENSION_PAGE,
    );
    return (response as { data: { mappings: ReviewedMapping[] } }).data.mappings;
  }

  it('maps each record field to its own record; only the primary education is automatic', async () => {
    const { handle } = await setup(profile);
    const mappings = await map(handle, Object.values(FIELDS3));
    expect(mappings.map((m) => [m.profileField, m.status, m.hasValue])).toEqual([
      ['institution', 'mapped', true],
      ['education[1].institution', 'review', true],
      ['education[1].degree', 'review', false],
      ['education[1].fieldOfStudy', 'review', true],
      ['education[1].graduationYear', 'review', false],
      ['education[2].institution', 'review', false],
      ['workExperience[1].company', 'review', true],
      ['workExperience[0].current', 'review', true],
      ['certifications[0].credentialUrl', 'review', true],
    ]);
    expect(mappings.every((m) => m.mappingKey === undefined)).toBe(true);
  });

  it('fills approved record fields with exactly their values, tied to their record', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile, fillInTab);
    const approvals = [
      { field: FIELDS3.inst1, profileField: 'institution' },
      { field: FIELDS3.inst2, profileField: 'education[1].institution' },
      { field: FIELDS3.fos2, profileField: 'education[1].fieldOfStudy' },
      { field: FIELDS3.comp2, profileField: 'workExperience[1].company' },
      { field: FIELDS3.cur1, profileField: 'workExperience[0].current' },
      { field: FIELDS3.certUrl1, profileField: 'certifications[0].credentialUrl' },
    ];
    await handle({ type: MessageType.FillPage, payload: { tabId: 4, approvals } }, EXTENSION_PAGE);
    expect(calls[0]?.instructions.map((i) => [i.fieldId, i.value, i.expected.record])).toEqual([
      ['id:i1', 'University A', { collection: 'education', index: 0 }],
      ['id:i2', 'University B', { collection: 'education', index: 1 }],
      ['id:f2', 'Computer Science', { collection: 'education', index: 1 }],
      ['id:c2', 'Company B', { collection: 'workExperience', index: 1 }],
      ['id:cur1', true, { collection: 'workExperience', index: 0 }],
      ['id:u1', 'https://cert.example.com/a', { collection: 'certifications', index: 0 }],
    ]);
  });

  it('never fills a missing record or a blank field of a partial record', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile, fillInTab);
    const response = await handle(
      {
        type: MessageType.FillPage,
        payload: {
          tabId: 4,
          approvals: [
            { field: FIELDS3.inst3, profileField: 'education[2].institution' },
            { field: FIELDS3.deg2, profileField: 'education[1].degree' },
            { field: FIELDS3.grad2, profileField: 'education[1].graduationYear' },
          ],
        },
      },
      EXTENSION_PAGE,
    );
    expect(response).toMatchObject({
      data: { results: [{ status: 'skipped' }, { status: 'skipped' }, { status: 'skipped' }] },
    });
    expect(calls).toEqual([]);
  });

  it('refuses approvals that do not match the field’s own record', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile, fillInTab);
    const response = await handle(
      {
        type: MessageType.FillPage,
        payload: {
          tabId: 4,
          approvals: [
            { field: FIELDS3.inst2, profileField: 'institution' },
            { field: FIELDS3.inst2, profileField: 'education[0].institution' },
            { field: FIELDS3.comp2, profileField: 'current_company' },
            { field: FIELDS3.comp2, profileField: 'workExperience[0].company' },
          ],
        },
      },
      EXTENSION_PAGE,
    );
    expect(response).toMatchObject({
      data: { results: Array.from({ length: 4 }, () => ({ status: 'failed' })) },
    });
    expect(calls).toEqual([]);
  });

  it('resolves positions: after reordering the profile, the same field gets the new record', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const reordered = {
      ...profile,
      education: [profile.education[1] ?? {}, profile.education[0] ?? {}],
    };
    const { handle } = await setup(reordered, fillInTab);
    await handle(
      {
        type: MessageType.FillPage,
        payload: {
          tabId: 4,
          approvals: [{ field: FIELDS3.inst2, profileField: 'education[1].institution' }],
        },
      },
      EXTENSION_PAGE,
    );
    expect(calls[0]?.instructions.map((i) => i.value)).toEqual(['University A']);
  });

  it('cannot save a Teach Once mapping for a field in a repeated section', async () => {
    const { handle } = await setup(profile);
    expect(
      await handle(
        {
          type: MessageType.SaveMapping,
          payload: { field: FIELDS3.inst2, profileField: 'education[1].institution' },
        },
        EXTENSION_PAGE,
      ),
    ).toEqual({ ok: false, error: 'invalid-mapping' });
  });

  it('returns no record values while mapping', async () => {
    const { handle } = await setup(profile);
    const response = await handle(
      { type: MessageType.MapFields, payload: { fields: Object.values(FIELDS3) } },
      EXTENSION_PAGE,
    );
    for (const value of [
      'University A',
      'University B',
      'Company B',
      'Certification A',
      'cert.example.com',
    ]) {
      expect(JSON.stringify(response)).not.toContain(value);
    }
  });
});

describe('Phase 12: repeated questions without record context', () => {
  const profile12: Profile = {
    ...sampleProfile,
    education: [
      { institution: 'University A', degree: 'Degree A' },
      { institution: 'University B', degree: 'Degree B' },
    ],
  };
  const degree = (id: string): FormField => ({
    ...field(id, 'text', { htmlId: id.slice(3), label: 'Degree' }),
    repeatedCount: 2,
  });
  const university = field('id:uni', 'text', { htmlId: 'uni', label: 'University' });

  it('reports repeated questions as unsupported with no target and no teach key', async () => {
    const { handle } = await setup(profile12);
    const response = await handle(
      {
        type: MessageType.MapFields,
        payload: { fields: [degree('id:d1'), degree('id:d2'), university] },
      },
      EXTENSION_PAGE,
    );
    expect(response).toMatchObject({
      data: {
        mappings: [
          { status: 'unsupported', unsupportedReason: 'repeated-question', hasValue: false },
          { status: 'unsupported', unsupportedReason: 'repeated-question', hasValue: false },
          { status: 'mapped', profileField: 'institution', hasValue: true },
        ],
      },
    });
    const mappings = (response as { data: { mappings: ReviewedMapping[] } }).data.mappings;
    expect(
      mappings.slice(0, 2).every((m) => m.profileField === undefined && m.mappingKey === undefined),
    ).toBe(true);
  });

  it('refuses an explicit approval for a repeated field, and still fills the safe field', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile12, fillInTab);
    const response = await handle(
      {
        type: MessageType.FillPage,
        payload: {
          tabId: 2,
          approvals: [
            { field: degree('id:d1'), profileField: 'highest_degree' },
            { field: degree('id:d2'), profileField: 'education[1].degree' },
            { field: university, profileField: 'institution' },
          ],
        },
      },
      EXTENSION_PAGE,
    );
    expect(response).toMatchObject({
      data: { results: [{ status: 'failed' }, { status: 'failed' }, { status: 'filled' }] },
    });
    expect(calls.map((c) => c.instructions.map((i) => [i.fieldId, i.value]))).toEqual([
      [['id:uni', 'University A']],
    ]);
  });

  it('refuses to save a Teach Once mapping for a repeated field', async () => {
    const { handle } = await setup(profile12);
    expect(
      await handle(
        {
          type: MessageType.SaveMapping,
          payload: { field: degree('id:d1'), profileField: 'highest_degree' },
        },
        EXTENSION_PAGE,
      ),
    ).toEqual({ ok: false, error: 'invalid-mapping' });
    expect(await handle({ type: MessageType.ListMappings }, EXTENSION_PAGE)).toMatchObject({
      data: { mappings: [] },
    });
  });

  it('a saved mapping for the question still works for a single field, never for repeated copies', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile12, fillInTab);
    const single = field('id:single', 'text', { htmlId: 'single', label: 'Degree' });
    await handle(
      {
        type: MessageType.SaveMapping,
        payload: { field: single, profileField: 'education[1].degree' },
      },
      EXTENSION_PAGE,
    );
    const mapped = await handle(
      { type: MessageType.MapFields, payload: { fields: [single, degree('id:d1')] } },
      EXTENSION_PAGE,
    );
    expect(mapped).toMatchObject({
      data: {
        mappings: [
          { status: 'taught', profileField: 'education[1].degree' },
          { status: 'unsupported', source: 'automatic', unsupportedReason: 'repeated-question' },
        ],
      },
    });
    await handle(
      {
        type: MessageType.FillPage,
        payload: {
          tabId: 2,
          approvals: [
            { field: single, profileField: 'education[1].degree' },
            { field: degree('id:d1'), profileField: 'education[1].degree' },
          ],
        },
      },
      EXTENSION_PAGE,
    );
    expect(calls.map((c) => c.instructions.map((i) => [i.fieldId, i.value]))).toEqual([
      [['id:single', 'Degree B']],
    ]);
  });
});

describe('Phase 13: explicit record assignment', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const W1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const PAGE = 'https://jobs.example.com/apply';
  const profile13: Profile = {
    ...sampleProfile,
    schemaVersion: 4,
    education: [
      { id: A, institution: 'University A', degree: 'Degree A' },
      { id: B, institution: 'University B', degree: 'Degree B' },
    ],
    workExperience: [{ id: W1, company: 'Company A', title: 'Title A' }],
  };
  // As scanned since Phase 14: distinct ids give each copy a unique semantic identity.
  const identityOf = (id: string) => ({
    key: `fp-${[...id]
      .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
      .toString(16)
      .padStart(16, '0')}`,
    unique: true,
  });
  const degree = (id: string): FormField => ({
    ...field(id, 'text', { htmlId: id.slice(3), label: 'Degree' }),
    repeatedCount: 2,
    identity: identityOf(id),
  });
  const [d1, d2] = [degree('id:d1'), degree('id:d2')];
  const university = field('id:uni', 'text', { htmlId: 'uni', label: 'University' });
  type Handle = Awaited<ReturnType<typeof setup>>['handle'];
  const assign = (handle: Handle, f: FormField, target: string, sender = EXTENSION_PAGE) =>
    handle({ type: MessageType.SaveAssignment, payload: { page: PAGE, field: f, target } }, sender);
  const map = async (handle: Handle, fields: FormField[], page: string | null = PAGE) => {
    const response = await handle(
      { type: MessageType.MapFields, payload: { fields, ...(page ? { page } : {}) } },
      EXTENSION_PAGE,
    );
    return (response as { data: { mappings: ReviewedMapping[] } }).data.mappings;
  };
  const fillAll = (handle: Handle, approvals: { field: FormField; profileField: string }[]) =>
    handle(
      { type: MessageType.FillPage, payload: { tabId: 5, approvals, page: PAGE } },
      EXTENSION_PAGE,
    );

  it('assigns repeated fields to specific records; they stay unselected and unfilled', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile13, fillInTab);
    expect((await map(handle, [d1, d2]))[0]).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'repeated-question',
    });
    const saved = await assign(handle, d1, `education@${A}.degree`);
    expect(saved).toMatchObject({
      ok: true,
      data: {
        mapping: {
          status: 'assigned',
          source: 'assigned',
          profileField: `education@${A}.degree`,
          hasValue: true,
          targetLabel: 'Education 1 → Degree',
        },
      },
    });
    await assign(handle, d2, `education@${B}.degree`);
    expect((await map(handle, [d1, d2])).map((m) => [m.status, m.targetLabel])).toEqual([
      ['assigned', 'Education 1 → Degree'],
      ['assigned', 'Education 2 → Degree'],
    ]);
    expect(calls).toEqual([]);
  });

  it('fills only approved assigned fields, with their record values and no record ids', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile13, fillInTab);
    await assign(handle, d1, `education@${A}.degree`);
    await assign(handle, d2, `education@${B}.degree`);
    await fillAll(handle, [
      { field: d1, profileField: `education@${A}.degree` },
      { field: d2, profileField: `education@${B}.degree` },
      { field: university, profileField: 'institution' },
    ]);
    expect(calls[0]?.instructions).toEqual([
      {
        fieldId: 'id:d1',
        value: 'Degree A',
        expected: {
          type: 'text',
          htmlId: 'd1',
          label: 'Degree',
          repeatedCount: 2,
        },
      },
      {
        fieldId: 'id:d2',
        value: 'Degree B',
        expected: {
          type: 'text',
          htmlId: 'd2',
          label: 'Degree',
          repeatedCount: 2,
        },
      },
      {
        fieldId: 'id:uni',
        value: 'University A',
        expected: { type: 'text', htmlId: 'uni', label: 'University' },
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(new RegExp(`${A}|${B}|education@|recordId`));
  });

  it('follows the stable id after the profile is reordered (not the position)', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle, store } = await setup(profile13, fillInTab);
    await assign(handle, d1, `education@${A}.degree`);
    await assign(handle, d2, `education@${B}.degree`);
    await store.set('profile', {
      ...profile13,
      education: [profile13.education[1] ?? {}, profile13.education[0] ?? {}],
    });
    expect((await map(handle, [d1, d2])).map((m) => m.targetLabel)).toEqual([
      'Education 2 → Degree',
      'Education 1 → Degree',
    ]);
    await fillAll(handle, [
      { field: d1, profileField: `education@${A}.degree` },
      { field: d2, profileField: `education@${B}.degree` },
    ]);
    expect(calls[0]?.instructions.map((i) => i.value)).toEqual(['Degree A', 'Degree B']);
  });

  it('uses the edited value of the same record', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle, store } = await setup(profile13, fillInTab);
    await assign(handle, d1, `education@${A}.degree`);
    await store.set('profile', {
      ...profile13,
      education: [
        { id: A, institution: 'University A', degree: 'Degree A (new)' },
        profile13.education[1] ?? {},
      ],
    });
    await fillAll(handle, [{ field: d1, profileField: `education@${A}.degree` }]);
    expect(calls[0]?.instructions.map((i) => i.value)).toEqual(['Degree A (new)']);
  });

  it('a deleted record makes the assignment unavailable: never another record, never inherited', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle, store } = await setup(profile13, fillInTab);
    await assign(handle, d1, `education@${A}.degree`);
    await store.set('profile', { ...profile13, education: [profile13.education[1] ?? {}] });
    expect((await map(handle, [d1, d2]))[0]).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'assignment-unavailable',
      hasValue: false,
    });
    expect(
      await fillAll(handle, [{ field: d1, profileField: `education@${A}.degree` }]),
    ).toMatchObject({
      data: { results: [{ status: 'failed' }] },
    });
    // A new record gets a new id and does not inherit the assignment.
    const C = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await store.set('profile', {
      ...profile13,
      education: [
        { id: C, institution: 'University C', degree: 'Degree C' },
        profile13.education[1] ?? {},
      ],
    });
    expect((await map(handle, [d1, d2]))[0]).toMatchObject({
      unsupportedReason: 'assignment-unavailable',
    });
    expect(calls).toEqual([]);
  });

  it('remapping replaces the assignment; only the new record can be sent', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile13, fillInTab);
    await assign(handle, d1, `education@${A}.degree`);
    await assign(handle, d1, `education@${B}.degree`);
    const results = await fillAll(handle, [
      { field: d1, profileField: `education@${A}.degree` },
      { field: d1, profileField: `education@${B}.degree` },
    ]);
    expect(results).toMatchObject({
      data: { results: [{ status: 'failed' }, { status: 'filled' }] },
    });
    expect(calls[0]?.instructions.map((i) => i.value)).toEqual(['Degree B']);
    expect(
      await handle(
        { type: MessageType.DeleteAssignment, payload: { page: PAGE, field: d1 } },
        EXTENSION_PAGE,
      ),
    ).toMatchObject({
      data: { mapping: { status: 'unsupported', unsupportedReason: 'repeated-question' } },
    });
  });

  it('isolates failures: valid A and C fill, B (deleted record) does not', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const three = { ...profile13 };
    const fields = ['id:f1', 'id:f2', 'id:f3'].map((id) => ({ ...degree(id), repeatedCount: 3 }));
    const { handle, store } = await setup(three, fillInTab);
    const [f1, f2, f3] = fields as [FormField, FormField, FormField];
    await assign(handle, f1, `education@${A}.degree`);
    await assign(handle, f2, `education@${B}.degree`);
    await assign(handle, f3, `education@${A}.institution`);
    await store.set('profile', { ...profile13, education: [profile13.education[0] ?? {}] });
    const results = await fillAll(handle, [
      { field: f1, profileField: `education@${A}.degree` },
      { field: f2, profileField: `education@${B}.degree` },
      { field: f3, profileField: `education@${A}.institution` },
    ]);
    expect(results).toMatchObject({
      data: { results: [{ status: 'filled' }, { status: 'failed' }, { status: 'filled' }] },
    });
    expect(calls[0]?.instructions.map((i) => [i.fieldId, i.value])).toEqual([
      ['id:f1', 'Degree A'],
      ['id:f3', 'University A'],
    ]);
  });

  it('a stale assignment (field changed, other page, repetition changed) is not applied', async () => {
    const { handle } = await setup(profile13);
    await assign(handle, d1, `education@${A}.degree`);
    expect((await map(handle, [{ ...d1, repeatedCount: 3 }]))[0]?.unsupportedReason).toBe(
      'repeated-question',
    );
    expect(
      (await map(handle, [{ ...d1, signals: { htmlId: 'd1', label: 'Degree type' } }]))[0]?.source,
    ).toBe('automatic');
    expect((await map(handle, [d1], 'https://jobs.example.com/other'))[0]?.status).toBe(
      'unsupported',
    );
    expect((await map(handle, [d1], null))[0]?.status).toBe('unsupported');
  });

  it('refuses assignments for non-repeated fields, record sections, missing records, wrong types', async () => {
    const { handle } = await setup(profile13);
    const refused = [
      await assign(handle, university, `education@${A}.institution`),
      await assign(
        handle,
        { ...d1, record: { collection: 'education', index: 1 } },
        `education@${A}.degree`,
      ),
      await assign(handle, d1, 'education@eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.degree'),
      await assign(handle, d1, `workExperience@${A}.company`),
      await assign(handle, d1, `workExperience@${W1}.current`),
      await assign(handle, d1, 'highest_degree'),
      await assign(handle, d1, 'education[1].degree'),
    ];
    expect(refused.every((r) => !r.ok)).toBe(true);
    expect(await assign(handle, d1, `education@${A}.degree`, WEB_PAGE)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('existing scalar mappings never make a repeated field fillable', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile13, fillInTab);
    const single = field('id:single', 'text', { htmlId: 'single', label: 'Degree' });
    await handle(
      { type: MessageType.SaveMapping, payload: { field: single, profileField: 'highest_degree' } },
      EXTENSION_PAGE,
    );
    expect((await map(handle, [d1, d2])).every((m) => m.status === 'unsupported')).toBe(true);
    await fillAll(handle, [{ field: d1, profileField: 'highest_degree' }]);
    expect(calls).toEqual([]);
  });

  it('record choices: labels and summaries for extension pages only; web pages are refused', async () => {
    const { handle } = await setup({ ...profile13, contact: { email: 'jane.doe@example.com' } });
    const choices = await handle({ type: MessageType.GetRecordChoices }, EXTENSION_PAGE);
    expect(choices).toEqual({
      ok: true,
      data: {
        records: {
          education: [
            { recordId: A, label: 'Education 1', summary: 'University A · Degree A' },
            { recordId: B, label: 'Education 2', summary: 'University B · Degree B' },
          ],
          workExperience: [
            { recordId: W1, label: 'Work experience 1', summary: 'Company A · Title A' },
          ],
          certifications: [],
        },
      },
    });
    expect(JSON.stringify(choices)).not.toContain('jane.doe@example.com');
    expect(await handle({ type: MessageType.GetRecordChoices }, WEB_PAGE)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});

describe('Phase 14: stable field identity and assignment management', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const PAGE = 'https://jobs.example.com/apply';
  const profile14: Profile = {
    ...sampleProfile,
    schemaVersion: 4,
    education: [
      { id: A, institution: 'University A', degree: 'Degree A' },
      { id: B, institution: 'University B', degree: 'Degree B' },
    ],
  };
  const KEY_UG = 'fp-00000000000000a1';
  const KEY_PG = 'fp-00000000000000b2';
  /** A repeated "Degree" as scanned: field id, name, and identity as given. */
  const degree = (id: string, name: string, key: string, unique = true): FormField => ({
    ...field(id, 'text', { name, label: 'Degree' }),
    repeatedCount: 2,
    identity: { key, unique },
  });
  type Handle = Awaited<ReturnType<typeof setup>>['handle'];
  const assign = (handle: Handle, f: FormField, target: string) =>
    handle(
      { type: MessageType.SaveAssignment, payload: { page: PAGE, field: f, target } },
      EXTENSION_PAGE,
    );
  const map = async (handle: Handle, fields: FormField[]) => {
    const response = await handle(
      { type: MessageType.MapFields, payload: { fields, page: PAGE } },
      EXTENSION_PAGE,
    );
    return (response as { data: { mappings: ReviewedMapping[] } }).data.mappings;
  };
  const fill = (
    handle: Handle,
    approvals: { field: FormField; profileField: string; transient?: boolean }[],
  ) =>
    handle(
      { type: MessageType.FillPage, payload: { tabId: 3, approvals, page: PAGE } },
      EXTENSION_PAGE,
    );

  it('assignments follow the field identity when the page reorders the fields', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile14, fillInTab);
    // Same name on both copies, so the field ids are positional (name:degree, name:degree~2).
    const ug = degree('name:degree', 'degree', KEY_UG);
    const pg = degree('name:degree~2', 'degree', KEY_PG);
    await assign(handle, ug, `education@${A}.degree`);
    await assign(handle, pg, `education@${B}.degree`);
    // Swapped on the page: the positional ids now belong to the other copy.
    const pgFirst = degree('name:degree', 'degree', KEY_PG);
    const ugSecond = degree('name:degree~2', 'degree', KEY_UG);
    expect((await map(handle, [pgFirst, ugSecond])).map((m) => m.profileField)).toEqual([
      `education@${B}.degree`,
      `education@${A}.degree`,
    ]);
    await fill(handle, [
      { field: pgFirst, profileField: `education@${B}.degree` },
      { field: ugSecond, profileField: `education@${A}.degree` },
    ]);
    expect(calls[0]?.instructions.map((i) => [i.fieldId, i.value])).toEqual([
      ['name:degree', 'Degree B'],
      ['name:degree~2', 'Degree A'],
    ]);
    // Phase 16: fingerprints are checked here, never sent to the page.
    expect(JSON.stringify(calls)).not.toMatch(/fp-[0-9a-f]{16}/);
  });

  it('two current fields with the same saved identity get neither (duplicate identity)', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile14, fillInTab);
    await assign(handle, degree('id:a', 'degree_a', KEY_UG), `education@${A}.degree`);
    const dupes = [
      degree('id:a', 'degree_a', KEY_UG, false),
      degree('id:b', 'degree_a', KEY_UG, false),
    ];
    expect((await map(handle, dupes)).map((m) => m.unsupportedReason)).toEqual([
      'repeated-question',
      'repeated-question',
    ]);
    await fill(handle, [{ field: dupes[0] as FormField, profileField: `education@${A}.degree` }]);
    expect(calls).toEqual([]);
  });

  it('a changed field identity does not inherit the old assignment', async () => {
    const { handle } = await setup(profile14);
    await assign(handle, degree('name:degree_one', 'degree_one', KEY_UG), `education@${A}.degree`);
    const changed = degree('name:degree_two', 'degree_two', KEY_PG);
    expect((await map(handle, [changed]))[0]).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'repeated-question',
    });
  });

  it('identical copies: the assignment is not saved, holds for this review, and is re-checked at fill', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle, store } = await setup(profile14, fillInTab);
    const KEY = 'fp-00000000000000cc';
    const [c1, c2] = [degree('index:1', '', KEY, false), degree('index:2', '', KEY, false)];
    const response = await assign(handle, c1, `education@${A}.degree`);
    expect(response).toMatchObject({
      ok: true,
      data: {
        mapping: { status: 'assigned', transient: true, targetLabel: 'Education 1 → Degree' },
      },
    });
    expect(await store.get('recordAssignments')).toBeUndefined();
    // A later analysis has no assignment for it.
    expect((await map(handle, [c1, c2]))[0]?.status).toBe('unsupported');
    // The approval carries it; the service worker re-checks it and the field's identity.
    const results = await fill(handle, [
      { field: c1, profileField: `education@${A}.degree`, transient: true },
      { field: c2, profileField: `education@${B}.degree` },
    ]);
    expect(results).toMatchObject({
      data: { results: [{ status: 'filled' }, { status: 'failed' }] },
    });
    expect(calls[0]?.instructions.map((i) => [i.fieldId, i.value, i.expected])).toEqual([
      ['index:1', 'Degree A', { type: 'text', name: '', label: 'Degree', repeatedCount: 2 }],
    ]);
  });

  it('never accepts an unsaved assignment for a uniquely identified field or a bad target', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile14, fillInTab);
    const unique = degree('id:u', 'degree_u', KEY_UG);
    const identical = degree('index:1', '', 'fp-00000000000000cc', false);
    const results = await fill(handle, [
      { field: unique, profileField: `education@${A}.degree`, transient: true },
      { field: identical, profileField: 'highest_degree', transient: true },
      {
        field: identical,
        profileField: 'education@cccccccc-cccc-4ccc-8ccc-cccccccccccc.degree',
        transient: true,
      },
    ]);
    expect(results).toMatchObject({
      data: { results: [{ status: 'failed' }, { status: 'failed' }, { status: 'failed' }] },
    });
    expect(calls).toEqual([]);
  });

  it('honors version 1 assignments only for uniquely identified fields with attribute ids', async () => {
    const { handle, store } = await setup(profile14);
    const legacy = (fieldId: string, htmlId?: string) => ({
      page: PAGE,
      fieldId,
      field: {
        type: 'text' as const,
        ...(htmlId ? { htmlId } : {}),
        name: htmlId ?? '',
        label: 'Degree',
        repeatedCount: 2,
      },
      target: `education@${A}.degree` as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await store.set('recordAssignments', {
      version: 1,
      assignments: [legacy('name:d1', 'd1'), legacy('index:4')],
    });
    const attributeField = degree('name:d1', 'd1', KEY_UG);
    attributeField.signals = { ...attributeField.signals, htmlId: 'd1' };
    const positional = { ...degree('index:4', '', KEY_PG), signals: { name: '', label: 'Degree' } };
    const [a, b] = await map(handle, [attributeField, positional]);
    expect(a).toMatchObject({ status: 'assigned', profileField: `education@${A}.degree` });
    expect(b).toMatchObject({ status: 'unsupported', unsupportedReason: 'repeated-question' });
  });

  it('lists assignments with labels only; removes one; clears all without touching the profile or mappings', async () => {
    const { handle, store } = await setup(profile14);
    await handle(
      {
        type: MessageType.SaveMapping,
        payload: {
          field: field('id:x', 'text', { htmlId: 'x', label: 'Alma mater' }),
          profileField: 'institution',
        },
      },
      EXTENSION_PAGE,
    );
    await assign(
      handle,
      degree('name:degree_undergrad', 'degree_undergrad', KEY_UG),
      `education@${A}.degree`,
    );
    await assign(
      handle,
      degree('name:degree_postgrad', 'degree_postgrad', KEY_PG),
      `education@${B}.degree`,
    );
    await store.set('profile', { ...profile14, education: [profile14.education[1] ?? {}] }); // A deleted
    const listed = await handle({ type: MessageType.ListAssignments }, EXTENSION_PAGE);
    const views = (listed as { data: { assignments: AssignmentView[] } }).data.assignments;
    expect(
      views.map(({ site, path, question, controlType, target, available, kind }) => ({
        site,
        path,
        question,
        controlType,
        target,
        available,
        kind,
      })),
    ).toEqual([
      {
        site: 'jobs.example.com',
        path: '/apply',
        question: 'Degree',
        controlType: 'text',
        target: 'Education · Degree',
        available: false,
        kind: 'identity',
      },
      {
        site: 'jobs.example.com',
        path: '/apply',
        question: 'Degree',
        controlType: 'text',
        target: 'Education 1 · Degree',
        available: true,
        kind: 'identity',
      },
    ]);
    const shown = JSON.stringify(views.map((view) => ({ ...view, handle: undefined })));
    expect(shown).not.toMatch(/aaaaaaaa|bbbbbbbb|fp-|name:|University|Degree A|Degree B/);
    const [first] = views;
    expect(
      await handle(
        { type: MessageType.RemoveAssignment, payload: { handle: first?.handle } },
        EXTENSION_PAGE,
      ),
    ).toEqual({ ok: true, data: { removed: true } });
    const profileBefore = await store.get('profile');
    const mappingsBefore = await store.get('savedMappings');
    expect(await handle({ type: MessageType.ClearAssignments }, EXTENSION_PAGE)).toEqual({
      ok: true,
      data: { cleared: true },
    });
    expect(await handle({ type: MessageType.ListAssignments }, EXTENSION_PAGE)).toEqual({
      ok: true,
      data: { assignments: [] },
    });
    expect(await store.get('profile')).toEqual(profileBefore);
    expect(await store.get('savedMappings')).toEqual(mappingsBefore);
  });

  it('management messages are refused for web pages and validated', async () => {
    const { handle } = await setup(profile14);
    for (const type of [MessageType.ListAssignments, MessageType.ClearAssignments]) {
      expect(await handle({ type }, WEB_PAGE)).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(
      await handle(
        { type: MessageType.RemoveAssignment, payload: { handle: { page: PAGE, fieldId: 'x' } } },
        WEB_PAGE,
      ),
    ).toEqual({ ok: false, error: 'forbidden' });
    for (const bad of [
      {},
      { handle: { page: 'not a url', fieldId: 'x' } },
      { handle: { page: PAGE, fieldId: 'x', identityKey: 'nope' } },
    ]) {
      expect(
        await handle({ type: MessageType.RemoveAssignment, payload: bad }, EXTENSION_PAGE),
      ).toEqual({ ok: false, error: 'malformed-message' });
    }
  });
});

describe('Phase 14: generated ids across re-renders', () => {
  it('an identity-matched assignment survives a re-render that changes a generated element id', async () => {
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const PAGE = 'https://jobs.example.com/apply';
    const profile: Profile = {
      ...sampleProfile,
      schemaVersion: 4,
      education: [{ id: A, institution: 'University A', degree: 'Degree A' }],
    };
    const { handle } = await setup(profile);
    const render = (generatedId: string): FormField => ({
      ...field(`id:${generatedId}`, 'text', {
        htmlId: generatedId,
        name: 'degree_undergrad',
        label: 'Degree',
      }),
      repeatedCount: 2,
      identity: { key: 'fp-00000000000000a1', unique: true },
    });
    await handle(
      {
        type: MessageType.SaveAssignment,
        payload: { page: PAGE, field: render(':r1:'), target: `education@${A}.degree` },
      },
      EXTENSION_PAGE,
    );
    const response = await handle(
      { type: MessageType.MapFields, payload: { fields: [render(':r9:')], page: PAGE } },
      EXTENSION_PAGE,
    );
    expect(response).toMatchObject({
      data: { mappings: [{ status: 'assigned', profileField: `education@${A}.degree` }] },
    });
    // A different name is a different field: not matched even with the same identity key.
    const renamed = {
      ...render(':r9:'),
      signals: { htmlId: ':r9:', name: 'degree_postgrad', label: 'Degree' },
    };
    const other = await handle(
      { type: MessageType.MapFields, payload: { fields: [renamed], page: PAGE } },
      EXTENSION_PAGE,
    );
    expect(other).toMatchObject({ data: { mappings: [{ status: 'unsupported' }] } });
  });
});

describe('Phase 16: stale approvals are refused before anything reaches the page', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const PAGE = 'https://jobs.example.com/apply';
  const profile16: Profile = {
    ...sampleProfile,
    schemaVersion: 4,
    education: [
      { id: A, institution: 'University A', degree: 'Degree A' },
      { id: B, institution: 'University B', degree: 'Degree B' },
    ],
  };
  const withIdentity = (f: FormField, key: string, unique = true): FormField => ({
    ...f,
    identity: { key, unique },
  });
  const first = withIdentity(FIELDS.firstName, 'fp-0000000000000f01');
  const email = withIdentity(FIELDS.email, 'fp-0000000000000e01');
  const degree = (id: string, key: string): FormField => ({
    ...field(id, 'text', { htmlId: id.slice(3), label: 'Degree' }),
    repeatedCount: 2,
    identity: { key, unique: true },
  });
  const [d1, d2] = [degree('id:d1', 'fp-00000000000000d1'), degree('id:d2', 'fp-00000000000000d2')];
  type Approval = { field: FormField; profileField: string };
  const fillPage = async (
    handle: Awaited<ReturnType<typeof setup>>['handle'],
    approvals: Approval[],
  ) => {
    const response = await handle(
      { type: MessageType.FillPage, payload: { tabId: 3, approvals, page: PAGE } },
      EXTENSION_PAGE,
    );
    return (response as { data: { results: { fieldId: string; status: string }[] } }).data.results;
  };
  const statuses = (results: { status: string }[]) => results.map((r) => r.status);

  it('A valid, B stale, C valid: A and C are sent and filled, B is refused (failure isolation)', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const phone = withIdentity(FIELDS.phone, 'fp-00000000000000a3');
    const changed = withIdentity(FIELDS.email, 'fp-0000000000000e99');
    const { handle } = await setup(profile16, fillInTab, () =>
      Promise.resolve([first, changed, phone]),
    );
    const results = await fillPage(handle, [
      { field: first, profileField: 'first_name' },
      { field: email, profileField: 'email' },
      { field: phone, profileField: 'phone' },
    ]);
    expect(statuses(results)).toEqual(['filled', 'skipped', 'filled']);
    expect(results[1]).toMatchObject({
      message: 'This field changed since Analyze. Analyze the page again.',
    });
    expect(calls[0]?.instructions.map((i) => i.fieldId)).toEqual(['id:first', 'name:phone']);
  });

  it.each<[string, (fields: FormField[]) => FormField[], string]>([
    ['removed', (fields) => fields.filter((f) => f.id !== 'id:email'), 'not-found'],
    [
      'replaced by a field with a different question (label changed)',
      (fields) =>
        fields.map((f) =>
          f.id === 'id:email'
            ? withIdentity(
                { ...f, signals: { ...f.signals, label: 'Work email' } },
                'fp-00000000000000e2',
              )
            : f,
        ),
      'skipped',
    ],
    [
      'now appearing twice (no longer unique)',
      (fields) =>
        fields.map((f) =>
          f.id === 'id:email' ? withIdentity(f, 'fp-0000000000000e01', false) : f,
        ),
      'skipped',
    ],
  ])('a field %s since Analyze is refused', async (_, mutate, status) => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile16, fillInTab, () =>
      Promise.resolve(mutate([first, email])),
    );
    const results = await fillPage(handle, [
      { field: first, profileField: 'first_name' },
      { field: email, profileField: 'email' },
    ]);
    expect(statuses(results)).toEqual(['filled', status]);
    expect(calls[0]?.instructions.map((i) => i.fieldId)).toEqual(['id:first']);
  });

  it('a page the adapter can no longer read, or that does not answer, gets nothing', async () => {
    for (const [scan, status] of [
      ['unreadable', 'unsupported'],
      [undefined, 'failed'],
    ] as const) {
      const { calls, fillInTab } = recordingFillInTab();
      const { handle } = await setup(profile16, fillInTab, () => Promise.resolve(scan));
      const results = await fillPage(handle, [{ field: first, profileField: 'first_name' }]);
      expect(statuses(results)).toEqual([status]);
      expect(calls).toEqual([]);
    }
  });

  it('profile edited between Analyze and Fill: the current value is sent, never a cached one', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle, store } = await setup(profile16, fillInTab);
    await store.set('profile', { ...profile16, identity: { firstName: 'Janet', lastName: 'Doe' } });
    await fillPage(handle, [{ field: first, profileField: 'first_name' }]);
    expect(calls[0]?.instructions.map((i) => i.value)).toEqual(['Janet']);
    // A value removed from the profile is skipped, not filled from memory.
    await store.set('profile', { ...profile16, identity: { lastName: 'Doe' } });
    expect(
      statuses(await fillPage(handle, [{ field: first, profileField: 'first_name' }])),
    ).toEqual(['skipped']);
    expect(calls).toHaveLength(1);
  });

  it('a taught mapping deleted or changed after Analyze no longer fills', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile16, fillInTab);
    const preferred = withIdentity(
      field('id:pref', 'text', { htmlId: 'pref', label: 'What name should we use?' }),
      'fp-0000000000000a0b',
    );
    const teach = (profileField: string) =>
      handle(
        { type: MessageType.SaveMapping, payload: { field: preferred, profileField } },
        EXTENSION_PAGE,
      );
    await teach('first_name');
    // Changed to another profile field: the approval for first_name is stale.
    await teach('last_name');
    expect(
      statuses(await fillPage(handle, [{ field: preferred, profileField: 'first_name' }])),
    ).toEqual(['failed']);
    // Deleted: the field is unknown again.
    await handle({ type: MessageType.ClearMappings }, EXTENSION_PAGE);
    expect(
      statuses(await fillPage(handle, [{ field: preferred, profileField: 'last_name' }])),
    ).toEqual(['failed']);
    expect(calls).toEqual([]);
  });

  it('an assignment deleted, changed, or whose record was deleted after Analyze is refused', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle, store } = await setup(profile16, fillInTab);
    const assign = (f: FormField, target: string) =>
      handle(
        { type: MessageType.SaveAssignment, payload: { page: PAGE, field: f, target } },
        EXTENSION_PAGE,
      );
    await assign(d1, `education@${A}.degree`);
    await assign(d2, `education@${B}.degree`);
    // Changed: d1 now points at record B; the approval for A is refused (no silent switch).
    await assign(d1, `education@${B}.degree`);
    expect(
      statuses(await fillPage(handle, [{ field: d1, profileField: `education@${A}.degree` }])),
    ).toEqual(['failed']);
    // Deleted.
    await handle(
      { type: MessageType.DeleteAssignment, payload: { page: PAGE, field: d1 } },
      EXTENSION_PAGE,
    );
    expect(
      statuses(await fillPage(handle, [{ field: d1, profileField: `education@${B}.degree` }])),
    ).toEqual(['failed']);
    // Record deleted from the profile.
    await store.set('profile', { ...profile16, education: profile16.education.slice(0, 1) });
    expect(
      statuses(await fillPage(handle, [{ field: d2, profileField: `education@${B}.degree` }])),
    ).toEqual(['failed']);
    expect(calls).toEqual([]);
  });

  it('nothing sent to the page carries a fingerprint, record id, or unapproved value', async () => {
    const { calls, fillInTab } = recordingFillInTab();
    const { handle } = await setup(profile16, fillInTab);
    await handle(
      {
        type: MessageType.SaveAssignment,
        payload: { page: PAGE, field: d1, target: `education@${A}.degree` },
      },
      EXTENSION_PAGE,
    );
    await fillPage(handle, [
      { field: first, profileField: 'first_name' },
      { field: d1, profileField: `education@${A}.degree` },
    ]);
    const sent = JSON.stringify(calls);
    expect(calls[0]?.instructions.map((i) => i.value)).toEqual(['Jane', 'Degree A']);
    expect(sent).not.toMatch(/fp-[0-9a-f]{16}|[0-9a-f]{8}-[0-9a-f]{4}-|education@|identity/);
    for (const value of ['Doe', 'jane.doe@example.com', 'University', 'Degree B']) {
      expect(sent).not.toContain(value);
    }
  });
});

describe('Phase 16: privacy boundary for content scripts', () => {
  it('a content script (web page sender) is refused every message (Phase 17: even the status)', async () => {
    const { handle } = await setup(sampleProfile);
    const probe = field('id:x', 'text', { label: 'X' });
    const page = 'https://jobs.example.com/apply';
    const messages = [
      { type: MessageType.GetProfile },
      { type: MessageType.MapFields, payload: { fields: [probe], page } },
      { type: MessageType.FillPage, payload: { tabId: 1, approvals: [], page } },
      { type: MessageType.SaveMapping, payload: { field: probe, profileField: 'city' } },
      { type: MessageType.ListMappings },
      { type: MessageType.DeleteMapping, payload: { key: 'v1|text|q=x|c=|i=' } },
      { type: MessageType.ClearMappings },
      { type: MessageType.GetRuntimeInfo },
      { type: MessageType.GetProfileStatus },
      {
        type: MessageType.SaveAssignment,
        payload: {
          page,
          field: probe,
          target: 'education@aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.degree',
        },
      },
      { type: MessageType.DeleteAssignment, payload: { page, field: probe } },
      { type: MessageType.GetRecordChoices },
      { type: MessageType.ListAssignments },
      {
        type: MessageType.RemoveAssignment,
        payload: { handle: { page, fieldId: 'id:x' } },
      },
      { type: MessageType.ClearAssignments },
    ];
    // Every service-worker message type is covered here.
    const covered = new Set(messages.map((m) => m.type));
    const workerTypes = Object.values(MessageType).filter(
      (t) => ![MessageType.Ping, MessageType.ScanPage, MessageType.FillFields].includes(t as never),
    );
    expect(workerTypes.every((t) => covered.has(t as never))).toBe(true);
    for (const message of messages) {
      const response = await handle(message, WEB_PAGE);
      expect(response, message.type).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
