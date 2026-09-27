import type { FillResult, FormField } from '@applyonce/core';
import {
  isFillResultList,
  isPageScan,
  MessageType,
  type FieldApproval,
  type PageScan,
  type ProfileRecordCounts,
  type RecordChoicesByCollection,
  type ReviewedMapping,
} from '../messaging/protocol';
import { BUILD_ID } from '../build-info';
import { sendToServiceWorker, sendToTab } from '../messaging/send';
import { pageKeyOf } from '../messaging/validate';

export type AnalysisFailure =
  | 'no-active-tab'
  | 'unsupported-page'
  | 'injection-failed'
  | 'no-response'
  | 'scan-failed'
  | 'profile-unavailable'
  /** The service worker runs a different build (e.g. an unpacked extension not reloaded). */
  | 'extension-updated'
  | 'worker-unavailable';

export type AnalysisResult =
  | {
      ok: true;
      tabId: number;
      /** Hostname of the page, recorded with taught mappings for display. */
      site?: string;
      /** The page (origin + path) record assignments are scoped to; absent for non-web pages. */
      page?: string;
      scan: PageScan;
      mappings: ReviewedMapping[];
      records: ProfileRecordCounts;
    }
  | { ok: false; reason: AnalysisFailure };

export const FAILURE_MESSAGES: Readonly<Record<AnalysisFailure, string>> = {
  'no-active-tab': 'No active tab to analyze.',
  'unsupported-page':
    'This page cannot be analyzed. Browser and extension pages are off limits to extensions.',
  'injection-failed': 'This page cannot be analyzed.',
  'no-response': 'ApplyOnce could not reach this page. Try reloading it.',
  'scan-failed': 'Something went wrong while analyzing this page.',
  'profile-unavailable': 'Your profile could not be loaded, so fields could not be matched.',
  'extension-updated':
    'ApplyOnce was updated. Reload the extension (chrome://extensions → reload) and try again.',
  'worker-unavailable':
    "ApplyOnce's background service is not responding. Reload the extension and try again.",
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
 * Scans the active tab once, then asks the service worker to map the fields. Nothing is
 * filled. The content script is injected only if it is not already running there (checked
 * with a ping), so repeated clicks never stack scripts.
 */
export async function analyzeActiveTab(): Promise<AnalysisResult> {
  const runtime = await checkRuntime();
  if (runtime) return failure(runtime);

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
  const scan = response.data;

  const page = pageKeyOf(tab.url);
  const mapped = await sendToServiceWorker(MessageType.MapFields, {
    fields: scan.fields,
    ...(page ? { page } : {}),
  });
  if (!mapped.ok) return failure('profile-unavailable');
  const site = siteOf(tab.url);
  return {
    ok: true,
    tabId: tab.id,
    ...(site ? { site } : {}),
    ...(page ? { page } : {}),
    scan,
    mappings: mapped.data.mappings,
    records: mapped.data.records,
  };
}

/**
 * Asks the service worker to fill the approved fields. The popup never handles profile
 * values: the service worker looks them up and sends them to the page itself.
 */
export async function fillApprovedFields(
  tabId: number,
  approvals: FieldApproval[],
  page?: string,
): Promise<FillResult[] | undefined> {
  const response = await sendToServiceWorker(MessageType.FillPage, {
    tabId,
    approvals,
    ...(page ? { page } : {}),
  });
  return response.ok && isFillResultList(response.data.results) ? response.data.results : undefined;
}

/**
 * Teach Once: saves the user's chosen profile field for this field and returns its updated
 * mapping for review. Never fills anything.
 */
export async function teachMapping(
  field: FormField,
  profileField: string,
  site: string | undefined,
): Promise<ReviewedMapping | undefined> {
  const response = await sendToServiceWorker(MessageType.SaveMapping, {
    field,
    profileField,
    ...(site ? { site } : {}),
  });
  return response.ok ? response.data.mapping : undefined;
}

/**
 * Explicit record assignment for a repeated field on this page. Returns the field's updated
 * mapping for review (assigned, not selected). Never fills anything.
 */
export async function assignRecord(
  page: string,
  field: FormField,
  target: string,
): Promise<ReviewedMapping | undefined> {
  const response = await sendToServiceWorker(MessageType.SaveAssignment, { page, field, target });
  return response.ok ? response.data.mapping : undefined;
}

export async function removeRecordAssignment(
  page: string,
  field: FormField,
): Promise<ReviewedMapping | undefined> {
  const response = await sendToServiceWorker(MessageType.DeleteAssignment, { page, field });
  return response.ok ? response.data.mapping : undefined;
}

/** The profile's records to choose from, labeled; fetched only when assigning. */
export async function loadRecordChoices(): Promise<RecordChoicesByCollection | undefined> {
  const response = await sendToServiceWorker(MessageType.GetRecordChoices);
  return response.ok ? response.data.records : undefined;
}

/**
 * Build handshake with the service worker. A different build id, or a worker that does not
 * know the message at all (an older build), means the extension must be reloaded; this is
 * reported as such instead of as a misleading profile error.
 */
export async function checkRuntime(): Promise<AnalysisFailure | undefined> {
  const response = await sendToServiceWorker(MessageType.GetRuntimeInfo);
  if (response.ok) return response.data.buildId === BUILD_ID ? undefined : 'extension-updated';
  return response.error === 'no-receiver' ? 'worker-unavailable' : 'extension-updated';
}

function siteOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname || undefined : undefined;
  } catch {
    return undefined;
  }
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
