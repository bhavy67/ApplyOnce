import type { AdapterContext, DetectionStrength, PlatformDetection } from '@applyonce/core';
import { isSubdomainOf, pageHostname, visibleElements } from '@applyonce/adapter-generic';
import {
  AUTOMATION_ID,
  byAutomationId,
  MIN_DISTINCT_AUTOMATION_IDS,
  PAGE_MARKERS,
  UXI_WIDGET,
  WORKDAY_HOST_DOMAINS,
} from './selectors';

export interface WorkdayDetection extends PlatformDetection {
  /** "workday" for host or structure evidence; weak evidence stays generic. */
  platform: 'workday' | 'generic';
}

/**
 * Deterministic Workday detection.
 *
 * - host: a subdomain of a Workday host domain (never a look-alike such as
 *   "evilmyworkdayjobs.com" or "myworkdayjobs.com.example.org").
 * - structure: a rendered Workday page container, or both moderate signals together (many
 *   distinct rendered data-automation-id values and Workday widget-type attributes).
 * - weak: one moderate signal alone, which other sites could share.
 *
 * Visible text such as the word "Workday" is never evidence, and hidden markup is ignored.
 */
export function detectWorkday({ url, root }: AdapterContext<ParentNode>): WorkdayDetection {
  const evidence: string[] = [];
  let strength: DetectionStrength = 'none';

  const hostname = pageHostname(url);
  if (isSubdomainOf(hostname, WORKDAY_HOST_DOMAINS)) {
    evidence.push(`Workday host ${hostname}`);
    strength = 'host';
  }
  const marker = PAGE_MARKERS.find(
    (value) => visibleElements(root, byAutomationId(value)).length > 0,
  );
  if (marker) evidence.push(`Workday page container "${marker}"`);

  const distinctIds = new Set(
    visibleElements(root, `[${AUTOMATION_ID}]`).map((element) =>
      element.getAttribute(AUTOMATION_ID),
    ),
  ).size;
  const moderate: string[] = [];
  if (distinctIds >= MIN_DISTINCT_AUTOMATION_IDS) moderate.push(`${distinctIds} automation ids`);
  if (visibleElements(root, `[${UXI_WIDGET}]`).length > 0) moderate.push('Workday widget types');
  evidence.push(...moderate);

  if (strength !== 'host') {
    if (marker || moderate.length >= 2) strength = 'structure';
    else if (moderate.length === 1) strength = 'weak';
  }
  const platform = strength === 'host' || strength === 'structure' ? 'workday' : 'generic';
  return { platform, strength, evidence };
}
