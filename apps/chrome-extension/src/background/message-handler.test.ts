import type { FieldType, FillInstruction, FormField } from '@applyonce/core';
import { createEmptyProfile, type Profile } from '@applyonce/profile';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MessageType, type ReviewedMapping } from '../messaging/protocol';
import { createIndexedDbStore } from '../storage/indexeddb-store';
import {
  createProfileRepository,
  type ExtensionStorageSchema,
  type ProfileRepository,
} from '../storage/profile-repository';
import { createSavedMappingRepository } from '../storage/saved-mapping-repository';
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
    mappings: createSavedMappingRepository(store),
    extensionOrigin: ORIGIN,
    fillInTab,
  });
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
      mappings: createSavedMappingRepository(
        createIndexedDbStore<ExtensionStorageSchema>({
          databaseName: 'x',
          factory: new IDBFactory(),
        }),
      ),
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
    ['favourite_colour', preferred],
    ['location.city', preferred],
    ['email', field('name:r', 'radio', { name: 'r', label: 'Contact me?' })],
    ['city', field('index:3', 'text', {})],
  ])('rejects invalid target %j and stores nothing', async (profileField, target) => {
    const { handle, store } = await setup(sampleProfile);
    expect(await handle(save(target, profileField), EXTENSION_PAGE)).toEqual({
      ok: false,
      error: 'invalid-mapping',
    });
    expect(await store.get('savedMappings')).toBeUndefined();
  });

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
      expect(await teach(handle, previousUniversity, target)).toEqual({
        ok: false,
        error: 'invalid-mapping',
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
    const status = await handle({ type: MessageType.GetProfileStatus }, WEB_PAGE);
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
