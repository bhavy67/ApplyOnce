/**
 * Phase 17 security matrix for the extension boundary: who may send what, what payloads are
 * accepted, how corrupted storage is handled, what URLs are kept, and what error text can
 * reach the user or the console. See docs/security.md for the threat model.
 */
import type { FieldType, FillInstruction, FormField } from '@applyonce/core';
import { createEmptyProfile, type Profile } from '@applyonce/profile';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createServiceWorkerMessageHandler } from './background/message-handler';
import { logFailure } from './log-failure';
import { MessageType, parseMessage } from './messaging/protocol';
import { isPageKey, MAX_TEXT_LENGTH, pageKeyOf } from './messaging/validate';
import { FAILURE_MESSAGES } from './popup/analyze-page';
import { createIndexedDbStore } from './storage/indexeddb-store';
import { createProfileRepository, type ExtensionStorageSchema } from './storage/profile-repository';
import { createRecordAssignmentRepository } from './storage/record-assignment-repository';
import { createSavedMappingRepository } from './storage/saved-mapping-repository';

const ORIGIN = 'chrome-extension://abcdefghijklmnop/';
const EXTENSION_PAGE = { url: `${ORIGIN}popup.html` };
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const W = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PAGE = 'https://jobs.example.com/apply';
const PROFILE: Profile = {
  ...createEmptyProfile(),
  identity: { firstName: 'Jane', lastName: 'Doe' },
  contact: { email: 'jane.doe@example.com', phone: '+1 555 010 0199' },
  education: [
    { id: A, institution: 'University A', degree: 'Degree A' },
    { id: B, institution: 'University B', degree: 'Degree B' },
  ],
  workExperience: [{ id: W, company: 'Company W' }],
};
const SENSITIVE = [
  'Jane',
  'Doe',
  'jane.doe',
  '555 010',
  'University',
  'Degree',
  'Company W',
  A,
  B,
  W,
];

const field = (
  id: string,
  type: FieldType,
  signals: FormField['signals'],
  extra = {},
): FormField => ({
  id,
  type,
  htmlType: type,
  required: false,
  visible: true,
  disabled: false,
  signals,
  ...extra,
});
const degree = (id: string, key: string) =>
  field(
    id,
    'text',
    { htmlId: id.slice(3), label: 'Degree' },
    {
      repeatedCount: 2,
      identity: { key, unique: true },
    },
  );
const email = field(
  'id:email',
  'email',
  { htmlId: 'email', label: 'Email' },
  {
    identity: { key: 'fp-00000000000000e1', unique: true },
  },
);

let consoleSpies: MockInstance[];
beforeEach(() => {
  consoleSpies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
});
afterEach(() => {
  const logged = consoleSpies.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
  for (const value of SENSITIVE) expect(logged).not.toContain(value);
  vi.restoreAllMocks();
});

async function setup(stored: Partial<ExtensionStorageSchema> = { profile: PROFILE }) {
  const store = createIndexedDbStore<ExtensionStorageSchema>({
    databaseName: 'security-test',
    factory: new IDBFactory(),
  });
  for (const [key, value] of Object.entries(stored))
    await store.set(key as keyof ExtensionStorageSchema, value as never);
  const sent: FillInstruction[][] = [];
  let pageFields: FormField[] = [];
  const handler = createServiceWorkerMessageHandler({
    repository: createProfileRepository(store),
    mappings: createSavedMappingRepository(store),
    assignments: createRecordAssignmentRepository(store),
    extensionOrigin: ORIGIN,
    fillInTab: (_tab, instructions) => {
      sent.push(instructions);
      return Promise.resolve(
        instructions.map((i) => ({
          fieldId: i.fieldId,
          status: 'filled' as const,
          message: 'Filled.',
        })),
      );
    },
    scanTab: () => Promise.resolve(pageFields),
  });
  const handle = (message: unknown, sender: { url?: string } = EXTENSION_PAGE) => {
    const approvals = (message as { payload?: { approvals?: { field: FormField }[] } })?.payload
      ?.approvals;
    if (Array.isArray(approvals)) pageFields = approvals.map((a) => a.field);
    return handler(message, sender);
  };
  return { handle, store, sent };
}

