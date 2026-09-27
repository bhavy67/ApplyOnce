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
      workHistory: [],
    },
    preferences: { workMode: 'hybrid', employmentType: 'full-time', openToRelocation: true },
    education: {
      degree: 'MSc',
      fieldOfStudy: 'Physics',
      institution: 'Example University',
      graduationYear: 2019,
    },
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
