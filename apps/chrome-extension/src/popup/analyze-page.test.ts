import type { FormField } from '@applyonce/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageType, ok, type PageScan, type ReviewedMapping } from '../messaging/protocol';
import {
  analyzeActiveTab,
  fieldDisplayName,
  checkRuntime,
  FAILURE_MESSAGES,
  fillApprovedFields,
  isAnalyzableUrl,
  summarizeFields,
  teachMapping,
} from './analyze-page';

function field(overrides: Partial<FormField> & Pick<FormField, 'signals'>): FormField {
  return {
    id: 'f',
    type: 'text',
    htmlType: 'text',
    required: false,
    visible: true,
    disabled: false,
    ...overrides,
  };
}

/** The build id in tests (no build-time define): see src/build-info.ts. */
const SAME_BUILD = ok({ buildId: 'development' });
const isRuntimeInfo = (message: unknown) =>
  (message as { type?: string }).type === MessageType.GetRuntimeInfo;

describe('isAnalyzableUrl', () => {
  it.each([
    ['https://jobs.example.com/apply', true],
    ['http://localhost:8080/form.html', true],
    ['file:///Users/me/form.html', true],
    ['chrome://extensions', false],
    ['chrome-extension://abc/profile.html', false],
    ['edge://settings', false],
    ['about:blank', false],
    ['view-source:https://example.com', false],
    ['https://chromewebstore.google.com/detail/x', false],
    ['not a url', false],
    [undefined, false],
  ])('%s → %s', (url, expected) => {
    expect(isAnalyzableUrl(url)).toBe(expected);
  });
});

describe('summarizeFields', () => {
  it('counts active fields, separates unlabeled ones, and excludes hidden or disabled fields', () => {
    const summary = summarizeFields([
      field({ signals: { label: 'First name' } }),
      field({ signals: { placeholder: 'Email' } }),
      field({ signals: { name: 'x' } }),
      field({ signals: { label: 'Hidden' }, visible: false }),
      field({ signals: { label: 'Disabled' }, disabled: true }),
    ]);
    expect(summary).toEqual({ detected: 3, labeled: 2, needsReview: 1, inactive: 2 });
  });

  it('names fields by their best available text', () => {
    expect(fieldDisplayName(field({ signals: { label: 'City', placeholder: 'e.g. Pune' } }))).toBe(
      'City',
    );
    expect(fieldDisplayName(field({ signals: { nearbyText: 'Notes' } }))).toBe('Notes');
    expect(fieldDisplayName(field({ signals: {} }))).toBe('Unlabeled field');
  });
});