// ---------------------------------------------------------------------------------------
// MESSAGING
// ---------------------------------------------------------------------------------------

describe('messaging: unauthorized senders', () => {
  const EVERY_WORKER_MESSAGE = [
    { type: MessageType.GetProfile },
    { type: MessageType.GetProfileStatus },
    { type: MessageType.MapFields, payload: { fields: [email] } },
    {
      type: MessageType.FillPage,
      payload: { tabId: 1, approvals: [{ field: email, profileField: 'email' }] },
    },
    { type: MessageType.SaveMapping, payload: { field: email, profileField: 'email' } },
    { type: MessageType.ListMappings },
    { type: MessageType.DeleteMapping, payload: { key: 'v1|email|q=email|c=|i=' } },
    { type: MessageType.ClearMappings },
    { type: MessageType.GetRuntimeInfo },
    {
      type: MessageType.SaveAssignment,
      payload: {
        page: PAGE,
        field: degree('id:d1', 'fp-00000000000000d1'),
        target: `education@${A}.degree`,
      },
    },
    {
      type: MessageType.DeleteAssignment,
      payload: { page: PAGE, field: degree('id:d1', 'fp-00000000000000d1') },
    },
    { type: MessageType.GetRecordChoices },
    { type: MessageType.ListAssignments },
    { type: MessageType.RemoveAssignment, payload: { handle: { page: PAGE, fieldId: 'id:d1' } } },
    { type: MessageType.ClearAssignments },
  ];

  it.each([
    ['a web page (content script)', { url: 'https://jobs.example.com/apply' }],
    ['no sender URL', {}],
    ['another extension', { url: 'chrome-extension://zzzzzzzzzzzzzzzz/popup.html' }],
    ['a look-alike origin', { url: 'chrome-extension://abcdefghijklmnop.evil/popup.html' }],
    ['a prefix trick', { url: 'chrome-extension://abcdefghijklmnopq/popup.html' }],
    ['a data URL', { url: `data:text/html,${ORIGIN}` }],
  ])(
    '%s is refused every service worker message; nothing is read or changed',
    async (_, sender) => {
      const { handle, store, sent } = await setup({
        profile: PROFILE,
        savedMappings: { version: 1, mappings: [] },
      });
      for (const message of EVERY_WORKER_MESSAGE) {
        const response = await handle(message, sender);
        expect(response, message.type).toEqual({ ok: false, error: 'forbidden' });
        for (const value of SENSITIVE) expect(JSON.stringify(response)).not.toContain(value);
      }
      expect(sent).toEqual([]);
      expect(await store.get('profile')).toEqual(PROFILE);
      expect(await store.get('savedMappings')).toEqual({ version: 1, mappings: [] });
      expect(await store.get('recordAssignments')).toBeUndefined();
    },
  );
});

