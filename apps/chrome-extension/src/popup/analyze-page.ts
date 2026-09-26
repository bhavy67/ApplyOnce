import type { FormField } from '@applyonce/core';
import { isPageScan, MessageType, type PageScan } from '../messaging/protocol';
import { sendToTab } from '../messaging/send';

export type AnalysisFailure =
  'no-active-tab' | 'unsupported-page' | 'injection-failed' | 'no-response' | 'scan-failed';

export type AnalysisResult = { ok: true; scan: PageScan } | { ok: false; reason: AnalysisFailure };

export const FAILURE_MESSAGES: Readonly<Record<AnalysisFailure, string>> = {
  'no-active-tab': 'No active tab to analyze.',
  'unsupported-page':
    'This page cannot be analyzed. Browser and extension pages are off limits to extensions.',
  'injection-failed': 'This page cannot be analyzed.',
  'no-response': 'ApplyOnce could not reach this page. Try reloading it.',
  'scan-failed': 'Something went wrong while analyzing this page.',
};

/** Sites where Chrome forbids extension scripts regardless of permissions. */
const BLOCKED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];

/** Only regular web pages (and local files, if the user allowed file access) can be scanned. */
export function isAnalyzableUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return false;
  return !BLOCKED_HOSTS.includes(parsed.hostname);
}

/**
 * Scans the active tab once. The content script is injected only if it is not already
 * running there (checked with a ping), so repeated clicks never stack scripts.
 */
export async function analyzeActiveTab(): Promise<AnalysisResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return failure('no-active-tab');
  if (!isAnalyzableUrl(tab.url)) return failure('unsupported-page');

  const ping = await sendToTab(tab.id, MessageType.Ping);
  if (!ping.ok) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch {
      // e.g. error pages, PDF viewer, or file:// without "Allow access to file URLs".
      return failure('injection-failed');
    }
  }

  const response = await sendToTab(tab.id, MessageType.ScanPage);
  if (!response.ok)
    return failure(response.error === 'no-receiver' ? 'no-response' : 'scan-failed');
  if (!isPageScan(response.data)) return failure('scan-failed');
  return { ok: true, scan: response.data };
}

function failure(reason: AnalysisFailure): AnalysisResult {
  return { ok: false, reason };
}

export interface FieldSummary {
  /** Visible, enabled fields: the ones a user could fill. */
  detected: number;
  labeled: number;
  /** Detected fields without a label, aria-label, or placeholder. */
  needsReview: number;
  /** Hidden or disabled fields, reported but not counted as detected. */
  inactive: number;
}

export function isActiveField(field: FormField): boolean {
  return field.visible && !field.disabled;
}

export function hasClearLabel(field: FormField): boolean {
  const { label, ariaLabel, placeholder } = field.signals;
  return Boolean(label ?? ariaLabel ?? placeholder);
}

export function summarizeFields(fields: readonly FormField[]): FieldSummary {
  const active = fields.filter(isActiveField);
  const labeled = active.filter(hasClearLabel).length;
  return {
    detected: active.length,
    labeled,
    needsReview: active.length - labeled,
    inactive: fields.length - active.length,
  };
}

export function fieldDisplayName(field: FormField): string {
  const { label, ariaLabel, placeholder, nearbyText } = field.signals;
  return label ?? ariaLabel ?? placeholder ?? nearbyText ?? 'Unlabeled field';
}