describe('analyzeActiveTab', () => {
  const scan: PageScan = {
    title: 'Example form',
    platform: 'generic',
    fields: [field({ signals: { label: 'Email' } })],
    profileStatus: { hasData: true, valueCount: 3 },
  };

  const mappings: ReviewedMapping[] = [
    {
      fieldId: 'f',
      status: 'mapped',
      source: 'automatic',
      profileField: 'email',
      confidence: { score: 90, level: 'high', reasons: ['label', 'field-type'] },
      hasValue: true,
    },
  ];

  interface FakeChromeOptions {
    tab?: { id?: number; url?: string };
    alreadyInjected?: boolean;
    injectionFails?: boolean;
    listensAfterInjection?: boolean;
    scanResponse?: unknown;
    workerResponse?: unknown;
  }

  function stubChrome({
    tab = { id: 7, url: 'https://jobs.example.com/apply' },
    alreadyInjected = false,
    injectionFails = false,
    listensAfterInjection = true,
    scanResponse = ok(scan),
    workerResponse = ok({ mappings }),
  }: FakeChromeOptions = {}) {
    let listening = alreadyInjected;
    const executeScript = vi.fn(() => {
      if (injectionFails) return Promise.reject(new Error('Cannot access contents of the page'));
      listening = listensAfterInjection;
      return Promise.resolve([]);
    });
    const sendMessage = vi.fn((_tabId: number, message: { type: string }) => {
      if (!listening) return Promise.reject(new Error('Receiving end does not exist.'));
      return Promise.resolve(
        message.type === MessageType.Ping ? ok({ ready: true }) : scanResponse,
      );
    });
    const runtimeSendMessage = vi.fn<(message: unknown) => Promise<unknown>>((message) =>
      Promise.resolve(
        isRuntimeInfo(message)
          ? SAME_BUILD
          : (message as { type: string }).type === MessageType.GetProfileStatus
            ? ok({ hasData: true, valueCount: 3 })
            : workerResponse,
      ),
    );
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(() => Promise.resolve(tab.id === undefined ? [] : [tab])), sendMessage },
      scripting: { executeScript },
      runtime: { sendMessage: runtimeSendMessage },
    });
    return { executeScript, sendMessage, runtimeSendMessage };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('injects the content script, scans once, then asks the service worker to map', async () => {
    const { executeScript, sendMessage, runtimeSendMessage } = stubChrome();

    expect(await analyzeActiveTab()).toEqual({
      ok: true,
      tabId: 7,
      page: 'https://jobs.example.com/apply',
      site: 'jobs.example.com',
      scan: { ...scan, profileStatus: { hasData: true, valueCount: 3 } },
      mappings,
    });
    expect(runtimeSendMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: MessageType.GetRuntimeInfo },
      // Phase 17: the popup asks for the profile status (content scripts are refused).
      { type: MessageType.GetProfileStatus },
      // Phase 13: the page (origin + path) scopes record assignments.
      {
        type: MessageType.MapFields,
        payload: { fields: scan.fields, page: 'https://jobs.example.com/apply' },
      },
    ]);
    expect(executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 7 },
      files: ['content.js'],
    });
    expect(sendMessage.mock.calls.map(([, message]) => message.type)).toEqual([
      MessageType.Ping,
      MessageType.ScanPage,
    ]);
  });

  it('does not inject again when the content script is already running', async () => {
    const { executeScript } = stubChrome({ alreadyInjected: true });
    expect((await analyzeActiveTab()).ok).toBe(true);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('reports a missing active tab', async () => {
    stubChrome({ tab: {} });
    expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'no-active-tab' });
  });

  it('refuses browser pages without attempting injection', async () => {
    const { executeScript } = stubChrome({ tab: { id: 7, url: 'chrome://settings' } });
    expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'unsupported-page' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('reports injection failures', async () => {
    stubChrome({ injectionFails: true });
    expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'injection-failed' });
  });

  it('reports when the content script does not answer', async () => {
    stubChrome({ listensAfterInjection: false });
    expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'no-response' });
  });

  it.each([ok({ unexpected: true }), 'not an envelope', { ok: false, error: 'internal-error' }])(
    'reports a malformed or failed scan response (%j)',
    async (scanResponse) => {
      stubChrome({ scanResponse });
      expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'scan-failed' });
    },
  );
});

