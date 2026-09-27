import type { AdapterContext } from '@applyonce/core';
import {
  AUTOMATION_ID,
  byAutomationId,
  MIN_DISTINCT_AUTOMATION_IDS,
  PAGE_MARKERS,
  UXI_WIDGET,
  WORKDAY_HOST_SUFFIXES,
} from './selectors';

export interface WorkdayDetection {
  platform: 'workday' | 'generic';
  /** Human-readable reasons, for diagnostics and tests. Never page content. */
  evidence: string[];
}

/**
 * Deterministic Workday detection.
 *
 * - Strong evidence (either is enough): a Workday host, or a Workday page container.
 * - Moderate evidence (both are needed): many distinct data-automation-id values, and
 *   Workday widget-type attributes.
 *
 * Visible text such as the word "Workday" is never evidence, and a single moderate signal
 * (which other sites could share) leaves the page to the generic adapter.
 */
export function detectWorkday({ url, root }: AdapterContext<ParentNode>): WorkdayDetection {
  const strong: string[] = [];
  const moderate: string[] = [];

  const hostname = hostnameOf(url);
  if (hostname && WORKDAY_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    strong.push(`Workday host ${hostname}`);
  }
  const marker = PAGE_MARKERS.find((value) => root.querySelector(byAutomationId(value)));
  if (marker) strong.push(`Workday page container "${marker}"`);

  const distinctIds = new Set(
    Array.from(root.querySelectorAll(`[${AUTOMATION_ID}]`), (element) =>
      element.getAttribute(AUTOMATION_ID),
    ),
  ).size;
  if (distinctIds >= MIN_DISTINCT_AUTOMATION_IDS) moderate.push(`${distinctIds} automation ids`);
  if (root.querySelector(`[${UXI_WIDGET}]`)) moderate.push('Workday widget types');

  const isWorkday = strong.length > 0 || moderate.length >= 2;
  return { platform: isWorkday ? 'workday' : 'generic', evidence: [...strong, ...moderate] };
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
