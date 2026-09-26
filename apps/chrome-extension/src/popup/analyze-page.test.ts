import type { FormField } from '@applyonce/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageType, ok, type PageScan, type ReviewedMapping } from '../messaging/protocol';
import {
  analyzeActiveTab,
  fieldDisplayName,
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
    const runtimeSendMessage = vi.fn<(message: unknown) => Promise<unknown>>(() =>
      Promise.resolve(workerResponse),
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
      site: 'jobs.example.com',
      scan,
      mappings,
    });
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith({
      type: MessageType.MapFields,
      payload: { fields: scan.fields },
    });
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
      runtime: { sendMessage: () => Promise.resolve({ ok: false, error: 'profile-unavailable' }) },
    });
    expect(await analyzeActiveTab()).toEqual({ ok: false, reason: 'profile-unavailable' });
  });

  it('sends approvals (fields and profile field names, no values) to the service worker', async () => {
    const results = [{ fieldId: 'f', status: 'filled', message: 'Filled.' }];
    const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>(() =>
      Promise.resolve(ok({ results })),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const approvals = [
      { field: field({ id: 'f', signals: { label: 'Email' } }), profileField: 'email' },
    ];

    expect(await fillApprovedFields(3, approvals)).toEqual(results);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: MessageType.FillPage,
      payload: { tabId: 3, approvals },
    });
  });

  it('returns undefined when filling fails', async () => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: () => Promise.reject(new Error('no service worker')) },
    });
    expect(await fillApprovedFields(3, [])).toBeUndefined();
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