describe('messaging: malformed, oversized, and unknown messages', () => {
  const long = 'x'.repeat(MAX_TEXT_LENGTH + 1);
  it.each<[string, unknown]>([
    ['not an object', 'applyonce/get-profile'],
    ['no type', { payload: {} }],
    ['unknown type', { type: 'applyonce/export-profile' }],
    ['a payload where none belongs', { type: MessageType.GetProfile, payload: { all: true } }],
    ['an extra top-level key', { type: MessageType.ListMappings, sender: 'popup' }],
    [
      'an extra payload key',
      { type: MessageType.MapFields, payload: { fields: [], path: 'identity' } },
    ],
    [
      'an extra field key',
      { type: MessageType.MapFields, payload: { fields: [{ ...email, value: 'x' }] } },
    ],
    [
      'an extra signal key',
      {
        type: MessageType.MapFields,
        payload: { fields: [{ ...email, signals: { label: 'Email', profile: 'x' } }] },
      },
    ],
    [
      'an oversized label',
      {
        type: MessageType.MapFields,
        payload: { fields: [{ ...email, signals: { label: long } }] },
      },
    ],
    [
      'too many fields',
      { type: MessageType.MapFields, payload: { fields: Array(2001).fill(email) } },
    ],
    [
      'an invalid field type',
      { type: MessageType.MapFields, payload: { fields: [{ ...email, type: 'password' }] } },
    ],
    [
      'an invalid profile key',
      {
        type: MessageType.FillPage,
        payload: { tabId: 1, approvals: [{ field: email, profileField: 'identity.firstName' }] },
      },
    ],
    [
      'a prototype key',
      {
        type: MessageType.FillPage,
        payload: { tabId: 1, approvals: [{ field: email, profileField: '__proto__' }] },
      },
    ],
    [
      'an invalid record id',
      {
        type: MessageType.SaveAssignment,
        payload: { page: PAGE, field: email, target: 'education@not-an-id.degree' },
      },
    ],
    [
      'a non-record assignment target',
      { type: MessageType.SaveAssignment, payload: { page: PAGE, field: email, target: 'email' } },
    ],
    [
      'a cross-collection field',
      {
        type: MessageType.SaveAssignment,
        payload: { page: PAGE, field: email, target: `education@${A}.company` },
      },
    ],
    [
      'a page with a query',
      { type: MessageType.MapFields, payload: { fields: [], page: `${PAGE}?token=secret` } },
    ],
    [
      'a page with credentials',
      {
        type: MessageType.MapFields,
        payload: { fields: [], page: 'https://user:pw@jobs.example.com/apply' },
      },
    ],
    [
      'a non-web page',
      { type: MessageType.MapFields, payload: { fields: [], page: 'javascript:alert(1)' } },
    ],
    ['a negative tab id', { type: MessageType.FillPage, payload: { tabId: -1, approvals: [] } }],
    [
      'a fingerprint in a fill instruction',
      {
        type: MessageType.FillFields,
        payload: {
          instructions: [
            {
              fieldId: 'x',
              value: 'v',
              expected: { type: 'text', identity: { key: 'fp-0000000000000000', unique: true } },
            },
          ],
        },
      },
    ],
    [
      'an object as a fill value',
      {
        type: MessageType.FillFields,
        payload: {
          instructions: [{ fieldId: 'x', value: { html: '<b>' }, expected: { type: 'text' } }],
        },
      },
    ],
    [
      'a non-finite fill value',
      {
        type: MessageType.FillFields,
        payload: { instructions: [{ fieldId: 'x', value: Infinity, expected: { type: 'text' } }] },
      },
    ],
    [
      'a bad identity key in a removal',
      {
        type: MessageType.RemoveAssignment,
        payload: { handle: { page: PAGE, fieldId: 'x', identityKey: '../x' } },
      },
    ],
  ])('%s is rejected before anything runs', async (_, message) => {
    expect(parseMessage(message).ok).toBe(false);
    const { handle, sent } = await setup();
    const response = await handle(message);
    expect(response.ok).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('messaging: privileged operations re-validate everything', () => {
  it('an assignment needs a repeated field, an existing record of that collection, and a fitting field', async () => {
    const { handle, store } = await setup();
    const d1 = degree('id:d1', 'fp-00000000000000d1');
    const save = (f: FormField, target: string) =>
      handle({ type: MessageType.SaveAssignment, payload: { page: PAGE, field: f, target } });
    // Not repeated (a plain email field).
    expect(await save(email, `education@${A}.degree`)).toEqual({
      ok: false,
      error: 'invalid-mapping',
    });
    // Record of another collection (a work experience id used as an education record).
    expect(await save(d1, `education@${W}.degree`)).toEqual({
      ok: false,
      error: 'invalid-mapping',
    });
    // Record that does not exist.
    expect(await save(d1, 'education@dddddddd-dddd-4ddd-8ddd-dddddddddddd.degree')).toEqual({
      ok: false,
      error: 'invalid-mapping',
    });
    expect(await store.get('recordAssignments')).toBeUndefined();
    // The valid one is stored with no values, only metadata and the record-id target.
    expect(await save(d1, `education@${A}.degree`)).toMatchObject({ ok: true });
    const stored = JSON.stringify(await store.get('recordAssignments'));
    for (const value of ['University', 'Degree A', 'Jane', 'jane.doe'])
      expect(stored).not.toContain(value);
  });

  it('record ids and fingerprints never reach the page, and only approved values do', async () => {
    const { handle, sent } = await setup();
    const d1 = degree('id:d1', 'fp-00000000000000d1');
    await handle({
      type: MessageType.SaveAssignment,
      payload: { page: PAGE, field: d1, target: `education@${A}.degree` },
    });
    await handle({
      type: MessageType.FillPage,
      payload: {
        tabId: 1,
        page: PAGE,
        approvals: [
          { field: email, profileField: 'email' },
          { field: d1, profileField: `education@${A}.degree` },
        ],
      },
    });
    const toPage = JSON.stringify(sent);
    expect(sent.flat().map((i) => i.value)).toEqual(['jane.doe@example.com', 'Degree A']);
    expect(toPage).not.toMatch(/fp-[0-9a-f]{16}|[0-9a-f]{8}-[0-9a-f]{4}-|education@|schemaVersion/);
    for (const unrelated of ['Jane', 'Doe', 'University', 'Degree B', 'Company W', '555 010'])
      expect(toPage).not.toContain(unrelated);
  });
});

// ---------------------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------------------

describe('storage: corrupted or hostile data is refused, never repaired or overwritten', () => {
  it.each<[string, unknown]>([
    ['a string', 'corrupted'],
    ['a list', [1, 2, 3]],
    ['an unknown version', { ...PROFILE, schemaVersion: 99 }],
    ['a wrong-typed section', { ...PROFILE, identity: 'Jane Doe' }],
    ['an object value', { ...PROFILE, contact: { email: { toString: 'x' } } }],
    [
      'duplicate record ids',
      { ...PROFILE, education: [PROFILE.education[0], PROFILE.education[0]] },
    ],
    ['a huge value', { ...PROFILE, identity: { firstName: 'x'.repeat(100_001) } }],
  ])('profile: %s → refused, stored data unchanged', async (_, stored) => {
    const { handle, store, sent } = await setup({ profile: stored as Profile });
    for (const message of [
      { type: MessageType.GetProfile },
      { type: MessageType.GetProfileStatus },
      { type: MessageType.MapFields, payload: { fields: [email] } },
      {
        type: MessageType.FillPage,
        payload: { tabId: 1, approvals: [{ field: email, profileField: 'email' }] },
      },
    ]) {
      expect(await handle(message), message.type).toEqual({
        ok: false,
        error: 'profile-unavailable',
      });
    }
    expect(sent).toEqual([]);
    expect(await store.get('profile')).toEqual(stored);
  });

  const mapping = {
    key: 'v1|text|q=preferred name|c=|i=',
    parts: { fieldType: 'text', question: 'preferred name' },
    profileField: 'first_name',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  it.each<[string, unknown]>([
    ['not a list', { version: 1, mappings: 'x' }],
    [
      'a key that does not match its parts',
      { version: 1, mappings: [{ ...mapping, key: 'v1|text|q=email|c=|i=' }] },
    ],
    ['an unknown property', { version: 1, mappings: [{ ...mapping, value: 'Jane' }] }],
    [
      'a record-id target',
      { version: 1, mappings: [{ ...mapping, profileField: `education@${A}.degree` }] },
    ],
    [
      'a bad field type',
      { version: 1, mappings: [{ ...mapping, parts: { fieldType: 'script' } }] },
    ],
    ['a duplicate key', { version: 1, mappings: [mapping, mapping] }],
    ['an unknown version', { version: 7, mappings: [] }],
  ])(
    'saved mappings: %s → not used, not overwritten; the rest keeps working',
    async (_, stored) => {
      const { handle, store } = await setup({
        profile: PROFILE,
        savedMappings: stored as ExtensionStorageSchema['savedMappings'],
      });
      const preferred = field('id:pref', 'text', { htmlId: 'pref', label: 'Preferred name' });
      // Mapping still works (automatic matcher only); the corrupted mappings are not applied.
      const mapped = await handle({
        type: MessageType.MapFields,
        payload: { fields: [preferred, email] },
      });
      expect(mapped).toMatchObject({
        ok: true,
        data: { mappings: [{ status: 'unknown' }, { status: 'mapped', profileField: 'email' }] },
      });
      expect(await handle({ type: MessageType.ListMappings })).toEqual({
        ok: false,
        error: 'mappings-unavailable',
      });
      expect(
        await handle({
          type: MessageType.SaveMapping,
          payload: { field: preferred, profileField: 'first_name' },
        }),
      ).toEqual({
        ok: false,
        error: 'mappings-unavailable',
      });
      expect(await store.get('savedMappings')).toEqual(stored);
      // The user can still clear them explicitly.
      expect(await handle({ type: MessageType.ClearMappings })).toEqual({
        ok: true,
        data: { cleared: true },
      });
    },
  );

  const assignment = {
    page: PAGE,
    fieldId: 'id:d1',
    identityKey: 'fp-00000000000000d1',
    field: { type: 'text', htmlId: 'd1', label: 'Degree', repeatedCount: 2 },
    target: `education@${A}.degree`,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  it.each<[string, unknown]>([
    ['a page with a query string', { ...assignment, page: `${PAGE}?token=secret` }],
    ['a page with credentials', { ...assignment, page: 'https://user:pw@jobs.example.com/apply' }],
    ['a non-record target', { ...assignment, target: 'email' }],
    ['a cross-collection target', { ...assignment, target: `education@${A}.company` }],
    ['a prototype target', { ...assignment, target: '__proto__' }],
    ['a stored value', { ...assignment, value: 'Degree A' }],
    ['a bad identity key', { ...assignment, identityKey: 'fp-x' }],
  ])('assignments: %s → not applied, not overwritten', async (_, entry) => {
    const stored = {
      version: 2,
      assignments: [entry],
    } as ExtensionStorageSchema['recordAssignments'];
    const { handle, store, sent } = await setup({ profile: PROFILE, recordAssignments: stored });
    const d1 = degree('id:d1', 'fp-00000000000000d1');
    const mapped = await handle({
      type: MessageType.MapFields,
      payload: { fields: [d1], page: PAGE },
    });
    expect(mapped).toMatchObject({
      data: { mappings: [{ status: 'unsupported', unsupportedReason: 'repeated-question' }] },
    });
    await handle({
      type: MessageType.FillPage,
      payload: {
        tabId: 1,
        page: PAGE,
        approvals: [{ field: d1, profileField: `education@${A}.degree` }],
      },
    });
    expect(sent).toEqual([]);
    expect(await handle({ type: MessageType.ListAssignments })).toEqual({
      ok: false,
      error: 'mappings-unavailable',
    });
    expect(await store.get('recordAssignments')).toEqual(stored);
  });
});

// ---------------------------------------------------------------------------------------
// URLS AND ORIGINS
// ---------------------------------------------------------------------------------------

describe('URL privacy and origin boundaries', () => {
  it('page keys keep only origin + path: never credentials, query, fragment, or tokens', () => {
    expect(pageKeyOf('https://user:password@example.com/path?token=secret#frag')).toBe(
      'https://example.com/path',
    );
    expect(pageKeyOf('https://example.com:443/a/../b/?utm_source=x')).toBe(
      'https://example.com/b/',
    );
    expect(pageKeyOf('https://example.com:8443/b')).toBe('https://example.com:8443/b');
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'chrome://settings',
      'not a url',
    ])
      expect(pageKeyOf(url)).toBeUndefined();
  });

  it.each([
    'https://example.com/path?token=secret',
    'https://example.com/path#frag',
    'https://user:password@example.com/path',
    'https://example.com:443/path',
    'HTTPS://EXAMPLE.COM/path',
    'https://example.com/a/../path',
  ])('%j is not a stored page key (only the normalized form is)', (value) => {
    expect(isPageKey(value)).toBe(false);
  });

  it('assignments never cross origins: look-alike hosts, schemes, and ports are other pages', async () => {
    const { handle } = await setup();
    const d1 = degree('id:d1', 'fp-00000000000000d1');
    await handle({
      type: MessageType.SaveAssignment,
      payload: { page: 'https://example.com/apply', field: d1, target: `education@${A}.degree` },
    });
    for (const page of [
      'https://evil-example.com/apply',
      'https://example.com.evil.com/apply',
      'https://evilexample.com/apply',
      'http://example.com/apply',
      'https://example.com:8443/apply',
      'https://sub.example.com/apply',
      'https://example.com/apply/',
      'https://example.com/applyx',
    ]) {
      const mapped = await handle({ type: MessageType.MapFields, payload: { fields: [d1], page } });
      expect(mapped, page).toMatchObject({ data: { mappings: [{ status: 'unsupported' }] } });
    }
    const same = await handle({
      type: MessageType.MapFields,
      payload: { fields: [d1], page: 'https://example.com/apply' },
    });
    expect(same).toMatchObject({ data: { mappings: [{ status: 'assigned' }] } });
  });

  it('the saved-assignments view shows host and path only', async () => {
    const { handle } = await setup();
    const d1 = degree('id:d1', 'fp-00000000000000d1');
    const page = pageKeyOf('https://user:password@example.com/path?token=secret#x');
    await handle({
      type: MessageType.SaveAssignment,
      payload: { page, field: d1, target: `education@${A}.degree` },
    });
    const response = (await handle({ type: MessageType.ListAssignments })) as {
      data: { assignments: Record<string, unknown>[] };
    };
    // What the profile page displays (the removal handle is opaque and never shown; it stays
    // inside the extension, like everything in this view).
    const shown = response.data.assignments.map((view) =>
      Object.fromEntries(Object.entries(view).filter(([key]) => key !== 'handle')),
    );
    expect(shown).toEqual([
      {
        site: 'example.com',
        path: '/path',
        question: 'Degree',
        controlType: 'text',
        target: 'Education 1 · Degree',
        available: true,
        kind: 'identity',
      },
    ]);
    expect(JSON.stringify(response)).not.toMatch(
      /password|user:|token|secret|#x|[0-9a-f]{8}-[0-9a-f]{4}-/,
    );
  });
});

// ---------------------------------------------------------------------------------------
// ERRORS AND LOGS
// ---------------------------------------------------------------------------------------

describe('error text and logs never leak internals or data', () => {
  const INTERNAL =
    /fp-[0-9a-f]|[0-9a-f]{8}-[0-9a-f]{4}-|#[a-z]|\[data-|querySelector|\.tsx?\b|at \w+ \(|Error:|stack|schemaVersion|savedMappings|recordAssignments|IndexedDB|undefined|null/;

  it('popup failure messages are plain sentences with no internals', () => {
    for (const message of Object.values(FAILURE_MESSAGES)) expect(message).not.toMatch(INTERNAL);
  });

  it('service worker errors are fixed codes: an error carrying data never reaches the caller', async () => {
    const store = createIndexedDbStore<ExtensionStorageSchema>({
      databaseName: 'x',
      factory: new IDBFactory(),
    });
    const handler = createServiceWorkerMessageHandler({
      repository: {
        load: () => Promise.reject(new Error(`bad record jane.doe@example.com at ${A}`)),
        save: () => Promise.resolve(),
        clear: () => Promise.resolve(),
      },
      mappings: createSavedMappingRepository(store),
      assignments: createRecordAssignmentRepository(store),
      extensionOrigin: ORIGIN,
      fillInTab: () => Promise.resolve([]),
      scanTab: () => Promise.resolve([]),
    });
    const response = await handler({ type: MessageType.GetProfile }, EXTENSION_PAGE);
    expect(response).toEqual({ ok: false, error: 'profile-unavailable' });
  });

  it('logFailure never logs messages, stacks, or a data-carrying error name', () => {
    const error = new Error('jane.doe@example.com');
    error.name = 'jane.doe@example.com';
    logFailure('page fill', error);
    const custom = new TypeError('University A');
    logFailure('page scan', custom);
    logFailure('profile load', { email: 'jane.doe@example.com' });
    expect(consoleSpies.flatMap((s) => s.mock.calls.flat())).toEqual([
      'ApplyOnce: page fill failed (Error)',
      'ApplyOnce: page scan failed (TypeError)',
      'ApplyOnce: profile load failed (object)',
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// SOURCE AUDIT
// ---------------------------------------------------------------------------------------

/** Production sources with comments removed (the checks are about code, not prose). */
const SOURCES = Object.entries(
  import.meta.glob<string>('../../../{apps,packages,adapters}/*/src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))
  .map(([path, text]) => [path, text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')] as const);

describe('source audit', () => {
  it.each([
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['innerHTML / outerHTML writes', /\.(inner|outer)HTML\s*=/],
    ['insertAdjacentHTML', /insertAdjacentHTML/],
    ['document.write', /document\.write/],
    ['eval / new Function', /\beval\(|new Function\(/],
    ['network requests', /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/],
    ['remote imports', /import\(\s*['"`]https?:|importScripts/],
    ['page storage', /\blocalStorage\b|\bsessionStorage\b|document\.cookie/],
    ['externally reachable listeners', /onMessageExternal|onConnectExternal|postMessage\(/],
    [
      'navigation or submission',
      /\.submit\(\)|requestSubmit\(|location\.(href|assign|replace)\s*[=(]|window\.open\(/,
    ],
  ])('no production code uses %s', (_, pattern) => {
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(SOURCES.filter(([, text]) => pattern.test(text)).map(([path]) => path)).toEqual([]);
  });
});

describe('results from the page process are not trusted blindly', () => {
  it.each<[string, unknown]>([
    ['an unknown status', { status: 'owned', message: 'x' }],
    ['a long message', { status: 'failed', message: `Your session expired. ${'x'.repeat(400)}` }],
    ['a non-text message', { status: 'failed', message: { html: '<b>' } }],
  ])('%s is replaced by "did not respond"', async (_, result) => {
    const store = createIndexedDbStore<ExtensionStorageSchema>({
      databaseName: 'r',
      factory: new IDBFactory(),
    });
    await store.set('profile', PROFILE);
    const handler = createServiceWorkerMessageHandler({
      repository: createProfileRepository(store),
      mappings: createSavedMappingRepository(store),
      assignments: createRecordAssignmentRepository(store),
      extensionOrigin: ORIGIN,
      fillInTab: (_tab, instructions) =>
        Promise.resolve(
          instructions.map((i) => ({ fieldId: i.fieldId, ...(result as object) }) as never),
        ),
      scanTab: () => Promise.resolve([email]),
    });
    const response = await handler(
      {
        type: MessageType.FillPage,
        payload: { tabId: 1, approvals: [{ field: email, profileField: 'email' }] },
      },
      EXTENSION_PAGE,
    );
    expect(response).toEqual({
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
});
