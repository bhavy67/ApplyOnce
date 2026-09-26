import type { FormField } from '@applyonce/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageType, ok, type PageScan } from '../messaging/protocol';
import {
  analyzeActiveTab,
  fieldDisplayName,
  isAnalyzableUrl,
  summarizeFields,
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

  interface FakeChromeOptions {
    tab?: { id?: number; url?: string };
    alreadyInjected?: boolean;
    injectionFails?: boolean;
    listensAfterInjection?: boolean;
    scanResponse?: unknown;
  }

  function stubChrome({
    tab = { id: 7, url: 'https://jobs.example.com/apply' },
    alreadyInjected = false,
    injectionFails = false,
    listensAfterInjection = true,
    scanResponse = ok(scan),
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
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(() => Promise.resolve(tab.id === undefined ? [] : [tab])), sendMessage },
      scripting: { executeScript },
    });
    return { executeScript, sendMessage };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('injects the content script into the active tab, then scans once', async () => {
    const { executeScript, sendMessage } = stubChrome();

    expect(await analyzeActiveTab()).toEqual({ ok: true, scan });
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