describe('analysis mapping and filling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports when the profile cannot be loaded for mapping', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: () => Promise.resolve([{ id: 1, url: 'https://example.com' }]),
        sendMessage: (_tabId: number, message: { type: string }) =>
          Promise.resolve(
            message.type === MessageType.Ping
              ? ok({ ready: true })
              : ok({ title: '', platform: 'generic', fields: [], profileStatus: null }),
          ),
      },
      scripting: { executeScript: () => Promise.resolve([]) },
      runtime: {
        sendMessage: (message: unknown) =>
          Promise.resolve(
            isRuntimeInfo(message) ? SAME_BUILD : { ok: false, error: 'profile-unavailable' },
          ),
      },
    });
    expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'profile-unavailable' });
  });

  it('sends approvals (fields and profile field names, no values) to the service worker', async () => {
    const results = [{ fieldId: 'f', status: 'filled', message: 'Filled.' }];
    const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>((message) =>
      Promise.resolve(isRuntimeInfo(message) ? SAME_BUILD : ok({ results })),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const approvals = [
      { field: field({ id: 'f', signals: { label: 'Email' } }), profileField: 'email' },
    ];

    expect(await fillApprovedFields(3, approvals)).toEqual(results);
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: MessageType.GetRuntimeInfo },
      { type: MessageType.FillPage, payload: { tabId: 3, approvals } },
    ]);
  });

  it('returns undefined when filling fails', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (message: unknown) =>
          isRuntimeInfo(message)
            ? Promise.resolve(SAME_BUILD)
            : Promise.reject(new Error('no service worker')),
      },
    });
    expect(await fillApprovedFields(3, [])).toBeUndefined();
  });

  it('Phase 16: a stale service worker fills nothing (same handshake as Analyze)', async () => {
    const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>(() =>
      Promise.resolve(ok({ buildId: 'another-build' })),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const approvals = [{ field: field({ id: 'f', signals: {} }), profileField: 'email' }];
    expect(await fillApprovedFields(3, approvals)).toBe('extension-updated');
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: MessageType.GetRuntimeInfo });
  });

  it('Phase 16: a page the platform adapter cannot read is reported, not mapped', async () => {
    const runtimeSendMessage = vi.fn<(message: unknown) => Promise<unknown>>(() =>
      Promise.resolve(SAME_BUILD),
    );
    vi.stubGlobal('chrome', {
      tabs: {
        query: () => Promise.resolve([{ id: 1, url: 'https://example.com' }]),
        sendMessage: (_tabId: number, message: { type: string }) =>
          Promise.resolve(
            message.type === MessageType.Ping
              ? ok({ ready: true })
              : ok({
                  title: '',
                  platform: 'workday',
                  fields: [],
                  unsupported: true,
                  profileStatus: null,
                }),
          ),
      },
      scripting: { executeScript: () => Promise.resolve([]) },
      runtime: { sendMessage: runtimeSendMessage },
    });
    expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'unreadable-page' });
    expect(runtimeSendMessage).toHaveBeenCalledOnce(); // the handshake only; no MapFields
    expect(FAILURE_MESSAGES['unreadable-page']).not.toMatch(/workday|adapter|scan|selector/i);
  });
});

describe('teachMapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the service worker to save the mapping and returns the updated review', async () => {
    const updated = { fieldId: 'f', status: 'taught', source: 'taught', profileField: 'city' };
    const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>(() =>
      Promise.resolve(ok({ mapping: updated })),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const f = field({ id: 'f', signals: { label: 'Preferred Working Location' } });

    expect(await teachMapping(f, 'city', 'jobs.example.com')).toEqual(updated);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: MessageType.SaveMapping,
      payload: { field: f, profileField: 'city', site: 'jobs.example.com' },
    });
  });

  it('returns undefined when the mapping is rejected', async () => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: () => Promise.resolve({ ok: false, error: 'invalid-mapping' }) },
    });
    expect(await teachMapping(field({ signals: {} }), 'nope', undefined)).toBeUndefined();
  });
});

describe('runtime version handshake', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubWorker(answer: () => Promise<unknown>) {
    const query = vi.fn(() => Promise.resolve([{ id: 1, url: 'https://example.com' }]));
    vi.stubGlobal('chrome', { runtime: { sendMessage: answer }, tabs: { query } });
    return query;
  }

  it('continues when the service worker runs the same build', async () => {
    stubWorker(() => Promise.resolve(SAME_BUILD));
    expect(await checkRuntime()).toBeUndefined();
  });

  it.each([
    ['a different build id', () => Promise.resolve(ok({ buildId: '0.6.0+old' }))],
    [
      'an older worker that does not know the message',
      () => Promise.resolve({ ok: false, error: 'unknown-message' }),
    ],
  ])(
    'asks for a reload when the worker reports %s, before touching the page',
    async (_, answer) => {
      const query = stubWorker(answer);
      expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'extension-updated' });
      expect(FAILURE_MESSAGES['extension-updated']).toMatch(
        /ApplyOnce was updated\. Reload the extension/,
      );
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('reports an unresponsive worker without blaming the profile', async () => {
    stubWorker(() => Promise.reject(new Error('Could not establish connection')));
    expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'worker-unavailable' });
    expect(FAILURE_MESSAGES['worker-unavailable']).not.toMatch(/profile/i);
  });
});
