import type { AdapterContext } from '@applyonce/core';
import {
  APPLICATION_FORM,
  CUSTOM_QUESTION_ID,
  GREENHOUSE_HOSTS,
  QUESTIONS_SECTION,
  REACT_SELECT,
} from './selectors';

export interface GreenhouseDetection {
  platform: 'greenhouse' | 'generic';
  /** Human-readable reasons, for diagnostics and tests. Never page content. */
  evidence: string[];
}

/**
 * Deterministic Greenhouse detection. Either is strong evidence on its own:
 *
 * - a Greenhouse job-board host (exact hostnames, not any *.greenhouse.io page such as the
 *   company's marketing site);
 * - Greenhouse's application form: `form#application-form` with question sections and at
 *   least one Greenhouse question control (a "question_<n>" id or a react-select input).
 *
 * The word "Greenhouse" in page text, a generic form, or a lone class name is never
 * evidence; anything else stays with the generic adapter.
 */
export function detectGreenhouse({ url, root }: AdapterContext<ParentNode>): GreenhouseDetection {
  const evidence: string[] = [];
  const hostname = hostnameOf(url);
  if (hostname && GREENHOUSE_HOSTS.includes(hostname)) evidence.push(`Greenhouse host ${hostname}`);

  const form = root.querySelector(APPLICATION_FORM);
  if (form?.querySelector(QUESTIONS_SECTION)) {
    const questionIds = [...form.querySelectorAll('[id]')].some((el) =>
      CUSTOM_QUESTION_ID.test(el.id),
    );
    const reactSelect = form.querySelector(REACT_SELECT.input) !== null;
    if (questionIds || reactSelect) evidence.push('Greenhouse application form');
  }
  return { platform: evidence.length > 0 ? 'greenhouse' : 'generic', evidence };
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
